"""
Agent recommendation endpoint. The Anthropic client is mocked throughout —
this suite must never make a real call to the Claude API.
"""
from types import SimpleNamespace
from datetime import datetime, timezone

import anthropic
import httpx
import pandas as pd
import pytest

from app.schemas.agent import AgentOutput, Recommendation
from app.core.artifacts import store as artifact_store

FAKE_REQUEST = httpx.Request("POST", "https://api.anthropic.com/v1/messages")


def _fake_output(**overrides):
    rec = Recommendation(recommendation="Staff normally.", detail="No unusual signal.")
    kwargs = dict(staffing=rec, stock=rec, promotions=rec, summary="Business as usual.")
    kwargs.update(overrides)
    return AgentOutput(**kwargs)


def test_agent_recommend_returns_structured_output(client, admin_headers, monkeypatch):
    monkeypatch.setattr(
        "app.services.agent_service.client.messages.parse",
        lambda *a, **k: SimpleNamespace(parsed_output=_fake_output()),
    )
    r = client.post("/agent/recommend?store_id=1&forecast_type=weekly", headers=admin_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["store_id"] == 1
    assert body["recommendations"]["staffing"]["recommendation"] == "Staff normally."
    assert body["recommendations"]["summary"] == "Business as usual."


def test_agent_recommendation_schema_has_no_urgency_field(client, admin_headers, monkeypatch):
    """Urgency/priority/risk-level language is out of scope for this dataset
    (no staffing, stock, cost or capacity data to judge urgency from) — the
    schema must not require or return it."""
    monkeypatch.setattr(
        "app.services.agent_service.client.messages.parse",
        lambda *a, **k: SimpleNamespace(parsed_output=_fake_output()),
    )
    r = client.post("/agent/recommend?store_id=1&forecast_type=weekly", headers=admin_headers)
    assert r.status_code == 200
    body = r.json()
    for key in ("staffing", "stock", "promotions"):
        item = body["recommendations"][key]
        assert "urgency" not in item
        assert set(item.keys()) == {"recommendation", "detail", "evidence_refs", "caution"}
    # Constructing the schema itself with no urgency argument must succeed.
    Recommendation(recommendation="Review staffing cover.", detail="Some detail.")


# Terms that must never reach the LLM: realised/future sales figures that
# would not have been available at forecast time (see the data-leakage
# audit — Actual Sales was, at one point, formatted directly into this
# prompt). Checked case-insensitively against the real prompt string, not
# against source code, so this fails if the leak comes back in any form.
FORBIDDEN_PROMPT_TERMS = [
    "actual sales", "actual_sales", "weeklysales", "monthlysales", "customers",
    "residual", "forecast_error", "percentage_error", "mape", "rmspe", "y_true",
]


def test_agent_prompt_excludes_actual_sales_and_future_data(client, admin_headers, monkeypatch):
    captured = {}

    def fake_parse(*args, **kwargs):
        captured["messages"] = kwargs["messages"]
        captured["system"] = kwargs.get("system", "")
        return SimpleNamespace(parsed_output=_fake_output())

    monkeypatch.setattr("app.services.agent_service.client.messages.parse", fake_parse)

    r = client.post("/agent/recommend?store_id=1&forecast_type=weekly", headers=admin_headers)
    assert r.status_code == 200

    prompt = captured["messages"][0]["content"]
    prompt_lower = (prompt + captured["system"]).lower()
    for term in FORBIDDEN_PROMPT_TERMS:
        assert term not in prompt_lower, f"Agent prompt leaked forbidden term: {term!r}"


def test_agent_prompt_never_asks_for_urgency_priority_or_risk_level(client, admin_headers, monkeypatch):
    """The Rossmann dataset has no staffing, stock, cost, margin, or store-capacity data,
    so the system cannot honestly judge urgency — the per-category request built into the
    user prompt must never ask Claude to output an urgency, priority, or risk level. (The
    system prompt may still mention these words while instructing Claude to avoid them.)"""
    captured = {}

    def fake_parse(*args, **kwargs):
        captured["messages"] = kwargs["messages"]
        return SimpleNamespace(parsed_output=_fake_output())

    monkeypatch.setattr("app.services.agent_service.client.messages.parse", fake_parse)

    r = client.post("/agent/recommend?store_id=1&forecast_type=weekly", headers=admin_headers)
    assert r.status_code == 200

    prompt_lower = captured["messages"][0]["content"].lower()
    for term in ("urgency", "priority", "risk level", "action level"):
        assert term not in prompt_lower, f"Agent user prompt leaked forbidden term: {term!r}"


def test_agent_prompt_includes_predicted_sales_and_legit_lag_features(client, admin_headers, monkeypatch):
    """The allowlist must not be so strict it also blocks legitimate,
    forecast-time-available evidence: the model's own prediction and
    lagged/rolling historical sales features (known before the forecast
    period, not the target being predicted)."""
    captured = {}

    def fake_parse(*args, **kwargs):
        captured["messages"] = kwargs["messages"]
        return SimpleNamespace(parsed_output=_fake_output())

    monkeypatch.setattr("app.services.agent_service.client.messages.parse", fake_parse)

    r = client.post("/agent/recommend?store_id=1&forecast_type=weekly", headers=admin_headers)
    assert r.status_code == 200

    prompt = captured["messages"][0]["content"]
    assert "Predicted Sales" in prompt
    # At least one lagged/rolling historical-sales feature should be able to
    # appear as readable SHAP evidence — assert the mechanism isn't blocked,
    # without depending on which exact feature ranks highest for this store.
    from app.core.feature_labels import readable_label
    lag_labels = {readable_label(f"sales_lag_{n}") for n in (1, 2, 3, 4, 8, 12, 52)}
    rolling_labels = {readable_label(f"rolling_mean_{n}") for n in (3, 4, 6, 8, 12)}
    assert any(label in prompt for label in lag_labels | rolling_labels) or "shap:" in prompt


def test_agent_recommend_respects_store_scope(client, manager_headers):
    # Manager (assigned_store=5) requesting a different store is blocked
    # before the Claude client is ever touched — no mock needed.
    r = client.post("/agent/recommend?store_id=1&forecast_type=weekly", headers=manager_headers)
    assert r.status_code == 403


def test_agent_recommend_unknown_store_is_404(client, admin_headers, monkeypatch):
    monkeypatch.setattr(
        "app.services.agent_service.client.messages.parse",
        lambda *a, **k: SimpleNamespace(parsed_output=_fake_output()),
    )
    r = client.post("/agent/recommend?store_id=999999&forecast_type=weekly", headers=admin_headers)
    assert r.status_code == 404


@pytest.mark.parametrize("exc,expected_status", [
    (anthropic.RateLimitError("rate limited", response=httpx.Response(429, request=FAKE_REQUEST), body=None), 429),
    (anthropic.APIConnectionError(request=FAKE_REQUEST), 503),
    (anthropic.APIStatusError("server error", response=httpx.Response(500, request=FAKE_REQUEST), body=None), 502),
])
def test_agent_recommend_maps_claude_errors_to_http_status(client, admin_headers, monkeypatch, exc, expected_status):
    def raise_exc(*a, **k):
        raise exc

    monkeypatch.setattr("app.services.agent_service.client.messages.parse", raise_exc)
    r = client.post("/agent/recommend?store_id=1&forecast_type=weekly", headers=admin_headers)
    assert r.status_code == expected_status


def test_agent_recommend_response_includes_backend_metadata(client, admin_headers, monkeypatch):
    monkeypatch.setattr(
        "app.services.agent_service.client.messages.parse",
        lambda *a, **k: SimpleNamespace(parsed_output=_fake_output()),
    )
    r = client.post("/agent/recommend?store_id=1&forecast_type=weekly", headers=admin_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["provider"] == "Anthropic"
    assert body["model"]
    assert body["prompt_version"]
    generated_at = datetime.fromisoformat(body["generated_at"].replace("Z", "+00:00"))
    assert generated_at.tzinfo is not None
    assert (datetime.now(timezone.utc) - generated_at).total_seconds() < 60


# ---- Evidence endpoint ----

ALLOWED_EVIDENCE_KEYS = {
    "store_id", "forecast_type", "period", "predicted_sales", "baseline_model_output",
    "net_shap_adjustment", "top_positive_drivers", "top_negative_drivers", "shap_drivers",
    "shap_feature_count", "reconciliation_ok", "forecast_model", "explanation_source",
}

LEAKAGE_TERMS = ("actual", "target", "residual", "error", "mape", "accuracy", "y_true", "difference")


def test_agent_evidence_endpoint_returns_only_allowlisted_fields(client, admin_headers):
    r = client.get("/agent/recommend/evidence?store_id=1&forecast_type=weekly", headers=admin_headers)
    assert r.status_code == 200
    body = r.json()
    assert set(body.keys()) == ALLOWED_EVIDENCE_KEYS
    assert body["predicted_sales"] is not None

    body_str = str(body).lower()
    for term in LEAKAGE_TERMS:
        assert term not in body_str, f"Evidence response leaked forbidden term: {term!r}"


def test_agent_evidence_reconciliation_ok_for_real_data(client, admin_headers):
    r = client.get("/agent/recommend/evidence?store_id=1&forecast_type=weekly", headers=admin_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["reconciliation_ok"] is True
    assert abs(
        body["baseline_model_output"] + body["net_shap_adjustment"] - body["predicted_sales"]
    ) < 1


def test_agent_evidence_respects_store_scope(client, manager_headers):
    r = client.get("/agent/recommend/evidence?store_id=1&forecast_type=weekly", headers=manager_headers)
    assert r.status_code == 403


def test_agent_evidence_endpoint_honours_a_specific_non_latest_period(client, admin_headers):
    """The evidence route must actually resolve the requested `period`, not
    silently fall back to the store's latest one — this is what lets the
    frontend hand off a specific historical period (e.g. from the Dashboard)
    into the AI Recommendations page's evidence preview."""
    forecast = client.get("/forecast/1?forecast_type=weekly", headers=admin_headers).json()
    periods = [row["period"] for row in forecast["forecasts"]]
    assert len(periods) >= 2
    latest_period, earlier_period = periods[-1], periods[0]
    assert earlier_period != latest_period

    latest_evidence = client.get(
        "/agent/recommend/evidence?store_id=1&forecast_type=weekly", headers=admin_headers
    ).json()
    assert latest_evidence["period"] == latest_period

    earlier_evidence = client.get(
        f"/agent/recommend/evidence?store_id=1&forecast_type=weekly&period={earlier_period}",
        headers=admin_headers,
    ).json()
    assert earlier_evidence["period"] == earlier_period
    assert earlier_evidence["period"] != latest_evidence["period"]


# ---- Allowlist robustness: an injected leakage-shaped artifact column ----

def test_agent_service_filters_unallowlisted_artifact_row(client, admin_headers, monkeypatch):
    """
    Simulates an upstream artifact regeneration that adds an `Actual Sales`
    (and residual/error) column to the forecast row. The prompt builder only
    ever reads a fixed set of named keys, so this extra column must never
    reach the Claude prompt or the evidence response — proving the allowlist
    holds even if the CSV shape changes upstream, not just today.
    """
    tainted = artifact_store.dss_output.copy()
    tainted["Actual Sales"] = 999999
    tainted["forecast_error"] = -123.45
    monkeypatch.setattr(artifact_store, "dss_output", tainted)

    captured = {}

    def fake_parse(*args, **kwargs):
        captured["messages"] = kwargs["messages"]
        return SimpleNamespace(parsed_output=_fake_output())

    monkeypatch.setattr("app.services.agent_service.client.messages.parse", fake_parse)

    r = client.post("/agent/recommend?store_id=1&forecast_type=weekly", headers=admin_headers)
    assert r.status_code == 200

    prompt = captured["messages"][0]["content"]
    assert "999999" not in prompt
    assert "forecast_error" not in prompt.lower()

    ev = client.get("/agent/recommend/evidence?store_id=1&forecast_type=weekly", headers=admin_headers)
    ev_body = ev.json()
    assert "Actual Sales" not in ev_body
    assert "forecast_error" not in ev_body
    assert ev_body["predicted_sales"] != 999999


# ---- Evidence-reference validation ----

def test_agent_evidence_refs_unknown_reference_is_dropped(client, admin_headers, monkeypatch):
    tainted_rec = Recommendation(
        recommendation="Staff normally.",
        detail="No unusual signal.",
        evidence_refs=["predicted_sales", "shap:not_a_real_feature", "made_up_ref"],
        caution="Review before acting.",
    )
    output = AgentOutput(staffing=tainted_rec, stock=tainted_rec, promotions=tainted_rec, summary="ok")

    monkeypatch.setattr(
        "app.services.agent_service.client.messages.parse",
        lambda *a, **k: SimpleNamespace(parsed_output=output),
    )
    r = client.post("/agent/recommend?store_id=1&forecast_type=weekly", headers=admin_headers)
    assert r.status_code == 200
    refs = r.json()["recommendations"]["staffing"]["evidence_refs"]
    assert "made_up_ref" not in refs
    assert "shap:not_a_real_feature" not in refs
    assert "predicted_sales" in refs


# ---- Forecast/SHAP consistency ----

def test_agent_forecast_shap_period_mismatch_returns_clear_error(client, admin_headers, monkeypatch):
    """If the latest forecast period has no matching local-SHAP rows (e.g. the
    two artifacts fell out of sync), generation must fail with a manager
    -readable error rather than silently pairing mismatched evidence."""
    empty_shap = artifact_store.weekly_shap_local.iloc[0:0].copy()
    monkeypatch.setattr(artifact_store, "weekly_shap_local", empty_shap)

    r = client.post("/agent/recommend?store_id=1&forecast_type=weekly", headers=admin_headers)
    assert r.status_code == 404
    assert "Traceback" not in r.text
    assert "SHAP" in r.json()["detail"]

    r2 = client.get("/agent/recommend/evidence?store_id=1&forecast_type=weekly", headers=admin_headers)
    assert r2.status_code == 404
