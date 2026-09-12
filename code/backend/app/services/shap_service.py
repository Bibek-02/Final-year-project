from fastapi import HTTPException
from app.core.artifacts import store


def get_global_shap(forecast_type: str, top_n: int) -> dict:
    if forecast_type == "weekly":
        shap_df = store.weekly_shap_global
    else:
        shap_df = store.monthly_shap_global

    mean_shap = (
        shap_df.abs()
        .mean()
        .reset_index()
    )
    mean_shap.columns = ["Feature", "Mean_SHAP"]
    mean_shap = (
        mean_shap
        .sort_values("Mean_SHAP", ascending=False)
        .head(top_n)
        .round(4)
    )

    return {
        "forecast_type": forecast_type,
        "top_n"        : top_n,
        "features"     : mean_shap.to_dict(orient="records"),
    }


def get_local_shap(forecast_type: str, store_id: int, period: str) -> dict:
    if forecast_type == "weekly":
        local_df = store.weekly_shap_local
    else:
        local_df = store.monthly_shap_local

    # Filter by store
    local_df = local_df[local_df["Store"] == store_id].copy()

    if local_df.empty:
        raise HTTPException(
            status_code=404,
            detail=f"No local SHAP data found for Store {store_id}."
        )

    # Filter by period — most recent if not specified
    if period:
        local_df = local_df[local_df["Period"] == period]
    else:
        latest_period = local_df["Period"].max()
        local_df = local_df[local_df["Period"] == latest_period]

    if local_df.empty:
        raise HTTPException(
            status_code=404,
            detail=f"No SHAP data found for Store {store_id} period {period}."
        )

    local_df = local_df.copy()
    local_df["Abs_SHAP"] = local_df["SHAP Value"].abs()
    local_df = local_df.sort_values("Abs_SHAP", ascending=False).drop(columns=["Abs_SHAP"])
    local_df["SHAP Value"]    = local_df["SHAP Value"].round(4)
    local_df["Feature Value"] = local_df["Feature Value"].round(4)

    return {
        "store_id"      : store_id,
        "period"        : local_df["Period"].iloc[0],
        "forecast_type" : forecast_type,
        "record_count"  : len(local_df),
        "explanation"   : local_df.to_dict(orient="records"),
    }


def get_feature_importance(forecast_type: str, top_n: int) -> dict:
    if forecast_type == "weekly":
        imp_df = store.weekly_importance
    else:
        imp_df = store.monthly_importance

    result = (
        imp_df
        .sort_values("Importance", ascending=False)
        .head(top_n)
        .round(4)
    )

    return {
        "forecast_type": forecast_type,
        "top_n"        : top_n,
        "importance"   : result.to_dict(orient="records"),
    }
