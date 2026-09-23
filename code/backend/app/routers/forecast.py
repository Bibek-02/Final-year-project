from fastapi import APIRouter, Query, Depends
from app.core.dependencies import get_current_user, enforce_store_scope, require_admin
from app.schemas.forecast import ForecastResponse, StoreListResponse, StoreComparisonResponse
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


@router.get("/stores/comparison", response_model=StoreComparisonResponse)
def get_store_comparison(
    forecast_type: str = Query(default="weekly", enum=["weekly", "monthly"]),
    start_period : str = Query(default=None),
    end_period   : str = Query(default=None),
    current_user = Depends(require_admin),
):
    """
    Admin-only cross-store comparison of predicted vs actual sales,
    aggregated over the selected period range. Defined BEFORE /{store_id},
    mirroring /stores/list's convention.
    """
    return forecast_service.get_store_comparison(forecast_type, start_period, end_period)


@router.get("/{store_id}", response_model=ForecastResponse)
def get_forecast(
    store_id: int,
    forecast_type: str = Query(default="weekly", enum=["weekly", "monthly"]),
    current_user = Depends(get_current_user),
):
    enforce_store_scope(current_user, store_id)
    return forecast_service.get_forecast(store_id, forecast_type)
