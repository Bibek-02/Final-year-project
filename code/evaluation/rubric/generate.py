"""
Generate (or stub-generate) recommendations for every case in cases.csv.

Why call agent_service.get_recommendations() directly instead of hitting the
HTTP API: the service function IS the thing being evaluated (evidence
resolution, prompt construction, the allowlist filter on evidence_refs). The
HTTP route around it only adds JWT auth and store-scope checks, which are
access-control concerns, not recommendation-quality concerns. Calling the
service directly is the same code path backend/tests/test_agent.py already
uses to test this function, just without mocking the Claude client in live
mode, and lets this harness run with no running server and no login.

--dry-run: monkeypatches agent_service.client.messages.parse with a stub
BEFORE any case is processed, so no network call or API key is ever needed.
The stub reads the real "Allowed evidence references" list out of the real
prompt text (built by the real build_user_prompt) and cites a couple of real
refs from it, so the stub output is a structurally valid AgentOutput that
exercises the rest of the harness (auto_checks, scoring) meaningfully.

Live mode: exactly one call to get_recommendations() per case. The only retry
is a single retry for HTTP 429 (rate limit) or 503 (could not reach Claude) —
both are transport-level failures where the request was never actually
answered, so a retry cannot change the content of a response. Any other
failure (e.g. 502, 404, 500) is recorded as a failure for that case and moved
on from; it is never retried or silently dropped.

Output file naming: --dry-run writes outputs/results_dryrun.jsonl by default
(freely regenerated on every run — it's a stub, not data). Live mode writes
outputs/results.jsonl by default and REFUSES to overwrite it if it already
exists, unless --force is passed — a live run costs real API calls and its
output shouldn't be silently clobbered by a second accidental run.
"""
import argparse
import ast
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from types import SimpleNamespace

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common

# agent_service.get_recommendations's client.messages.parse call hardcodes
# max_tokens=2048 and passes no `temperature` (SDK default) — these are not
# exposed as constants on the module, so they are mirrored here as literals.
# Keep in sync with backend/app/services/agent_service.py if that call changes.
MAX_TOKENS = 2048
TEMPERATURE_NOTE = "default/not set"

RETRYABLE_HTTP_STATUSES = {429, 503}
RETRY_DELAY_S = 5
ALLOWED_IDS_RE = re.compile(r"Allowed evidence references you may cite in evidence_refs:\s*(\[.*\])")


def _parse_allowed_ids(prompt: str) -> list:
    m = ALLOWED_IDS_RE.search(prompt)
    if not m:
        return []
    # The prompt renders a Python sorted(set) via f"{sorted(allowed_ids)}" —
    # literal_eval parses that list of quoted strings without executing code.
    return ast.literal_eval(m.group(1))


def install_dry_run_stub():
    from app.schemas.agent import AgentOutput, Recommendation
    from app.services import agent_service

    def _stub_parse(*args, **kwargs):
        prompt = kwargs.get("messages", [{}])[0].get("content", "")
        allowed = _parse_allowed_ids(prompt)
        shap_refs = [r for r in allowed if r.startswith("shap:")]
        refs = [r for r in (["predicted_sales"] + shap_refs[:1]) if r in allowed]
        rec = Recommendation(
            recommendation="Review staffing cover against the forecast.",
            detail=(
                "This is a deterministic --dry-run stub, not a real Claude response. "
                "It exists only to exercise the evaluation harness end-to-end without "
                "any network call or API key."
            ),
            evidence_refs=refs,
            caution="Dry-run placeholder — not a real recommendation.",
        )
        output = AgentOutput(
            staffing=rec, stock=rec, promotions=rec,
            summary="Dry-run stub output, generated for harness testing only.",
            limitations=["This output was produced by generate.py --dry-run, not Claude."],
        )
        return SimpleNamespace(parsed_output=output)

    agent_service.client.messages.parse = _stub_parse
    return agent_service


def build_recorded_inputs(agent_service, store_id: int, forecast_type: str, period: str) -> dict:
    """Exact evidence/prompt inputs for one case, built from the real
    get_evidence + build_user_prompt — never re-derived independently."""
    evidence = agent_service.get_evidence(store_id, forecast_type, period)
    forecast_row, shap_rows_all, _ = agent_service._resolve_evidence(store_id, forecast_type, period)
    shap_rows_top = shap_rows_all[:8]
    allowed_ids = agent_service._allowed_evidence_ids(forecast_row, shap_rows_top)
    user_prompt = agent_service.build_user_prompt(
        store_id, evidence.period, forecast_type, forecast_row, shap_rows_top, allowed_ids
    )
    return {
        "system_prompt": agent_service.SYSTEM_PROMPT,
        "user_prompt": user_prompt,
        "allowed_evidence_ids": sorted(allowed_ids),
        "evidence": evidence.model_dump(),
    }


def run_one_case(agent_service, case: dict) -> dict:
    store_id = int(case["store_id"])
    forecast_type = case["granularity"]
    period = case["period"]

    record = {
        "case_id": case["case_id"],
        "store_id": store_id,
        "forecast_type": forecast_type,
        "period": period,
        "model": agent_service.AGENT_MODEL,
        "prompt_version": agent_service.PROMPT_VERSION,
        "max_tokens": MAX_TOKENS,
        "temperature": TEMPERATURE_NOTE,
        "generated_at": None,
        "latency_s": None,
        "output": None,
        "error": None,
    }

    try:
        record["inputs"] = build_recorded_inputs(agent_service, store_id, forecast_type, period)
    except Exception as exc:  # evidence resolution itself failed — still record a failure, don't drop the case
        record["inputs"] = None
        record["generated_at"] = datetime.now(timezone.utc).isoformat()
        record["error"] = f"evidence resolution failed: {exc}"
        return record

    from fastapi import HTTPException

    attempts = 0
    while True:
        attempts += 1
        t0 = time.monotonic()
        try:
            result = agent_service.get_recommendations(store_id, forecast_type, period)
            record["latency_s"] = time.monotonic() - t0
            record["generated_at"] = result["generated_at"].isoformat()
            record["output"] = result["recommendations"].model_dump()
            return record
        except HTTPException as exc:
            record["latency_s"] = time.monotonic() - t0
            if exc.status_code in RETRYABLE_HTTP_STATUSES and attempts < 2:
                print(f"    retrying once after HTTP {exc.status_code}: {exc.detail}")
                time.sleep(RETRY_DELAY_S)
                continue
            record["generated_at"] = datetime.now(timezone.utc).isoformat()
            record["error"] = f"HTTP {exc.status_code}: {exc.detail}"
            return record
        except Exception as exc:
            record["latency_s"] = time.monotonic() - t0
            record["generated_at"] = datetime.now(timezone.utc).isoformat()
            record["error"] = f"{type(exc).__name__}: {exc}"
            return record


def run_preflight():
    """One minimal live call to confirm AGENT_MODEL is an accepted model id.
    Never called during Phase A — live-API-only, invoked explicitly in Phase B."""
    store = common.ensure_artifacts_loaded()  # noqa: F841 - just to mirror normal startup
    from app.services import agent_service

    print(f"Preflight: calling model {agent_service.AGENT_MODEL!r} with a minimal request...")
    try:
        response = agent_service.client.messages.create(
            model=agent_service.AGENT_MODEL,
            max_tokens=16,
            messages=[{"role": "user", "content": "Reply with the single word: ok"}],
        )
        text = "".join(getattr(b, "text", "") for b in response.content)
        print(f"ACCEPTED - model id {agent_service.AGENT_MODEL!r} was accepted by the API.")
        print(f"Response text: {text!r}")
        return True
    except Exception as exc:
        print(f"REJECTED - model id {agent_service.AGENT_MODEL!r} was not accepted: {type(exc).__name__}: {exc}")
        return False


def resolve_out_path(dry_run: bool, explicit_out, force: bool) -> str:
    """Pure (no I/O side effects besides os.path.exists) so the refusal
    behaviour is unit-testable without ever importing agent_service or
    risking a real API call. Raises FileExistsError rather than exiting, so
    callers (main() for the CLI, tests for the logic) each decide what to do."""
    out_path = explicit_out or os.path.join(
        common.OUTPUT_DIR, "results_dryrun.jsonl" if dry_run else "results.jsonl"
    )
    if not dry_run and os.path.exists(out_path) and not force:
        raise FileExistsError(
            f"Refusing to overwrite existing live results file: {out_path} "
            f"(this is live-generation output — pass --force if you really mean to replace it)"
        )
    return out_path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Stub the Claude client; no network/key needed.")
    parser.add_argument("--preflight", action="store_true", help="One minimal live call to check AGENT_MODEL.")
    parser.add_argument("--cases", default=os.path.join(common.OUTPUT_DIR, "cases.csv"))
    parser.add_argument(
        "--out", default=None,
        help="Defaults to outputs/results_dryrun.jsonl (--dry-run) or outputs/results.jsonl (live).",
    )
    parser.add_argument(
        "--force", action="store_true",
        help="Allow overwriting an existing live outputs/results.jsonl. Has no effect in --dry-run (that file is always freely regenerated).",
    )
    args = parser.parse_args()

    if args.preflight:
        common.ensure_artifacts_loaded()
        ok = run_preflight()
        sys.exit(0 if ok else 1)

    try:
        out_path = resolve_out_path(args.dry_run, args.out, args.force)
    except FileExistsError as exc:
        print(str(exc))
        sys.exit(1)

    store = common.ensure_artifacts_loaded()  # noqa: F841 - triggers load before importing agent_service
    from app.services import agent_service

    if args.dry_run:
        agent_service = install_dry_run_stub()
        print("Running in --dry-run mode: Claude client is stubbed, no network call will be made.")

    cases = pd.read_csv(args.cases, dtype={"store_id": int})
    common.ensure_output_dir()

    results = []
    for i, row in enumerate(cases.to_dict(orient="records"), start=1):
        print(f"[{i}/{len(cases)}] {row['case_id']} ...")
        record = run_one_case(agent_service, row)
        status = "ok" if record["error"] is None else f"FAILED: {record['error']}"
        print(f"    {status}")
        results.append(record)

    with open(out_path, "w", encoding="utf-8") as f:
        for record in results:
            f.write(json.dumps(record, default=str) + "\n")

    n_failed = sum(1 for r in results if r["error"] is not None)
    print(f"Wrote {len(results)} result(s) to {out_path} ({n_failed} failure(s)).")
    return results


if __name__ == "__main__":
    main()
