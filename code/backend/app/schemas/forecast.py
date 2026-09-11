from pydantic import BaseModel
from typing import Literal


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
