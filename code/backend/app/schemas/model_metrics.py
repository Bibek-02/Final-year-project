from pydantic import BaseModel, Field, ConfigDict
from typing import Literal


class ModelComparisonRow(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    model        : str   = Field(alias="Model")
    forecast_type: str   = Field(alias="Forecast Type")
    mae          : float = Field(alias="MAE")
    rmse         : float = Field(alias="RMSE")
    mape         : float = Field(alias="MAPE")
    rmspe        : float = Field(alias="RMSPE")


class ModelComparisonResponse(BaseModel):
    filter      : str
    record_count: int
    comparison  : list[ModelComparisonRow]


class BestModelResponse(BaseModel):
    forecast_type: Literal["weekly", "monthly"]
    best_model   : str
    MAE          : float
    RMSE         : float
    MAPE         : float
    RMSPE        : float
