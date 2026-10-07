"""
Builds the blank hand-scoring sheets from cases.csv:

  scoresheet.csv       - one row per case, columns grounding/consistency/
                          actionability/caution (blank, to be filled 0/1/2)
                          plus a free-text notes column.
  rescore_subset.csv   - 6 of the 24 cases, chosen + order-shuffled with
                          random_state=42, with case_id replaced by an opaque
                          rescore_id (R1..R6) so the first-pass scores can't
                          be recognised and anchored on during rescoring.
  rescore_mapping.csv  - rescore_id -> case_id, kept separate from
                          rescore_subset.csv so the blind rescoring pass
                          doesn't see it; analyse.py uses it afterwards to
                          join the two passes back together for intra-rater
                          agreement.
"""
import os
import sys

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common

RANDOM_STATE = 42
N_RESCORE = 6
SCORE_COLUMNS = ["grounding", "consistency", "actionability", "caution"]


def build_scoresheet(cases: pd.DataFrame) -> pd.DataFrame:
    sheet = cases[["case_id"]].copy()
    for col in SCORE_COLUMNS:
        sheet[col] = ""
    sheet["notes"] = ""
    return sheet


def build_rescore_subset(cases: pd.DataFrame):
    # A single random_state=42 sample without replacement both *chooses* the
    # 6 cases and *shuffles* their order in one reproducible step.
    subset = cases.sample(n=N_RESCORE, random_state=RANDOM_STATE).reset_index(drop=True)
    mapping = pd.DataFrame({
        "rescore_id": [f"R{i + 1}" for i in range(len(subset))],
        "case_id": subset["case_id"].values,
    })

    rescore_sheet = mapping[["rescore_id"]].copy()
    for col in SCORE_COLUMNS:
        rescore_sheet[col] = ""
    rescore_sheet["notes"] = ""
    return rescore_sheet, mapping


def main():
    cases_path = os.path.join(common.OUTPUT_DIR, "cases.csv")
    cases = pd.read_csv(cases_path)

    scoresheet = build_scoresheet(cases)
    rescore_sheet, mapping = build_rescore_subset(cases)

    common.ensure_output_dir()
    scoresheet_path = os.path.join(common.OUTPUT_DIR, "scoresheet.csv")
    rescore_path = os.path.join(common.OUTPUT_DIR, "rescore_subset.csv")
    mapping_path = os.path.join(common.OUTPUT_DIR, "rescore_mapping.csv")

    scoresheet.to_csv(scoresheet_path, index=False)
    rescore_sheet.to_csv(rescore_path, index=False)
    mapping.to_csv(mapping_path, index=False)

    print(f"Wrote {len(scoresheet)}-row scoresheet to {scoresheet_path}")
    print(f"Wrote {len(rescore_sheet)}-row blind rescore subset to {rescore_path}")
    print(f"Wrote rescore_id -> case_id mapping to {mapping_path} (don't consult this while rescoring)")
    return scoresheet, rescore_sheet, mapping


if __name__ == "__main__":
    main()
