from fastapi import APIRouter, HTTPException, Query, Depends
from app.core.artifacts import store
from app.core.dependencies import get_current_user
from app.schemas.model_metrics import ModelComparisonResponse, BestModelResponse

router = APIRouter()


@router.get("/compare", response_model=ModelComparisonResponse)
def get_model_comparison(
    forecast_type: str = Query(default=None, enum=["weekly", "monthly"]),
    current_user = Depends(get_current_user),
):
    """
    Returns the final model comparison table (MA vs RF vs XGBoost).
    Used for the model comparison screen in the DSS frontend.
    Optionally filter by forecast_type.
    """
    df = store.model_comparison.copy()

    if forecast_type:
        df = df[df["Forecast Type"].str.lower() == forecast_type.lower()]

    df = df.round(3)

    return {
        "filter"        : forecast_type or "all",
        "record_count"  : len(df),
        "comparison"    : df.to_dict(orient="records"),
    }


@router.get("/best", response_model=BestModelResponse)
def get_best_model(
    forecast_type: str = Query(default="weekly", enum=["weekly", "monthly"]),
    current_user = Depends(get_current_user),
):
    """
    Returns the single best model per granularity based on lowest RMSE.
    Used to highlight the champion model in the DSS dashboard header.
    """
    df = store.model_comparison.copy()
    df = df[df["Forecast Type"].str.lower() == forecast_type.lower()]

    if df.empty:
        raise HTTPException(
            status_code=404,
            detail=f"No model comparison data found for forecast_type {forecast_type}."
        )

    best = df.sort_values("RMSE").iloc[0]

    return {
        "forecast_type" : forecast_type,
        "best_model"    : best["Model"],
        "MAE"           : round(float(best["MAE"]),   3),
        "RMSE"          : round(float(best["RMSE"]),  3),
        "MAPE"          : round(float(best["MAPE"]),  3),
        "RMSPE"         : round(float(best["RMSPE"]), 3),
    }
