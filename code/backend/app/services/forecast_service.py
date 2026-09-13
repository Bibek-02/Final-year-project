from fastapi import HTTPException
from app.core.artifacts import store


def list_available_stores(forecast_type: str) -> dict:
    if forecast_type == "weekly":
        df = store.weekly_predictions
    else:
        df = store.monthly_predictions

    if df is None:
        return {"forecast_type": forecast_type, "store_count": 0, "store_ids": []}

    store_ids = sorted(df["Store"].unique().tolist())

    return {
        "forecast_type": forecast_type,
        "store_count"  : len(store_ids),
        "store_ids"    : store_ids,
    }


def get_forecast(store_id: int, forecast_type: str) -> dict:
    """
    Returns precomputed XGBoost predictions for a given store.
    Fields are normalised to period / actual_sales / prediction regardless
    of granularity, so callers never need to branch on forecast_type.
    """
    if forecast_type == "weekly":
        df = store.weekly_predictions
    else:
        df = store.monthly_predictions

    store_df = df[df["Store"] == store_id].copy()

    if store_df.empty:
        raise HTTPException(
            status_code=404,
            detail=f"No forecast data found for Store {store_id}."
        )

    store_df["Period"]          = store_df["Period"].astype(str)
    store_df["Predicted Sales"] = store_df["Predicted Sales"].round(2)
    store_df["Actual Sales"]    = store_df["Actual Sales"].round(2)

    store_df = store_df.rename(columns={
        "Period"         : "period",
        "Actual Sales"   : "actual_sales",
        "Predicted Sales": "prediction",
    })
    records = store_df[["period", "actual_sales", "prediction"]].to_dict(orient="records")

    return {
        "store_id"     : store_id,
        "forecast_type": forecast_type,
        "record_count" : len(records),
        "forecasts"    : records,
    }
