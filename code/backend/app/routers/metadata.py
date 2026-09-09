from fastapi import APIRouter, HTTPException, Query, Depends
from app.core.artifacts import store
from app.core.dependencies import get_current_user, enforce_store_scope
from app.schemas.metadata import DssOutputResponse, FeatureListResponse

router = APIRouter()


@router.get("")
def get_metadata(current_user = Depends(get_current_user)):
    # Static project metadata (model_metadata.json) — no fixed schema here,
    # it's an artefact echoed as-is rather than an API contract.
    return store.model_metadata


@router.get("/dss-output", response_model=DssOutputResponse)
def get_dss_output(
    forecast_type: str = Query(default="weekly", enum=["weekly", "monthly"]),
    store_id     : int = Query(default=1),
    period       : str = Query(default=None),
    current_user = Depends(get_current_user),
):
    """
    Returns DSS output for a store. If period is not specified, defaults to
    the most recent period — matching the default rule used by /shap/local
    so both endpoints describe the same forecast instance.
    """
    enforce_store_scope(current_user, store_id)

    df = store.dss_output.copy()

    df = df[
        (df["Forecast Type"].str.lower() == forecast_type.lower()) &
        (df["Store"] == store_id)
    ]

    if df.empty:
        raise HTTPException(
            status_code=404,
            detail=f"No DSS output found for Store {store_id} {forecast_type}."
        )

    if period:
        df = df[df["Period"] == period]
    else:
        df = df[df["Period"] == df["Period"].max()]

    if df.empty:
        raise HTTPException(
            status_code=404,
            detail=f"No DSS output found for Store {store_id} {forecast_type} period {period}."
        )

    return {
        "store_id"     : store_id,
        "forecast_type": forecast_type,
        "period"       : df["Period"].iloc[0],
        "record_count" : len(df),
        "dss_output"   : df.to_dict(orient="records"),
    }


@router.get("/features", response_model=FeatureListResponse)
def get_feature_list(
    forecast_type: str = Query(default="weekly", enum=["weekly", "monthly"]),
    current_user = Depends(get_current_user),
):
    if forecast_type == "weekly":
        features = store.weekly_features
    else:
        features = store.monthly_features

    return {
        "forecast_type" : forecast_type,
        "feature_count" : len(features),
        "features"      : features,
    }
