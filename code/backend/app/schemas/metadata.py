from pydantic import BaseModel, Field, ConfigDict
from typing import Literal


class DssOutputRow(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    store            : int   = Field(alias="Store")
    period           : str   = Field(alias="Period")
    forecast_type    : str   = Field(alias="Forecast Type")
    predicted_sales  : float = Field(alias="Predicted Sales")
    positive_factors : str   = Field(alias="Important Positive Factors")
    negative_factors : str   = Field(alias="Important Negative Factors")
    forecast_summary : str   = Field(alias="Forecast Summary")


class DssOutputResponse(BaseModel):
    store_id     : int
    forecast_type: Literal["weekly", "monthly"]
    period       : str
    record_count : int
    dss_output   : list[DssOutputRow]


class FeatureListResponse(BaseModel):
    forecast_type: Literal["weekly", "monthly"]
    feature_count: int
    features     : list[str]
