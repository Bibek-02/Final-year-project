import anthropic
from fastapi import HTTPException
from app.config import settings
from app.core.artifacts import store
from app.core.feature_labels import readable_label
from app.schemas.agent import AgentOutput

client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

AGENT_MODEL = "claude-opus-5"


def build_agent_prompt(store_id, period, forecast_type, forecast_row, shap_rows):
    predicted   = forecast_row.get("Predicted Sales", "N/A")
    pos_factors = forecast_row.get("Important Positive Factors", "")
    neg_factors = forecast_row.get("Important Negative Factors", "")
    summary     = forecast_row.get("Forecast Summary", "")

    shap_summary = "\n".join([
        f"  - {readable_label(r['Feature'])}: SHAP={r['SHAP Value']:.4f} (value={r['Feature Value']:.2f})"
        for r in shap_rows[:8]
    ])

    return f"""You are a retail demand forecasting decision support agent for Rossmann stores.

You have been given the following forecast data for Store {store_id}, period {period} ({forecast_type}):

FORECAST SUMMARY:
- Predicted Sales: {predicted:,.0f} units
- Main factors increasing the forecast: {pos_factors}
- Main factors reducing the forecast: {neg_factors}
- Forecast summary: {summary}

TOP SHAP FEATURE CONTRIBUTIONS:
{shap_summary}

Based on this data, provide specific actionable recommendations for staffing, stock,
and promotions. Each recommendation needs a one-sentence recommendation, a 2-3 sentence
explanation grounded in the forecast data above, and an urgency level. Also provide a
one-paragraph overall summary for the store manager."""


def get_recommendations(store_id: int, forecast_type: str, period: str) -> dict:
    """
    Agentic AI recommendation endpoint logic.
    Analyses forecast + SHAP data for a store and returns
    staffing, stock, and promotion recommendations via Claude.
    """
    print(f"Agent called — store_id={store_id}, forecast_type={forecast_type}, period={period}")

    #  Get DSS output for this store
    dss_df = store.dss_output.copy()
    dss_df = dss_df[
        (dss_df["Store"] == store_id) &
        (dss_df["Forecast Type"].str.lower() == forecast_type.lower())
    ]

    if dss_df.empty:
        raise HTTPException(
            status_code=404,
            detail=f"No forecast data for Store {store_id}."
        )

    if period:
        row = dss_df[dss_df["Period"] == period]
    else:
        row = dss_df[dss_df["Period"] == dss_df["Period"].max()]

    if row.empty:
        raise HTTPException(status_code=404, detail="Period not found.")

    forecast_row = row.iloc[0].to_dict()
    print(f"Forecast row found — period={forecast_row.get('Period')}")

    #  Get local SHAP for this store
    if forecast_type == "weekly":
        shap_df = store.weekly_shap_local
    else:
        shap_df = store.monthly_shap_local

    shap_df = shap_df[shap_df["Store"] == store_id].copy()

    if period:
        shap_df = shap_df[shap_df["Period"] == period]
    else:
        shap_df = shap_df[shap_df["Period"] == shap_df["Period"].max()]

    shap_df["Abs"] = shap_df["SHAP Value"].abs()
    shap_df = shap_df.sort_values("Abs", ascending=False).head(8)
    shap_rows = shap_df.to_dict(orient="records")
    print(f"SHAP rows found: {len(shap_rows)}")

    # Build prompt
    prompt = build_agent_prompt(
        store_id, forecast_row.get("Period", period),
        forecast_type, forecast_row, shap_rows
    )
    print("Prompt built. Calling Claude API...")

    #  Call Claude API — output_format guarantees a schema-conformant response,
    #  so no fence-stripping or manual JSON parsing is needed.
    try:
        response = client.messages.parse(
            model=AGENT_MODEL,
            max_tokens=2048,
            messages=[{"role": "user", "content": prompt}],
            output_format=AgentOutput,
        )
        recommendations = response.parsed_output
        print("Agent response parsed successfully.")

    except anthropic.RateLimitError as e:
        raise HTTPException(status_code=429, detail="Agent is rate-limited. Try again shortly.")
    except anthropic.APIStatusError as e:
        raise HTTPException(status_code=502, detail=f"Agent API error: {e.message}")
    except anthropic.APIConnectionError as e:
        raise HTTPException(status_code=503, detail="Could not reach the Claude API.")

    if recommendations is None:
        raise HTTPException(
            status_code=500,
            detail="Agent did not return a parseable recommendation. Try again."
        )

    print("Agent completed successfully.")

    return {
        "store_id"       : store_id,
        "period"         : forecast_row.get("Period"),
        "forecast_type"  : forecast_type,
        "predicted_sales": forecast_row.get("Predicted Sales"),
        "recommendations": recommendations,
    }
