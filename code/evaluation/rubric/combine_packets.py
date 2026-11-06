"""
Concatenates all 24 packets in outputs/packets/ into a single markdown file
(outputs/all_packets.md), in cases.csv's row order, with a table of contents
and a blank scoresheet row template appended after each packet — purely a
reading/navigation convenience for scoring by hand (no scores are filled
in). scoresheet.csv remains the actual record to fill in.

Also builds outputs/all_packets_rescore.md the same way from the 6 blind
packets_rescore/R*.md files, in rescore_subset.csv's row order (R1..R6 —
never read from rescore_mapping.csv, same no-identity-leak guarantee as
make_packets.py's blind packets themselves). rescore_subset.csv remains the
actual record to fill in for that pass.
"""
import os
import sys

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common

SCORE_COLUMNS = ["grounding", "consistency", "actionability", "caution"]


def build_combined_markdown(cases: pd.DataFrame, packets_dir: str) -> str:
    toc = ["# All packets (combined for scoring)", "", "## Table of contents", ""]
    body = []

    for i, row in enumerate(cases.to_dict(orient="records"), start=1):
        case_id = row["case_id"]
        toc.append(f"{i}. [{case_id}](#{i}-{case_id.replace('_', '-')})")

        packet_path = os.path.join(packets_dir, f"{case_id}.md")
        with open(packet_path, encoding="utf-8") as f:
            packet_text = f.read()

        body.append(f"---\n\n## {i}. {case_id}\n")
        body.append(packet_text)
        score_table = "\n".join(
            ["", "**Scores (copy into scoresheet.csv):**", "",
             "| Criterion | Score (0/1/2) | Note |", "|---|---|---|"]
            + [f"| {c.capitalize()} | | |" for c in SCORE_COLUMNS]
            + [""]
        )
        body.append(score_table)

    return "\n".join(toc) + "\n\n" + "\n".join(body)


def build_combined_rescore_markdown(rescore_ids: list, packets_rescore_dir: str) -> str:
    toc = ["# All blind rescore packets (combined for scoring)", "", "## Table of contents", ""]
    body = []

    for i, rescore_id in enumerate(rescore_ids, start=1):
        toc.append(f"{i}. [{rescore_id}](#{i}-{rescore_id.lower()})")

        packet_path = os.path.join(packets_rescore_dir, f"{rescore_id}.md")
        with open(packet_path, encoding="utf-8") as f:
            packet_text = f.read()

        body.append(f"---\n\n## {i}. {rescore_id}\n")
        body.append(packet_text)
        score_table = "\n".join(
            ["", "**Scores (copy into rescore_subset.csv):**", "",
             "| Criterion | Score (0/1/2) | Note |", "|---|---|---|"]
            + [f"| {c.capitalize()} | | |" for c in SCORE_COLUMNS]
            + [""]
        )
        body.append(score_table)

    return "\n".join(toc) + "\n\n" + "\n".join(body)


def main():
    cases = pd.read_csv(os.path.join(common.OUTPUT_DIR, "cases.csv"))
    packets_dir = os.path.join(common.OUTPUT_DIR, "packets")

    combined = build_combined_markdown(cases, packets_dir)
    out_path = os.path.join(common.OUTPUT_DIR, "all_packets.md")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(combined)
    print(f"Wrote {len(cases)} combined packet(s) to {out_path}")

    # rescore_id order read from rescore_subset.csv (never rescore_mapping.csv).
    rescore_subset = pd.read_csv(os.path.join(common.OUTPUT_DIR, "rescore_subset.csv"))
    packets_rescore_dir = os.path.join(common.OUTPUT_DIR, "packets_rescore")

    combined_rescore = build_combined_rescore_markdown(
        list(rescore_subset["rescore_id"]), packets_rescore_dir
    )
    rescore_out_path = os.path.join(common.OUTPUT_DIR, "all_packets_rescore.md")
    with open(rescore_out_path, "w", encoding="utf-8") as f:
        f.write(combined_rescore)
    print(f"Wrote {len(rescore_subset)} combined rescore packet(s) to {rescore_out_path}")

    return out_path, rescore_out_path


if __name__ == "__main__":
    main()
