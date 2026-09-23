from datetime import datetime
from pydantic import BaseModel
from typing import Literal

Urgency = Literal["high", "medium", "low"]


class Recommendation(BaseModel):
    recommendation: str
    detail: str
    urgency: Urgency
    # Additive fields — Dashboard.jsx's inline RecommendationCard widget only
    # reads `.summary`/`.urgency` off this model, so extending it here does
    # not require any change on that page.
    evidence_refs: list[str] = []
    caution: str = ""


class AgentOutput(BaseModel):
    staffing   : Recommendation
    stock      : Recommendation
    promotions : Recommendation
    summary    : str
    limitations: list[str] = []


class AgentRecommendResponse(BaseModel):
    store_id       : int
    period         : str
    forecast_type  : Literal["weekly", "monthly"]
    predicted_sales: float
    recommendations: AgentOutput
    # Backend-populated metadata — never trusted to the LLM's own output.
    generated_at   : datetime
    provider       : str
    model          : str
    prompt_version : str


class DriverEvidence(BaseModel):
    feature         : str
    readable_feature: str
    shap_value      : float


class AgentEvidence(BaseModel):
    """
    The minimal, allowlisted recommendation context — the same safe object
    used to build the Claude prompt is returned here for the frontend's
    pre-generation evidence preview. No actual/target/future sales field
    exists on this model by construction.
    """
    store_id              : int
    forecast_type         : Literal["weekly", "monthly"]
    period                : str
    predicted_sales        : float
    baseline_model_output  : float
    net_shap_adjustment    : float
    top_positive_drivers   : list[DriverEvidence]
    top_negative_drivers   : list[DriverEvidence]
    # The exact SHAP rows (<=8, sorted by |SHAP value|) made available to the
    # Claude prompt — lets the frontend resolve any "shap:<feature>"
    # evidence_refs a recommendation cites back to a trusted value, without
    # trusting a number reproduced by the model itself.
    shap_drivers           : list[DriverEvidence]
    shap_feature_count     : int
    reconciliation_ok      : bool
    forecast_model         : str = "XGBoost"
    explanation_source     : str = "Precomputed local SHAP"
