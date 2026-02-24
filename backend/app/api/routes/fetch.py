from fastapi import APIRouter, Query

from app.schemas.fetch import FetchRunListResponse, FetchRunRead
from app.services.fetch_runs import get_fetch_run, list_fetch_runs, start_and_complete_fetch_run

router = APIRouter()


@router.post("/fetch/run-now", response_model=FetchRunRead)
def run_fetch_now() -> FetchRunRead:
    return start_and_complete_fetch_run()


@router.get("/fetch/runs", response_model=FetchRunListResponse)
def get_fetch_runs(limit: int = Query(default=20, ge=1, le=100)) -> FetchRunListResponse:
    items = list_fetch_runs(limit)
    return FetchRunListResponse(items=items, count=len(items))


@router.get("/fetch/runs/{run_id}", response_model=FetchRunRead)
def get_fetch_run_by_id(run_id: int) -> FetchRunRead:
    return get_fetch_run(run_id)
