from fastapi import APIRouter, Query, Depends
from app.core.dependencies import get_current_user, enforce_store_scope
from app.schemas.shap import GlobalShapResponse, LocalShapResponse, FeatureImportanceResponse
from app.services import shap_service

router = APIRouter()


@router.get("/global", response_model=GlobalShapResponse)
def get_global_shap(
    forecast_type: str = Query(default="weekly", enum=["weekly", "monthly"]),
    top_n: int = Query(default=15, ge=1, le=50),
    current_user = Depends(get_current_user),
):
    return shap_service.get_global_shap(forecast_type, top_n)


@router.get("/local", response_model=LocalShapResponse)
def get_local_shap(
    forecast_type: str = Query(default="weekly", enum=["weekly", "monthly"]),
    store_id      : int = Query(default=1),
    period        : str = Query(default=None),
    current_user = Depends(get_current_user),
):
    enforce_store_scope(current_user, store_id)
    return shap_service.get_local_shap(forecast_type, store_id, period)


@router.get("/importance", response_model=FeatureImportanceResponse)
def get_feature_importance(
    forecast_type: str = Query(default="weekly", enum=["weekly", "monthly"]),
    top_n: int = Query(default=15, ge=1, le=50),
    current_user = Depends(get_current_user),
):
    return shap_service.get_feature_importance(forecast_type, top_n)
