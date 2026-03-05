import json
from typing import Any
from typing import Literal
from pydantic import BaseModel, model_validator

from app.schemas.analysis import AnalysisRunResponse


class ComparisonRunRequest(BaseModel):
    source_company_id: int | None = None
    source_company_name: str | None = None
    source_url: str | None = None
    title: str | None = None
    description_text: str
    resume_version_id: int
    evaluation_mode: Literal["chatgpt_api", "local_engine"] = "chatgpt_api"

    @model_validator(mode="after")
    def validate_source(self):
        if self.source_company_id is None and not (self.source_company_name or "").strip():
            raise ValueError("One of source_company_id or source_company_name is required.")
        if len((self.description_text or "").strip()) < 40:
            raise ValueError("description_text must contain at least 40 characters.")
        return self


class ComparisonUrlScrapeRequest(BaseModel):
    source_url: str


class ComparisonUrlScrapeResponse(BaseModel):
    source_url: str
    inferred_company_name: str | None = None
    inferred_title: str | None = None
    description_text: str
    extracted_characters: int
    truncation_applied: bool = False


class ComparisonRunResponse(BaseModel):
    comparison_report_id: int
    job_posting_id: int
    evaluation_source: Literal["chatgpt_api", "local_engine"]
    fallback_reason: str | None = None
    analysis: AnalysisRunResponse
    created_at: str


class ComparisonReportListItem(BaseModel):
    id: int
    job_posting_id: int
    company_name: str
    title: str
    source_url: str | None
    overall_score: float
    evaluation_source: Literal["chatgpt_api", "local_engine"] = "local_engine"
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
    evaluation_source: Literal["chatgpt_api", "local_engine"] = "local_engine"
    chatgpt_prompt_text: str | None = None
    chatgpt_response_present: bool = False
    chatgpt_response_json: dict[str, Any] | None = None
    applied_decision: str
    linked_application_id: int | None
    created_at: str
    analysis: AnalysisRunResponse


class ComparisonChatGptImportRequest(BaseModel):
    response_text: str


class ComparisonChatGptImportResponse(BaseModel):
    comparison_report_id: int
    analysis_run_id: int
    overall_score: float


class ComparisonDecisionRequest(BaseModel):
    applied: bool


class ComparisonDecisionResponse(BaseModel):
    comparison_report_id: int
    applied_decision: str
    application_id: int | None


class ComparisonParsedInfoUpdateRequest(BaseModel):
    company_name: str | None = None
    title: str | None = None
    location: str | None = None


class ComparisonParsedInfoUpdateResponse(BaseModel):
    comparison_report_id: int
    company_name: str
    title: str
    location: str | None


def map_comparison_list_item(row: tuple) -> ComparisonReportListItem:
    return ComparisonReportListItem(
        id=row[0],
        job_posting_id=row[1],
        company_name=row[2],
        title=row[3],
        source_url=row[4],
        overall_score=round(float(row[5] or 0.0), 2),
        evaluation_source=(str(row[6]) if len(row) > 6 and row[6] in ("chatgpt_api", "local_engine") else "local_engine"),
        applied_decision=row[7],
        linked_application_id=row[8],
        created_at=row[9],
    )


def parse_json(value: str, fallback):
    if not value:
        return fallback
    try:
        return json.loads(value)
    except Exception:
        return fallback
