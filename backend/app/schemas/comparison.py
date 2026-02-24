import json
from pydantic import BaseModel, model_validator

from app.schemas.analysis import AnalysisRunResponse


class ComparisonRunRequest(BaseModel):
    source_company_id: int | None = None
    source_company_name: str | None = None
    source_url: str | None = None
    title: str | None = None
    description_text: str
    resume_version_id: int

    @model_validator(mode="after")
    def validate_source(self):
        if self.source_company_id is None and not (self.source_company_name or "").strip():
            raise ValueError("One of source_company_id or source_company_name is required.")
        if len((self.description_text or "").strip()) < 40:
            raise ValueError("description_text must contain at least 40 characters.")
        return self


class ComparisonRunResponse(BaseModel):
    comparison_report_id: int
    job_posting_id: int
    analysis: AnalysisRunResponse
    created_at: str


class ComparisonReportListItem(BaseModel):
    id: int
    job_posting_id: int
    company_name: str
    title: str
    source_url: str | None
    overall_score: float
    applied_decision: str
    linked_application_id: int | None
    created_at: str


class ComparisonReportListResponse(BaseModel):
    items: list[ComparisonReportListItem]
    count: int


class ComparisonReportRead(BaseModel):
    id: int
    job_posting_id: int
    resume_version_id: int
    analysis_run_id: int
    source_company_input: str | None
    source_url_input: str | None
    company_name: str
    title: str
    canonical_url: str
    applied_decision: str
    linked_application_id: int | None
    created_at: str
    analysis: AnalysisRunResponse


class ComparisonDecisionRequest(BaseModel):
    applied: bool


class ComparisonDecisionResponse(BaseModel):
    comparison_report_id: int
    applied_decision: str
    application_id: int | None


def map_comparison_list_item(row: tuple) -> ComparisonReportListItem:
    return ComparisonReportListItem(
        id=row[0],
        job_posting_id=row[1],
        company_name=row[2],
        title=row[3],
        source_url=row[4],
        overall_score=round(float(row[5] or 0.0), 2),
        applied_decision=row[6],
        linked_application_id=row[7],
        created_at=row[8],
    )


def parse_json(value: str, fallback):
    if not value:
        return fallback
    try:
        return json.loads(value)
    except Exception:
        return fallback
