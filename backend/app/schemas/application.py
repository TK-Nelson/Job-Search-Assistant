from pydantic import BaseModel


class ApplicationCreate(BaseModel):
    job_posting_id: int
    stage: str = "saved"
    applied_at: str | None = None
    target_salary: str | None = None
    notes: str | None = None
    resume_version_id: int | None = None


class ApplicationUpdate(BaseModel):
    stage: str
    applied_at: str | None = None
    target_salary: str | None = None
    notes: str | None = None


class ApplicationStageUpdate(BaseModel):
    to_stage: str
    reason: str | None = None


class ApplicationRead(BaseModel):
    id: int
    job_posting_id: int
    company_id: int
    company_name: str
    posting_title: str
    stage: str
    applied_at: str | None
    target_salary: str | None
    notes: str | None
    created_at: str
    updated_at: str
    archived_at: str | None = None
    match_score: float | None = None
    comparison_report_id: int | None = None
    industry: str | None = None
    logo_url: str | None = None


class ApplicationListResponse(BaseModel):
    items: list[ApplicationRead]
    count: int


class StageHistoryRead(BaseModel):
    id: int
    application_id: int
    from_stage: str | None
    to_stage: str
    changed_at: str
    reason: str | None


class StageHistoryResponse(BaseModel):
    items: list[StageHistoryRead]
    count: int


def map_application_row(row: tuple) -> ApplicationRead:
    return ApplicationRead(
        id=row[0],
        job_posting_id=row[1],
        company_id=row[2],
        company_name=row[3],
        posting_title=row[4],
        stage=row[5],
        applied_at=row[6],
        target_salary=row[7],
        notes=row[8],
        created_at=row[9],
        updated_at=row[10],
        archived_at=row[11] if len(row) > 11 else None,
        match_score=round(float(row[12]), 2) if len(row) > 12 and row[12] is not None else None,
        comparison_report_id=int(row[13]) if len(row) > 13 and row[13] is not None else None,
        industry=row[14] if len(row) > 14 else None,
        logo_url=row[15] if len(row) > 15 else None,
    )


def map_stage_history_row(row: tuple) -> StageHistoryRead:
    return StageHistoryRead(
        id=row[0],
        application_id=row[1],
        from_stage=row[2],
        to_stage=row[3],
        changed_at=row[4],
        reason=row[5],
    )
