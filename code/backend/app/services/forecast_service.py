import numpy as np
import pandas as pd
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


def get_store_comparison(forecast_type: str, start_period: str = None, end_period: str = None) -> dict:
    """
    Cross-store aggregation of predicted vs actual sales over a period
    range, computed once via pandas groupby (never one request per store).
    Never mutates the shared store.weekly_predictions/monthly_predictions
    singletons — every step below operates on a sliced .copy().
    """
    if forecast_type == "weekly":
        df = store.weekly_predictions
    else:
        df = store.monthly_predictions

    available_periods = sorted(df["Period"].unique().tolist())

    resolved_start = start_period or available_periods[0]
    resolved_end   = end_period or available_periods[-1]

    available_set = set(available_periods)
    if resolved_start not in available_set or resolved_end not in available_set:
        raise HTTPException(
            status_code=400,
            detail=f"start_period/end_period must both be one of the available {forecast_type} periods."
        )
    if resolved_start > resolved_end:
        raise HTTPException(status_code=400, detail="start_period must not be after end_period.")

    window = df[(df["Period"] >= resolved_start) & (df["Period"] <= resolved_end)].copy()

    # Artifact-integrity checks — corruption in the precomputed data, not a
    # bad request, so these are server errors rather than concealed/silently
    # double-counted totals.
    if window.duplicated(subset=["Store", "Period"]).any():
        raise HTTPException(
            status_code=500,
            detail="Duplicate store-period records detected in the prediction artifact."
        )
    if not np.isfinite(window[["Actual Sales", "Predicted Sales"]].to_numpy(dtype=float)).all():
        raise HTTPException(
            status_code=500,
            detail="Non-finite prediction values detected in the prediction artifact."
        )

    selected_periods = sorted(window["Period"].unique().tolist())
    expected_count   = len(selected_periods)

    window["Abs Error"] = (window["Predicted Sales"] - window["Actual Sales"]).abs()

    grouped = window.groupby("Store").agg(
        total_predicted=("Predicted Sales", "sum"),
        total_actual   =("Actual Sales", "sum"),
        periods_covered=("Period", "count"),
        mae            =("Abs Error", "mean"),
    ).reset_index()

    grouped["difference"]          = grouped["total_predicted"] - grouped["total_actual"]
    grouped["absolute_difference"] = grouped["difference"].abs()
    # np.where keeps this column float64 (not object), so .round() below
    # works normally — NaN is converted to None per-record afterwards,
    # never left as a mid-pipeline object-dtype None.
    grouped["difference_pct"] = np.where(
        grouped["total_actual"] != 0,
        grouped["difference"] / grouped["total_actual"] * 100,
        np.nan,
    )
    grouped["periods_expected"] = expected_count
    grouped["is_complete"]      = grouped["periods_covered"] == expected_count

    grouped = grouped.round({
        "total_predicted"    : 2,
        "total_actual"       : 2,
        "difference"         : 2,
        "absolute_difference": 2,
        "difference_pct"     : 4,
        "mae"                : 2,
    })
    grouped = grouped.sort_values("Store").rename(columns={"Store": "store_id"})

    records = grouped.to_dict(orient="records")
    for record in records:
        if pd.isna(record["difference_pct"]):
            record["difference_pct"] = None

    return {
        "forecast_type"    : forecast_type,
        "start_period"     : resolved_start,
        "end_period"       : resolved_end,
        "available_periods": available_periods,
        "selected_periods" : selected_periods,
        "period_count"     : expected_count,
        "store_count"      : len(records),
        "stores"           : records,
    }
