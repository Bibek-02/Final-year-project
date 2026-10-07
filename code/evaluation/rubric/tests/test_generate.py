import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import generate
import select_cases


def test_dry_run_needs_no_api_key_and_produces_valid_outputs(artifacts, monkeypatch):
    # Prove the stub truly needs no key: wipe any key-shaped env var before running.
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)

    agent_service = generate.install_dry_run_stub()
    cases = select_cases.select_all_cases(artifacts)

    records = [generate.run_one_case(agent_service, row) for row in cases.to_dict(orient="records")]

    assert len(records) == 24
    for record in records:
        assert record["error"] is None, record["error"]
        output = record["output"]
        assert set(["staffing", "stock", "promotions", "summary", "limitations"]) <= set(output.keys())
        for section in ("staffing", "stock", "promotions"):
            assert output[section]["recommendation"]
            assert "urgency" not in output[section]
        assert record["model"] == agent_service.AGENT_MODEL
        assert record["prompt_version"] == agent_service.PROMPT_VERSION
        assert record["inputs"]["user_prompt"]
        assert record["inputs"]["allowed_evidence_ids"]


def test_dry_run_stub_cites_only_real_allowed_refs(artifacts):
    agent_service = generate.install_dry_run_stub()
    cases = select_cases.select_all_cases(artifacts)
    row = cases.iloc[0].to_dict()

    record = generate.run_one_case(agent_service, row)
    allowed = set(record["inputs"]["allowed_evidence_ids"])
    for section in ("staffing", "stock", "promotions"):
        for ref in record["output"][section]["evidence_refs"]:
            assert ref in allowed


# ---- resolve_out_path: live results.jsonl is never silently overwritten ----
# Pure-function tests — no agent_service import, no API key, no network.

def test_dry_run_defaults_to_results_dryrun_and_is_always_overwritable(tmp_path, monkeypatch):
    monkeypatch.setattr(generate.common, "OUTPUT_DIR", str(tmp_path))
    dry_path = tmp_path / "results_dryrun.jsonl"
    dry_path.write_text("stale", encoding="utf-8")

    out_path = generate.resolve_out_path(dry_run=True, explicit_out=None, force=False)
    assert out_path == str(dry_path)  # no exception, even though the file already exists


def test_live_defaults_to_results_jsonl_when_absent(tmp_path, monkeypatch):
    monkeypatch.setattr(generate.common, "OUTPUT_DIR", str(tmp_path))
    out_path = generate.resolve_out_path(dry_run=False, explicit_out=None, force=False)
    assert out_path == str(tmp_path / "results.jsonl")


def test_live_refuses_to_overwrite_existing_results_jsonl_without_force(tmp_path, monkeypatch):
    monkeypatch.setattr(generate.common, "OUTPUT_DIR", str(tmp_path))
    live_path = tmp_path / "results.jsonl"
    live_path.write_text("real live data", encoding="utf-8")

    import pytest
    with pytest.raises(FileExistsError):
        generate.resolve_out_path(dry_run=False, explicit_out=None, force=False)

    # Refusal must not have touched the file.
    assert live_path.read_text(encoding="utf-8") == "real live data"


def test_live_overwrite_allowed_with_force(tmp_path, monkeypatch):
    monkeypatch.setattr(generate.common, "OUTPUT_DIR", str(tmp_path))
    live_path = tmp_path / "results.jsonl"
    live_path.write_text("real live data", encoding="utf-8")

    out_path = generate.resolve_out_path(dry_run=False, explicit_out=None, force=True)
    assert out_path == str(live_path)
