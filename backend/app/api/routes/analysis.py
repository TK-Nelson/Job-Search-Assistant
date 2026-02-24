from fastapi import APIRouter, Query

from app.schemas.analysis import AnalysisRunHistoryResponse, AnalysisRunRequest, AnalysisRunResponse
from app.services.analysis import list_analysis_runs, run_analysis

router = APIRouter()


@router.post("/analysis/run", response_model=AnalysisRunResponse)
def run_analysis_endpoint(payload: AnalysisRunRequest) -> AnalysisRunResponse:
    return run_analysis(payload.resume_version_id, payload.job_posting_id)


@router.get("/analysis/runs", response_model=AnalysisRunHistoryResponse)
def list_analysis_runs_endpoint(
    resumeVersionId: int | None = Query(default=None),
    jobPostingId: int | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
) -> AnalysisRunHistoryResponse:
    items = list_analysis_runs(resumeVersionId, jobPostingId, limit)
    return AnalysisRunHistoryResponse(items=items, count=len(items))
