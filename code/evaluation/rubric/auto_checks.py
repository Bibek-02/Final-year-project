"""
Objective, no-human checks over the results file (results.jsonl if it
exists, else results_dryrun.jsonl — see common.default_results_path()).
Writes auto_checks.csv in long format: one row per (case_id, check), so
every check's pass/fail (or flagged/clean) is visible per case rather than
collapsed into a single score.

Checks:
  evidence_refs_allowlist_share  -- share of each case's evidence_refs that
      are in that case's allowed_evidence_ids. LIMITATION: agent_service.
      get_recommendations() already drops any ref not in the allowlist
      before returning (see the "Dropping unknown evidence references" step
      in agent_service.py), so results.jsonl only ever contains POST-FILTER
      refs. This check therefore always reports share==1.0 by construction
      and cannot observe what the raw model output originally cited —
      computing that would require changing agent_service.py to also return
      the pre-filter output, which is out of scope here. This is the
      documented limitation the task anticipated ("else state the
      limitation"); see analyse.py's limitations section too.
  evidence_refs_nonempty         -- each of staffing/stock/promotions has a
      non-empty evidence_refs list (a fully-dropped citation list, e.g. the
      model invented every reference, would show up here as empty).
      EXCEPTION: if the case's allowed evidence includes no promotion-related
      SHAP ref (no "shap:PromoDays"/"shap:Promo2*"/"shap:periods_since_last_promo"
      etc.), an empty promotions.evidence_refs is the *correct* behaviour
      (see rubric_anchors.md's "Promotions-section rule when there is no
      promotion driver") and is reported as passed, with
      detail="promotion driver absent" — not as a failure.
  sections_present               -- staffing/stock/promotions/summary are
      all present (structural; AgentOutput requires this, checked defensively).

  generation_succeeded, sections_present, evidence_refs_nonempty, and
  evidence_refs_allowlist_share are objective pass/fail checks — their
  "passed" column means what it says.

  The checks below are wording heuristics that flag text for a human to
  read, not objective pass/fail verdicts (a heuristic match can be a false
  positive, e.g. a model correctly describing why it CAN'T judge urgency
  still contains the word "urgency"). Their check names carry a "flag_"
  prefix for this reason, and analyse.py reports them as a "flagged rate"
  (share of cases a human should look at), not a "pass rate". "passed" still
  means "heuristic found nothing" for consistency with the other checks, but
  passed=False here means "flagged for review", not "failed".

  flag_realised_data_mentions    -- mentions of actual/realised sales,
      customer counts, or forecast-error terminology (the model never has
      access to this data; its presence would usually mean leakage or
      fabrication, but could also be the model correctly stating it has no
      such data).
  flag_guarantee_language        -- "guarantee"/"ensure"/"will definitely"-
      style language.
  flag_causal_language           -- "because of X caused Y" / "will
      increase" style causal claims (SHAP contributions are associations,
      not causes — see agent_service.SYSTEM_PROMPT).
  flag_urgency_priority_risk_language -- urgency/priority/risk-level wording
      (the dataset has no data to judge urgency from).
  flag_invented_quantities       -- invented exact employee/stock/SKU
      counts (pattern: a number directly followed by a staffing or stock noun).
  flag_numeric_grounding         -- a number >= 10 appearing in the output
      that does not also appear (same integer, rounded) somewhere in that
      case's input prompt text. Numbers below 10 are excluded from this
      check since they are frequently part of generic phrasing (e.g. "a 2-3
      sentence summary") rather than claimed evidence — a deliberate
      heuristic threshold, not a hidden one.
"""
import json
import os
import re
import sys

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common

TEXT_FIELDS = ["recommendation", "detail", "caution"]
SECTION_KEYS = ["staffing", "stock", "promotions"]

REALISED_DATA_TERMS = [
    "actual sales", "actual_sales", "realised sales", "realized sales",
    "customers", "customer count", "footfall", "residual",
    "forecast error", "forecast_error", "percentage error", "mape", "rmspe",
]

GUARANTEE_TERMS = [
    "guarantee", "guaranteed", "will definitely", "ensures that", "we promise",
    "certain to", "assured",
]

CAUSAL_TERMS = [
    "because of", "caused by", "has caused", "will cause", "will increase",
    "will decrease", "will boost", "will drive", "due to the promotion",
    "due to the holiday",
]

URGENCY_TERMS = [
    "urgent", "urgently", "priority", "high priority", "low priority",
    "risk level", "critical", "immediately required", "asap",
]

INVENTED_QUANTITY_RE = re.compile(
    r"\b\d+(?:\.\d+)?\s*(?:employees|staff members|staffers|shifts|workers|"
    r"units of stock|stock units|SKUs|items in stock|cashiers)\b",
    re.IGNORECASE,
)

NUMBER_RE = re.compile(r"-?\d[\d,]*\.?\d*")
NUMERIC_GROUNDING_MIN_ABS = 10


def _case_text(output: dict) -> str:
    parts = [output.get("summary", "")]
    for key in SECTION_KEYS:
        section = output.get(key, {}) or {}
        for field in TEXT_FIELDS:
            parts.append(section.get(field, "") or "")
    return "\n".join(parts)


def _find_terms(text_lower: str, terms: list) -> list:
    return [t for t in terms if t in text_lower]


def _has_promo_evidence(allowed_ids: set) -> bool:
    """True if any allowed SHAP reference is promotion-related (PromoDays,
    Promo2, Promo2SinceWeek/Year, PromoInterval_*, periods_since_last_promo —
    every current promo-related feature name contains "promo")."""
    return any(
        ref.startswith("shap:") and "promo" in ref[len("shap:"):].lower()
        for ref in allowed_ids
    )


def _extract_rounded_ints(text: str) -> set:
    out = set()
    for raw in NUMBER_RE.findall(text):
        cleaned = raw.replace(",", "")
        try:
            val = float(cleaned)
        except ValueError:
            continue
        out.add(round(val))
    return out


def check_numeric_grounding(user_prompt: str, output_text: str):
    allowed_ints = _extract_rounded_ints(user_prompt)
    suspicious = []
    for raw in NUMBER_RE.findall(output_text):
        cleaned = raw.replace(",", "")
        try:
            val = float(cleaned)
        except ValueError:
            continue
        if abs(val) < NUMERIC_GROUNDING_MIN_ABS:
            continue
        if round(val) not in allowed_ints:
            suspicious.append(raw)
    return suspicious


def run_checks_for_record(record: dict) -> list:
    """Returns a list of {case_id, check, passed, detail} dicts for one
    results.jsonl record. A record with a recorded error produces a single
    'generation_succeeded' failing row instead of the content checks below,
    since there is no output to check."""
    case_id = record["case_id"]
    rows = []

    if record.get("error"):
        rows.append({
            "case_id": case_id, "check": "generation_succeeded",
            "passed": False, "detail": record["error"],
        })
        return rows

    rows.append({"case_id": case_id, "check": "generation_succeeded", "passed": True, "detail": ""})

    output = record.get("output") or {}
    inputs = record.get("inputs") or {}
    allowed_ids = set(inputs.get("allowed_evidence_ids", []))
    user_prompt = inputs.get("user_prompt", "")

    sections_present = all(key in output for key in SECTION_KEYS) and "summary" in output
    rows.append({
        "case_id": case_id, "check": "sections_present", "passed": sections_present,
        "detail": "" if sections_present else f"missing keys: {[k for k in SECTION_KEYS + ['summary'] if k not in output]}",
    })

    refs_by_section = {k: (output.get(k, {}) or {}).get("evidence_refs", []) or [] for k in SECTION_KEYS}
    empty_sections = [k for k, refs in refs_by_section.items() if not refs]
    promo_evidence_present = _has_promo_evidence(allowed_ids)

    excused = set()
    if not refs_by_section["promotions"] and not promo_evidence_present:
        excused.add("promotions")
    failing_sections = [k for k in empty_sections if k not in excused]

    nonempty = len(failing_sections) == 0
    if nonempty:
        detail = "promotion driver absent" if "promotions" in excused else ""
    else:
        detail = f"empty for: {failing_sections}"
        if "promotions" in excused:
            detail += " (promotions empty refs OK: promotion driver absent)"
    rows.append({
        "case_id": case_id, "check": "evidence_refs_nonempty", "passed": nonempty,
        "detail": detail,
    })

    all_refs = [r for refs in refs_by_section.values() for r in refs]
    if all_refs and allowed_ids:
        share = sum(1 for r in all_refs if r in allowed_ids) / len(all_refs)
    else:
        share = 1.0 if not all_refs else 0.0
    rows.append({
        "case_id": case_id, "check": "evidence_refs_allowlist_share", "passed": share >= 1.0,
        "detail": (
            f"share={share:.2f} (POST-FILTER ONLY — agent_service drops unallowlisted refs "
            f"before returning; raw pre-filter share is not observable without modifying "
            f"agent_service.py, which is out of scope)"
        ),
    })

    text = _case_text(output)
    text_lower = text.lower()

    for check_name, terms in [
        ("flag_realised_data_mentions", REALISED_DATA_TERMS),
        ("flag_guarantee_language", GUARANTEE_TERMS),
        ("flag_causal_language", CAUSAL_TERMS),
        ("flag_urgency_priority_risk_language", URGENCY_TERMS),
    ]:
        found = _find_terms(text_lower, terms)
        rows.append({
            "case_id": case_id, "check": check_name, "passed": len(found) == 0,
            "detail": "" if not found else f"matched: {found}",
        })

    invented = INVENTED_QUANTITY_RE.findall(text)
    rows.append({
        "case_id": case_id, "check": "flag_invented_quantities", "passed": len(invented) == 0,
        "detail": "" if not invented else f"matched: {INVENTED_QUANTITY_RE.findall(text)}",
    })

    suspicious_numbers = check_numeric_grounding(user_prompt, text)
    rows.append({
        "case_id": case_id, "check": "flag_numeric_grounding", "passed": len(suspicious_numbers) == 0,
        "detail": "" if not suspicious_numbers else f"numbers not found in input (>= {NUMERIC_GROUNDING_MIN_ABS}): {suspicious_numbers}",
    })

    return rows


def run_checks(records: list) -> pd.DataFrame:
    rows = [row for record in records for row in run_checks_for_record(record)]
    return pd.DataFrame(rows, columns=["case_id", "check", "passed", "detail"])


def load_results(path: str) -> list:
    records = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                records.append(json.loads(line))
    return records


def summarise_rates(df: pd.DataFrame) -> pd.DataFrame:
    """Pass rate for objective checks; flagged rate (share needing manual
    review) for flag_-prefixed heuristic checks — see module docstring."""
    rows = []
    for check, passed in df.groupby("check")["passed"]:
        if check.startswith("flag_"):
            rows.append({"check": check, "metric": "flagged_rate", "value": (~passed).mean()})
        else:
            rows.append({"check": check, "metric": "pass_rate", "value": passed.mean()})
    return pd.DataFrame(rows).sort_values("value")


def main():
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--results", default=common.default_results_path())
    parser.add_argument("--out", default=os.path.join(common.OUTPUT_DIR, "auto_checks.csv"))
    args = parser.parse_args()

    records = load_results(args.results)
    df = run_checks(records)
    common.ensure_output_dir()
    df.to_csv(args.out, index=False)

    n_cases = df["case_id"].nunique()
    print(f"Ran checks for {n_cases} case(s), {len(df)} check row(s). Wrote {args.out}")
    print(summarise_rates(df).to_string(index=False))
    return df


if __name__ == "__main__":
    main()
