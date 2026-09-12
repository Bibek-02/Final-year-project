from pydantic import BaseModel, Field, ConfigDict
from typing import Literal


class GlobalShapFeature(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    feature  : str   = Field(alias="Feature")
    mean_shap: float = Field(alias="Mean_SHAP")


class GlobalShapResponse(BaseModel):
    forecast_type: Literal["weekly", "monthly"]
    top_n        : int
    features     : list[GlobalShapFeature]


class LocalShapRow(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    store        : int   = Field(alias="Store")
    period       : str   = Field(alias="Period")
    feature      : str   = Field(alias="Feature")
    feature_value: float = Field(alias="Feature Value")
    shap_value   : float = Field(alias="SHAP Value")
    effect       : str   = Field(alias="Effect")


class LocalShapResponse(BaseModel):
    store_id     : int
    period       : str
    forecast_type: Literal["weekly", "monthly"]
    record_count : int
    explanation  : list[LocalShapRow]


class FeatureImportanceRow(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    feature   : str   = Field(alias="Feature")
    importance: float = Field(alias="Importance")


class FeatureImportanceResponse(BaseModel):
    forecast_type: Literal["weekly", "monthly"]
    top_n        : int
    importance   : list[FeatureImportanceRow]
