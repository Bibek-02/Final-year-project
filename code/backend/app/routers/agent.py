from fastapi import APIRouter, Query, Depends
from app.core.dependencies import get_current_user, enforce_store_scope
from app.schemas.agent import AgentRecommendResponse, AgentEvidence
from app.services import agent_service

router = APIRouter()


@router.get("/recommend/evidence", response_model=AgentEvidence)
def get_evidence(
    store_id     : int = Query(default=1),
    forecast_type: str = Query(default="weekly", enum=["weekly", "monthly"]),
    period       : str = Query(default=None),
    current_user = Depends(get_current_user),
):
    """
    Returns the minimal, allowlisted forecast + SHAP evidence context that
    would be used to build the Claude recommendation prompt for this store
    and period (defaults to the latest available period when omitted) —
    without calling Claude. Lets the frontend show an evidence preview and
    check forecast/SHAP consistency before spending a generation request.
    """
    enforce_store_scope(current_user, store_id)
    return agent_service.get_evidence(store_id, forecast_type, period)


@router.post("/recommend", response_model=AgentRecommendResponse)
def get_recommendations(
    store_id     : int = Query(default=1),
    forecast_type: str = Query(default="weekly", enum=["weekly", "monthly"]),
    period       : str = Query(default=None),
    current_user = Depends(get_current_user),
):
    """
    Agentic AI recommendation endpoint.
    Analyses forecast + SHAP data for a store and returns
    staffing, stock, and promotion recommendations via Claude.
    """
    enforce_store_scope(current_user, store_id)
    return agent_service.get_recommendations(store_id, forecast_type, period)
