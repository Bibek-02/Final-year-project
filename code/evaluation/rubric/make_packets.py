"""
Generates human-readable markdown packets for hand-scoring, built from
cases.csv + the results file (results.jsonl if it exists, else
results_dryrun.jsonl — see common.default_results_path()).

outputs/packets/{case_id}.md       - one file per case (all 24, first pass).
    Shows case metadata (store/period/granularity/promo/high_low/predicted
    sales), the exact evidence shown to the model (the real user_prompt
    text recorded by generate.py), and the recommendation (staffing/stock/
    promotions/summary/limitations). Used for first-pass scoring against
    rubric_anchors.md.

outputs/packets_rescore/R1..R6.md  - blind re-score packets for the 6 cases
    in rescore_subset.csv. Contain ONLY the evidence and recommendation —
    no case_id, store_id, period, granularity, promo/high_low label, or
    auto-check results of any kind, so the second pass can't be anchored on
    the first pass or on which case this was. The rescore_id -> case_id
    correspondence needed to pull the right evidence/recommendation is
    recomputed IN MEMORY from make_scoresheet.build_rescore_subset() (the
    same random_state=42 logic used to build rescore_subset.csv/
    rescore_mapping.csv in the first place) — this script never reads
    rescore_mapping.csv off disk, so nothing in the rescore packets'
    generation path touches that file.

    The evidence text itself (the real prompt built by
    agent_service.build_user_prompt) also embeds the case's identity in two
    fixed places: the opening "Forecast data for Store X, period Y
    (weekly):" header, and the Forecast Summary sentence it echoes verbatim
    ("Weekly predicted sales: ..."). redact_identifying_text() strips both
    before writing a blind packet; full (non-blind) packets show the real
    prompt text unredacted, since they already show this as explicit
    metadata anyway.
"""
import json
import os
import re
import sys

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common
from make_scoresheet import build_rescore_subset

SECTION_KEYS = ["staffing", "stock", "promotions"]

# agent_service.build_user_prompt's exact, fixed format embeds the case
# identity in two places: the opening header line ("Forecast data for Store
# X, period Y (weekly):") and the Forecast Summary sentence it echoes
# verbatim from the dss artifact ("Weekly predicted sales: ..."). Both are
# redacted for BLIND rescore packets only — see render_evidence_section.
_HEADER_RE = re.compile(r"^Forecast data for Store \d+, period \S+ \([^)]*\):", re.IGNORECASE)
_GRANULARITY_SUMMARY_RE = re.compile(r"\b(?:Weekly|Monthly)\s+predicted sales\b", re.IGNORECASE)


def redact_identifying_text(prompt: str) -> str:
    redacted = _HEADER_RE.sub(
        "Forecast data (store id / period / granularity withheld for blind re-scoring):",
        prompt,
    )
    return _GRANULARITY_SUMMARY_RE.sub("Predicted sales", redacted)


def load_results_by_case(path: str) -> dict:
    records = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                record = json.loads(line)
                records[record["case_id"]] = record
    return records


def render_recommendation_section(output: dict) -> str:
    lines = ["## Recommendation", ""]
    if not output:
        lines.append("_No output recorded (generation failed for this case)._")
        return "\n".join(lines)

    for key in SECTION_KEYS:
        section = output.get(key, {}) or {}
        refs = ", ".join(section.get("evidence_refs", []) or []) or "(none)"
        lines += [
            f"### {key.capitalize()}", "",
            f"**Recommendation:** {section.get('recommendation', '')}", "",
            f"**Detail:** {section.get('detail', '')}", "",
            f"**Evidence refs:** {refs}", "",
            f"**Caution:** {section.get('caution', '')}", "",
        ]

    lines += ["### Summary", "", output.get("summary", ""), ""]

    limitations = output.get("limitations", []) or []
    if limitations:
        lines += ["### Limitations", ""]
        lines += [f"- {item}" for item in limitations]
        lines.append("")

    return "\n".join(lines)


def render_evidence_section(record: dict, redact: bool = False) -> str:
    prompt = (record.get("inputs") or {}).get("user_prompt", "")
    if redact:
        prompt = redact_identifying_text(prompt)
    return "\n".join(["## Evidence shown to the model", "", "```", prompt, "```", ""])


def render_full_packet(case_row: dict, record: dict) -> str:
    lines = [
        f"# Case {case_row['case_id']}", "",
        "## Case metadata", "",
        f"- Granularity: {case_row['granularity']}",
        f"- Store id: {case_row['store_id']}",
        f"- Period: {case_row['period']}",
        f"- Promo: {case_row['promo']}",
        f"- High/low: {case_row['high_low']}",
        f"- Predicted sales: {case_row['predicted_sales']}",
        "",
        render_evidence_section(record),
        render_recommendation_section(record.get("output")),
    ]
    return "\n".join(lines)


def render_blind_packet(rescore_id: str, record: dict) -> str:
    lines = [
        f"# {rescore_id}", "",
        render_evidence_section(record, redact=True),
        render_recommendation_section(record.get("output")),
    ]
    return "\n".join(lines)


def main():
    cases = pd.read_csv(os.path.join(common.OUTPUT_DIR, "cases.csv"), dtype={"store_id": int})
    results_by_case = load_results_by_case(common.default_results_path())

    packets_dir = os.path.join(common.OUTPUT_DIR, "packets")
    os.makedirs(packets_dir, exist_ok=True)

    written = 0
    for case_row in cases.to_dict(orient="records"):
        record = results_by_case.get(case_row["case_id"])
        if record is None:
            print(f"  WARNING: no result found for {case_row['case_id']} - skipping packet")
            continue
        content = render_full_packet(case_row, record)
        with open(os.path.join(packets_dir, f"{case_row['case_id']}.md"), "w", encoding="utf-8") as f:
            f.write(content)
        written += 1
    print(f"Wrote {written} case packet(s) to {packets_dir}")

    # Recomputed in-memory — never reads rescore_mapping.csv off disk.
    _, mapping = build_rescore_subset(cases)

    rescore_dir = os.path.join(common.OUTPUT_DIR, "packets_rescore")
    os.makedirs(rescore_dir, exist_ok=True)

    rescore_written = 0
    for _, row in mapping.iterrows():
        record = results_by_case.get(row["case_id"])
        if record is None:
            print(f"  WARNING: no result found for rescore case behind {row['rescore_id']} - skipping packet")
            continue
        content = render_blind_packet(row["rescore_id"], record)
        with open(os.path.join(rescore_dir, f"{row['rescore_id']}.md"), "w", encoding="utf-8") as f:
            f.write(content)
        rescore_written += 1
    print(f"Wrote {rescore_written} blind rescore packet(s) to {rescore_dir}")
    return written, rescore_written


if __name__ == "__main__":
    main()
