from pydantic import BaseModel
from typing import Literal, Optional


class ForecastRecord(BaseModel):
    period: str
    actual_sales: float
    prediction: float


class ForecastResponse(BaseModel):
    store_id: int
    forecast_type: Literal["weekly", "monthly"]
    record_count: int
    forecasts: list[ForecastRecord]


class StoreListResponse(BaseModel):
    forecast_type: Literal["weekly", "monthly"]
    store_count: int
    store_ids: list[int]


class StoreComparisonRow(BaseModel):
    store_id           : int
    total_predicted    : float
    total_actual       : float
    difference         : float
    absolute_difference: float
    difference_pct     : Optional[float] = None
    mae                : float
    periods_covered    : int
    periods_expected   : int
    is_complete        : bool


class StoreComparisonResponse(BaseModel):
    forecast_type    : Literal["weekly", "monthly"]
    start_period     : str
    end_period       : str
    # Full period list for this granularity — populates period dropdowns
    # regardless of the currently selected range.
    available_periods: list[str]
    # Periods actually inside [start_period, end_period] — the coverage
    # denominator (periods_expected on each row).
    selected_periods : list[str]
    period_count     : int
    store_count      : int
    stores           : list[StoreComparisonRow]
