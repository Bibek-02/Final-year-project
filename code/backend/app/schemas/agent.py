from pydantic import BaseModel
from typing import Literal

Urgency = Literal["high", "medium", "low"]


class Recommendation(BaseModel):
    recommendation: str
    detail: str
    urgency: Urgency


class AgentOutput(BaseModel):
    staffing   : Recommendation
    stock      : Recommendation
    promotions : Recommendation
    summary    : str


class AgentRecommendResponse(BaseModel):
    store_id       : int
    period         : str
    forecast_type  : Literal["weekly", "monthly"]
    predicted_sales: float
    recommendations: AgentOutput
