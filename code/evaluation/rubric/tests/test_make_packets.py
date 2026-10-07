import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import generate
import make_packets
import make_scoresheet
import select_cases


def _fake_recommendation_output():
    # Deliberately contains no store id / period / case id — real Claude
    # output never sees or echoes our internal case_id bookkeeping.
    rec = {
        "recommendation": "Review weekend staffing cover.",
        "detail": "Weekend days contribute to this forecast.",
        "evidence_refs": ["shap:WeekendDays"],
        "caution": "Decision-support suggestion, not a directive.",
    }
    return {
        "staffing": dict(rec), "stock": dict(rec), "promotions": dict(rec),
        "summary": "The forecast is broadly in line with recent trends.",
        "limitations": ["No stock-level data available."],
    }


def _build_results_file(artifacts, cases, out_path):
    """Builds a results file using the REAL agent_service evidence/prompt
    (via generate.build_recorded_inputs), so the redaction logic in
    make_packets.py is tested against the actual prompt format, not a
    hand-guessed one."""
    from app.services import agent_service

    records = {}
    for row in cases.to_dict(orient="records"):
        inputs = generate.build_recorded_inputs(
            agent_service, int(row["store_id"]), row["granularity"], row["period"]
        )
        records[row["case_id"]] = {
            "case_id": row["case_id"],
            "error": None,
            "inputs": inputs,
            "output": _fake_recommendation_output(),
        }

    with open(out_path, "w", encoding="utf-8") as f:
        for record in records.values():
            f.write(json.dumps(record) + "\n")
    return records


def test_rescore_packets_contain_no_identifying_fields(artifacts, tmp_path, monkeypatch):
    monkeypatch.setattr(make_packets.common, "OUTPUT_DIR", str(tmp_path))

    cases = select_cases.select_all_cases(artifacts)
    cases.to_csv(tmp_path / "cases.csv", index=False)
    _build_results_file(artifacts, cases, tmp_path / "results_dryrun.jsonl")

    make_packets.main()

    _, mapping = make_scoresheet.build_rescore_subset(cases)
    rescore_dir = tmp_path / "packets_rescore"
    files = sorted(os.listdir(rescore_dir))
    assert files == sorted(f"{rid}.md" for rid in mapping["rescore_id"])

    cases_by_id = cases.set_index("case_id")
    for _, row in mapping.iterrows():
        case_row = cases_by_id.loc[row["case_id"]]
        content = (rescore_dir / f"{row['rescore_id']}.md").read_text(encoding="utf-8")

        # The "- Label:" bullet format is specific to render_full_packet's case
        # metadata block (make_packets.render_full_packet) — checking for that
        # exact prefix (not just the word) avoids false positives against the
        # real evidence text, which legitimately says things like "Predicted
        # Sales (ref: predicted_sales): 20,999 units".
        forbidden = [
            row["case_id"],
            str(int(case_row["store_id"])),
            str(case_row["period"]),
            case_row["granularity"],
            "- Granularity:", "- Store id:", "- Period:", "- Promo:", "- High/low:", "- Predicted sales:",
            "Weekly predicted sales", "Monthly predicted sales",
        ]
        for term in forbidden:
            assert term not in content, f"{row['rescore_id']}.md leaked identifying field: {term!r}"

        assert "Evidence shown to the model" in content
        assert "## Recommendation" in content
        assert "withheld for blind re-scoring" in content


def test_full_packets_contain_case_metadata_and_real_evidence(artifacts, tmp_path, monkeypatch):
    monkeypatch.setattr(make_packets.common, "OUTPUT_DIR", str(tmp_path))

    cases = select_cases.select_all_cases(artifacts)
    cases.to_csv(tmp_path / "cases.csv", index=False)
    _build_results_file(artifacts, cases, tmp_path / "results_dryrun.jsonl")

    written, rescore_written = make_packets.main()
    assert written == 24
    assert rescore_written == 6

    sample = cases.iloc[0]
    content = (tmp_path / "packets" / f"{sample['case_id']}.md").read_text(encoding="utf-8")
    assert f"Case {sample['case_id']}" in content
    assert f"Store id: {int(sample['store_id'])}" in content
    assert "## Recommendation" in content
    # Full packets keep the real, unredacted prompt text.
    assert f"Forecast data for Store {int(sample['store_id'])}" in content


def test_make_packets_never_reads_rescore_mapping_file(artifacts, tmp_path, monkeypatch):
    """Even if rescore_mapping.csv doesn't exist on disk at all, make_packets.py
    must still produce the 6 blind packets — the rescore_id<->case_id
    correspondence it needs is recomputed in memory, never read from disk."""
    monkeypatch.setattr(make_packets.common, "OUTPUT_DIR", str(tmp_path))

    cases = select_cases.select_all_cases(artifacts)
    cases.to_csv(tmp_path / "cases.csv", index=False)
    _build_results_file(artifacts, cases, tmp_path / "results_dryrun.jsonl")

    assert not (tmp_path / "rescore_mapping.csv").exists()
    written, rescore_written = make_packets.main()
    assert rescore_written == 6
    assert not (tmp_path / "rescore_mapping.csv").exists()


def test_redact_identifying_text_strips_header_and_granularity_word(artifacts):
    from app.services import agent_service

    forecast_row, shap_rows_all, evidence = agent_service._resolve_evidence(1, "weekly", None)
    shap_top = shap_rows_all[:8]
    allowed = agent_service._allowed_evidence_ids(forecast_row, shap_top)
    prompt = agent_service.build_user_prompt(1, evidence.period, "weekly", forecast_row, shap_top, allowed)

    assert "Store 1" in prompt and "Weekly predicted sales" in prompt  # sanity-check the raw format

    redacted = make_packets.redact_identifying_text(prompt)
    assert "Store 1" not in redacted
    assert evidence.period not in redacted
    assert "Weekly predicted sales" not in redacted
    assert "withheld for blind re-scoring" in redacted
    # The actual SHAP evidence content must survive redaction untouched.
    assert "TOP SHAP FEATURE CONTRIBUTIONS" in redacted
