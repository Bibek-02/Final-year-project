"""
Analyses completed hand-scores + auto_checks into the thesis-ready tables
(Table 5.x) and a plain-English limitations summary.

Inputs (all in outputs/, all produced earlier in the pipeline):
  cases.csv, scoresheet.csv (hand-filled), rescore_subset.csv (hand-filled),
  rescore_mapping.csv, auto_checks.csv, results.jsonl.

Outputs:
  analysis_summary.csv / .md   - mean/SD per criterion, overall + by
                                  granularity + by promo x high/low cell.
  analysis_auto_checks.csv/.md - auto-check pass rates.
  analysis_agreement.csv/.md   - exact agreement % and weighted (quadratic)
                                  Cohen's kappa per criterion on the 6
                                  re-scored cases, first pass vs second pass.
  analysis_failures.csv        - case_id + error for any failed generation.
  limitations.md               - plain-English limitations paragraph.
"""
import json
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common
from auto_checks import summarise_rates as _summarise_check_rates

SCORE_COLUMNS = ["grounding", "consistency", "actionability", "caution"]


def _read_csv(name: str) -> pd.DataFrame:
    return pd.read_csv(os.path.join(common.OUTPUT_DIR, name))


def _coerce_scores(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    for col in SCORE_COLUMNS:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    return df


def summarise_scores(cases: pd.DataFrame, scoresheet: pd.DataFrame) -> dict:
    merged = cases.merge(scoresheet, on="case_id", how="left")
    merged = _coerce_scores(merged)

    overall = merged[SCORE_COLUMNS].agg(["mean", "std"]).T.reset_index().rename(columns={"index": "criterion"})

    by_granularity = (
        merged.groupby("granularity")[SCORE_COLUMNS].agg(["mean", "std"])
        .reset_index()
    )

    by_cell = (
        merged.groupby(["granularity", "promo", "high_low"])[SCORE_COLUMNS].agg(["mean", "std"])
        .reset_index()
    )

    return {"overall": overall, "by_granularity": by_granularity, "by_cell": by_cell, "merged": merged}


def summarise_auto_checks(auto_checks: pd.DataFrame) -> pd.DataFrame:
    """Objective checks report a pass_rate; flag_-prefixed heuristic checks
    report a flagged_rate (share of cases needing manual review) instead —
    see auto_checks.py's module docstring and summarise_rates()."""
    return _summarise_check_rates(auto_checks)


def compute_agreement(scoresheet: pd.DataFrame, rescore_subset: pd.DataFrame, mapping: pd.DataFrame) -> pd.DataFrame:
    from sklearn.metrics import cohen_kappa_score

    rescore = rescore_subset.merge(mapping, on="rescore_id", how="left")
    first_pass = scoresheet[scoresheet["case_id"].isin(rescore["case_id"])]

    paired = first_pass.merge(rescore, on="case_id", suffixes=("_first", "_second"))

    rows = []
    for col in SCORE_COLUMNS:
        first = pd.to_numeric(paired[f"{col}_first"], errors="coerce")
        second = pd.to_numeric(paired[f"{col}_second"], errors="coerce")
        valid = first.notna() & second.notna()
        n = int(valid.sum())
        if n == 0:
            rows.append({
                "criterion": col, "n": 0, "exact_agreement_pct": np.nan,
                "weighted_kappa": np.nan, "note": "",
            })
            continue

        exact_pct = float((first[valid] == second[valid]).mean() * 100)
        first_const = first[valid].nunique() < 2
        second_const = second[valid].nunique() < 2
        note = ""

        if first_const and second_const and (first[valid] == second[valid]).all():
            kappa = 1.0  # cohen_kappa_score is undefined for a single constant class; perfect agreement is 1.0
            note = "both passes used a single constant score for this criterion"
        else:
            kappa = float(cohen_kappa_score(first[valid], second[valid], weights="quadratic"))
            if first_const or second_const:
                # The "kappa paradox": when one rater's marginal distribution is a single
                # category, expected chance agreement collapses to exactly the observed
                # agreement rate, forcing kappa to ~0 regardless of how well the two
                # passes actually line up. Flagged explicitly so a near-zero kappa here
                # isn't misread as "no reliability" — read exact_agreement_pct instead.
                which = "first" if first_const else "second"
                kappa = 0.0 if abs(kappa) < 1e-9 else kappa
                note = (
                    f"{which}-pass scores were constant on this criterion; weighted_kappa "
                    f"is forced toward 0 by construction (the \"kappa paradox\") and is not "
                    f"a meaningful reliability estimate here — see exact_agreement_pct instead"
                )

        rows.append({
            "criterion": col, "n": n, "exact_agreement_pct": exact_pct,
            "weighted_kappa": kappa, "note": note,
        })

    return pd.DataFrame(rows)


def summarise_failures(results_path: str) -> pd.DataFrame:
    rows = []
    with open(results_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            record = json.loads(line)
            if record.get("error"):
                rows.append({"case_id": record["case_id"], "error": record["error"]})
    return pd.DataFrame(rows, columns=["case_id", "error"])


def build_limitations_text(agreement: pd.DataFrame) -> str:
    lines = [
        "## Limitations", "",
        "This evaluation has a small number of structural limitations that should be",
        "read alongside the scores in Table 5.x:", "",
        "- **Single rater.** All 24 cases were scored by one person (the author).",
        "  There is no independent second rater, so the agreement figures reported",
        "  here are *intra*-rater (the same person scoring the same 6 cases twice,",
        "  with case identities hidden on the second pass), not *inter*-rater",
        "  agreement between different judges.",
        "- **Scoring interval.** The first-pass and blind-rescore passes were",
        "  completed close together in time, not separated by the several days",
        "  originally planned. Beyond the identity-blinding already in place, this",
        "  raises the risk that the second pass was influenced by memory of the",
        "  first, and should be read as a secondary caveat on the agreement",
        "  figures above.",
        "- **One generation per case.** Each case was generated exactly once, not",
        "  averaged or sampled across multiple generations. Variance across repeated",
        "  generations of the same case was not measured, so scores reflect a single",
        "  sample of the model's output distribution per case, not its central",
        "  tendency.",
        "- **n = 24.** Twelve weekly and twelve monthly cases, stratified by",
        "  predicted-sales level and promotion status (see select_cases.py and",
        "  rubric_anchors.md for the exact stratification and the weekly/monthly",
        "  promo-definition difference). This is enough to check for gross failure",
        "  modes across the stratified cells, not enough to support strong",
        "  statistical claims about population-level recommendation quality.",
        "- **The evidence_refs_allowlist_share auto-check is post-filter only.**",
        "  agent_service.get_recommendations() already drops any evidence reference",
        "  not in the allowlist before this harness ever sees the output, so that",
        "  check can only ever report 1.0 by construction — it confirms the filter is",
        "  working, not what the model originally cited before filtering.",
    ]

    paradox_criteria = agreement.loc[agreement["note"].str.contains("kappa paradox", na=False), "criterion"].tolist()
    if paradox_criteria:
        lines += [
            f"- **Weighted kappa is near-zero on {', '.join(paradox_criteria)} despite high exact",
            "  agreement, because one of the two rescore passes used a single constant",
            "  score on that criterion.** This is the well-known \"kappa paradox\": when a",
            "  rater's marginal distribution collapses to one category, the chance-agreement",
            "  term in Cohen's kappa collapses to the observed agreement rate, forcing kappa",
            "  toward 0 regardless of how well the two passes actually align. Read",
            "  exact_agreement_pct for these criteria instead of weighted_kappa.",
        ]

    return "\n".join(lines) + "\n"


def _df_to_markdown(df: pd.DataFrame) -> str:
    """Minimal GitHub-flavoured-markdown table writer — avoids depending on
    the optional `tabulate` package (not in backend/requirements.txt)."""
    headers = [" / ".join(str(p) for p in col) if isinstance(col, tuple) else str(col) for col in df.columns]
    lines = ["| " + " | ".join(headers) + " |", "| " + " | ".join("---" for _ in headers) + " |"]
    for _, row in df.iterrows():
        cells = []
        for val in row:
            if isinstance(val, float):
                cells.append(f"{val:.3f}" if not np.isnan(val) else "")
            else:
                cells.append(str(val))
        lines.append("| " + " | ".join(cells) + " |")
    return "\n".join(lines)


def write_markdown_table(df: pd.DataFrame, title: str) -> str:
    lines = [f"### {title}", "", _df_to_markdown(df), ""]
    return "\n".join(lines)


def main():
    cases = _read_csv("cases.csv")
    scoresheet = _read_csv("scoresheet.csv")
    auto_checks = _read_csv("auto_checks.csv")
    rescore_subset = _read_csv("rescore_subset.csv")
    mapping = _read_csv("rescore_mapping.csv")

    scores = summarise_scores(cases, scoresheet)
    auto_check_rates = summarise_auto_checks(auto_checks)
    agreement = compute_agreement(scoresheet, rescore_subset, mapping)
    failures = summarise_failures(common.default_results_path())

    common.ensure_output_dir()
    scores["overall"].to_csv(os.path.join(common.OUTPUT_DIR, "analysis_summary_overall.csv"), index=False)
    scores["by_granularity"].to_csv(os.path.join(common.OUTPUT_DIR, "analysis_summary_by_granularity.csv"), index=False)
    scores["by_cell"].to_csv(os.path.join(common.OUTPUT_DIR, "analysis_summary_by_cell.csv"), index=False)
    auto_check_rates.to_csv(os.path.join(common.OUTPUT_DIR, "analysis_auto_checks.csv"), index=False)
    agreement.to_csv(os.path.join(common.OUTPUT_DIR, "analysis_agreement.csv"), index=False)
    failures.to_csv(os.path.join(common.OUTPUT_DIR, "analysis_failures.csv"), index=False)

    md_parts = [
        "# Table 5.x — Recommendation-quality evaluation results\n",
        write_markdown_table(scores["overall"], "Overall (mean / SD per criterion, n=24)"),
        write_markdown_table(scores["by_granularity"], "By granularity"),
        write_markdown_table(scores["by_cell"], "By promo x high/low cell"),
        write_markdown_table(auto_check_rates, "Auto-check pass rates"),
        write_markdown_table(agreement, "Intra-rater agreement on the 6 re-scored cases"),
        write_markdown_table(failures, "Failed generations") if len(failures) else "### Failed generations\n\nNone.\n",
        build_limitations_text(agreement),
    ]
    md_path = os.path.join(common.OUTPUT_DIR, "analysis_report.md")
    with open(md_path, "w", encoding="utf-8") as f:
        f.write("\n".join(md_parts))

    print(f"Wrote analysis tables + {md_path}")
    print(f"Failed generations: {len(failures)}")
    return scores, auto_check_rates, agreement, failures


if __name__ == "__main__":
    main()
