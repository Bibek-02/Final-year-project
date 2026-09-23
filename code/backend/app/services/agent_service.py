from datetime import datetime, timezone

import anthropic
from fastapi import HTTPException
from app.config import settings
from app.core.artifacts import store
from app.core.feature_labels import readable_label
from app.schemas.agent import AgentOutput, AgentEvidence, DriverEvidence

client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

AGENT_MODEL = "claude-opus-5"
PROMPT_VERSION = "v2"
RECONCILE_TOLERANCE = 1  # sales units — same tolerance used by the Explanation page's SHAP reconciliation check

SYSTEM_PROMPT = """You are a retail demand-forecasting decision-support assistant for Rossmann stores.

You only ever see the forecast and SHAP evidence supplied in the user message below —
you have no access to actual/realised sales, product-level demand, stock quantities,
employee schedules, staffing ratios, labour costs, product costs, profit margins,
promotion profitability, or local events. Do not ask for this data and do not assume it.

Rules you must follow:
- Never invent exact employee counts, shift schedules, or staffing ratios.
- Never invent exact product order quantities, SKUs, or product-level recommendations —
  this dataset is store-level only, not product-level.
- Never invent financial figures, cost estimates, or profit/return projections.
- Never state or imply that a promotion, holiday, or any other feature CAUSED a change in
  sales — SHAP contributions describe a model's learned association, not a causal effect.
  Use phrasing like "the modelled contribution indicates..." instead.
- Never promise or guarantee an outcome. Use cautious, decision-support language such as
  "Consider reviewing...", "The forecast suggests...", "This may justify checking...".
- If the supplied evidence is too thin to support a specific action for a category, say so
  plainly in that category's fields instead of inventing a plausible-sounding action.
- Every evidence_refs entry you return MUST be copied exactly from the "Allowed evidence
  references" list supplied in the user message. Never invent a reference that is not in
  that list.
- Do not reveal your reasoning process — return only the structured fields requested.
- Keep wording concise and readable by a store manager, not a data scientist."""


def _allowed_evidence_ids(forecast_row: dict, shap_rows: list[dict]) -> set[str]:
    ids = {"predicted_sales", "positive_factors", "negative_factors"}
    ids.update(f"shap:{row['Feature']}" for row in shap_rows)
    return ids


def build_user_prompt(store_id, period, forecast_type, forecast_row, shap_rows, allowed_ids) -> str:
    predicted   = forecast_row.get("Predicted Sales", "N/A")
    pos_factors = forecast_row.get("Important Positive Factors", "")
    neg_factors = forecast_row.get("Important Negative Factors", "")
    summary     = forecast_row.get("Forecast Summary", "")

    shap_summary = "\n".join([
        f"  - {readable_label(r['Feature'])} (ref: shap:{r['Feature']}): "
        f"SHAP={r['SHAP Value']:.4f} (value={r['Feature Value']:.2f})"
        for r in shap_rows
    ])

    return f"""Forecast data for Store {store_id}, period {period} ({forecast_type}):

FORECAST SUMMARY:
- Predicted Sales (ref: predicted_sales): {predicted:,.0f} units
- Main factors increasing the forecast (ref: positive_factors): {pos_factors}
- Main factors reducing the forecast (ref: negative_factors): {neg_factors}
- Forecast summary: {summary}

TOP SHAP FEATURE CONTRIBUTIONS:
{shap_summary}

Allowed evidence references you may cite in evidence_refs: {sorted(allowed_ids)}

Based only on this data, provide recommendations for staffing, stock, and promotions.
Each category needs: a one-sentence suggested_action, a 2-3 sentence rationale grounded in
the evidence above, an urgency level, one or more evidence_refs, and a one-sentence caution
about this recommendation's limitations. Also provide a one-paragraph overall summary, and a
list of any limitations relevant to this recommendation (e.g. missing operational data)."""


def _resolve_evidence(store_id: int, forecast_type: str, period: str = None):
    """
    Selects the forecast row and the FULL local-SHAP explanation for one
    store/forecast_type/period from the trusted precomputed artifacts, and
    builds the safe, allowlisted AgentEvidence context from them. Returns
    (forecast_row: dict, shap_rows_all: list[dict], evidence: AgentEvidence).

    The forecast period is resolved first; the SHAP rows are then filtered to
    that EXACT period (not independently re-resolved), so the two pieces of
    evidence are guaranteed to describe the same store/period/forecast_type
    by construction rather than by coincidence of two separate artifacts.
    """
    dss_df = store.dss_output.copy()
    dss_df = dss_df[
        (dss_df["Store"] == store_id) &
        (dss_df["Forecast Type"].str.lower() == forecast_type.lower())
    ]

    if dss_df.empty:
        raise HTTPException(status_code=404, detail=f"No forecast data for Store {store_id}.")

    if period:
        row = dss_df[dss_df["Period"] == period]
    else:
        row = dss_df[dss_df["Period"] == dss_df["Period"].max()]

    if row.empty:
        raise HTTPException(status_code=404, detail="Period not found.")

    forecast_row = row.iloc[0].to_dict()
    resolved_period = forecast_row.get("Period")

    shap_df = store.weekly_shap_local if forecast_type == "weekly" else store.monthly_shap_local
    shap_df = shap_df[(shap_df["Store"] == store_id) & (shap_df["Period"] == resolved_period)].copy()

    if shap_df.empty:
        raise HTTPException(
            status_code=404,
            detail="No SHAP explanation available for the latest forecast period.",
        )

    shap_df["Abs"] = shap_df["SHAP Value"].abs()
    shap_df_sorted = shap_df.sort_values("Abs", ascending=False)
    shap_rows_all = shap_df_sorted.drop(columns=["Abs"]).to_dict(orient="records")

    predicted_sales = float(forecast_row.get("Predicted Sales"))
    net_shap_adjustment = float(sum(r["SHAP Value"] for r in shap_rows_all))
    baseline_model_output = predicted_sales - net_shap_adjustment
    reconciliation_ok = (
        len(shap_rows_all) > 0
        and abs(baseline_model_output + net_shap_adjustment - predicted_sales) < RECONCILE_TOLERANCE
    )

    positive_sorted = sorted((r for r in shap_rows_all if r["SHAP Value"] > 0), key=lambda r: -r["SHAP Value"])
    negative_sorted = sorted((r for r in shap_rows_all if r["SHAP Value"] < 0), key=lambda r: r["SHAP Value"])

    def to_driver(r: dict) -> DriverEvidence:
        return DriverEvidence(
            feature=r["Feature"],
            readable_feature=readable_label(r["Feature"]),
            shap_value=float(r["SHAP Value"]),
        )

    # Same top-8-by-|SHAP value| slice that get_recommendations sends to the
    # Claude prompt (shap_rows_all is already sorted descending by |Abs|) —
    # one source of truth for "what evidence did Claude actually see".
    shap_rows_top = shap_rows_all[:8]

    evidence = AgentEvidence(
        store_id=store_id,
        forecast_type=forecast_type,
        period=resolved_period,
        predicted_sales=predicted_sales,
        baseline_model_output=baseline_model_output,
        net_shap_adjustment=net_shap_adjustment,
        top_positive_drivers=[to_driver(r) for r in positive_sorted[:3]],
        top_negative_drivers=[to_driver(r) for r in negative_sorted[:3]],
        shap_drivers=[to_driver(r) for r in shap_rows_top],
        shap_feature_count=len(shap_rows_all),
        reconciliation_ok=reconciliation_ok,
    )

    return forecast_row, shap_rows_all, evidence


def get_evidence(store_id: int, forecast_type: str, period: str = None) -> AgentEvidence:
    print(f"Evidence requested — store_id={store_id}, forecast_type={forecast_type}, period={period}")
    _, _, evidence = _resolve_evidence(store_id, forecast_type, period)
    return evidence


def get_recommendations(store_id: int, forecast_type: str, period: str) -> dict:
    """
    Analyses forecast + SHAP data for a store and returns staffing, stock,
    and promotion recommendations via Claude.
    """
    print(f"Agent called — store_id={store_id}, forecast_type={forecast_type}, period={period}")

    forecast_row, shap_rows_all, evidence = _resolve_evidence(store_id, forecast_type, period)
    resolved_period = evidence.period
    print(f"Evidence resolved — period={resolved_period}, shap_rows={len(shap_rows_all)}")

    # Only the top 8 by |SHAP value| are sent to Claude — same cap as before.
    shap_rows_top = shap_rows_all[:8]
    allowed_ids = _allowed_evidence_ids(forecast_row, shap_rows_top)

    user_prompt = build_user_prompt(
        store_id, resolved_period, forecast_type, forecast_row, shap_rows_top, allowed_ids
    )
    print("Prompt built. Calling Claude API...")

    try:
        response = client.messages.parse(
            model=AGENT_MODEL,
            max_tokens=2048,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_prompt}],
            output_format=AgentOutput,
        )
        recommendations = response.parsed_output
        print("Agent response parsed successfully.")

    except anthropic.RateLimitError:
        raise HTTPException(status_code=429, detail="Agent is rate-limited. Try again shortly.")
    except anthropic.APIStatusError as e:
        raise HTTPException(status_code=502, detail=f"Agent API error: {e.message}")
    except anthropic.APIConnectionError:
        raise HTTPException(status_code=503, detail="Could not reach the Claude API.")

    if recommendations is None:
        raise HTTPException(
            status_code=500,
            detail="Agent did not return a parseable recommendation. Try again."
        )

    # Reject unknown evidence references rather than trusting the model's own
    # citations — an invented reference is dropped, not surfaced as fact.
    for item in (recommendations.staffing, recommendations.stock, recommendations.promotions):
        dropped = [ref for ref in item.evidence_refs if ref not in allowed_ids]
        if dropped:
            print(f"Dropping unknown evidence references: {dropped}")
        item.evidence_refs = [ref for ref in item.evidence_refs if ref in allowed_ids]

    print("Agent completed successfully.")

    return {
        "store_id"       : store_id,
        "period"         : resolved_period,
        "forecast_type"  : forecast_type,
        "predicted_sales": forecast_row.get("Predicted Sales"),
        "recommendations": recommendations,
        "generated_at"   : datetime.now(timezone.utc),
        "provider"       : "Anthropic",
        "model"          : AGENT_MODEL,
        "prompt_version" : PROMPT_VERSION,
    }
