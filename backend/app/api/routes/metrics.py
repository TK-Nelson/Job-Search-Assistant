from fastapi import APIRouter

from app.schemas.metrics import MetricsSummaryResponse
from app.services.performance_metrics import summarize_metrics

router = APIRouter()


@router.get("/metrics/summary", response_model=MetricsSummaryResponse)
def get_metrics_summary() -> MetricsSummaryResponse:
    return MetricsSummaryResponse(**summarize_metrics())
