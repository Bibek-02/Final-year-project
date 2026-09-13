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
    Returns the champion model per granularity exactly as recorded in
    selected_models.csv — chosen during training by lowest validation MAE,
    not re-derived here. Test-set metrics (MAE/RMSE/MAPE/RMSPE) for that
    same model are looked up from final_model_comparison.csv and returned
    alongside it for transparency; they are not what selected it.
    """
    selection = store.selected_models[
        store.selected_models["Forecast Type"].str.lower() == forecast_type.lower()
    ]

    if selection.empty:
        raise HTTPException(
            status_code=404,
            detail=f"No selected model found for forecast_type {forecast_type}."
        )

    champion = selection.iloc[0]["Selected Model"]

    df = store.model_comparison.copy()
    df = df[
        (df["Forecast Type"].str.lower() == forecast_type.lower()) &
        (df["Model"] == champion)
    ]

    if df.empty:
        raise HTTPException(
            status_code=404,
            detail=f"No comparison metrics found for champion model '{champion}' ({forecast_type})."
        )

    best = df.iloc[0]

    return {
        "forecast_type" : forecast_type,
        "best_model"    : champion,
        "MAE"           : round(float(best["MAE"]),   3),
        "RMSE"          : round(float(best["RMSE"]),  3),
        "MAPE"          : round(float(best["MAPE"]),  3),
        "RMSPE"         : round(float(best["RMSPE"]), 3),
    }
