from pydantic import BaseModel


class StageCount(BaseModel):
    stage: str
    count: int


class DashboardSummaryResponse(BaseModel):
    followed_companies_count: int
    active_postings_count: int
    recent_postings_count_7d: int
    applications_total_count: int
    new_roles_from_followed_last_run: int
    latest_fetch_run_id: int | None
    latest_fetch_completed_at: str | None
    applications_by_stage: list[StageCount]
    latest_fetch_run: dict | None
