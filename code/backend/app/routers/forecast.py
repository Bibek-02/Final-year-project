from fastapi import APIRouter, Query, Depends
from app.core.dependencies import get_current_user, enforce_store_scope
from app.schemas.forecast import ForecastResponse, StoreListResponse
from app.services import forecast_service

router = APIRouter()


@router.get("/stores/list", response_model=StoreListResponse)
def list_available_stores(
    forecast_type: str = Query(default="weekly", enum=["weekly", "monthly"]),
    current_user = Depends(get_current_user),
):
    """
    Returns the list of store IDs available in the test predictions.
    Must be defined BEFORE /{store_id} to avoid route conflict.
    """
    return forecast_service.list_available_stores(forecast_type)


@router.get("/{store_id}", response_model=ForecastResponse)
def get_forecast(
    store_id: int,
    forecast_type: str = Query(default="weekly", enum=["weekly", "monthly"]),
    current_user = Depends(get_current_user),
):
    enforce_store_scope(current_user, store_id)
    return forecast_service.get_forecast(store_id, forecast_type)
