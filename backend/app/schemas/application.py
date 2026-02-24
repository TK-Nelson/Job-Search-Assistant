from pydantic import BaseModel


class ApplicationCreate(BaseModel):
    job_posting_id: int
    stage: str = "saved"
    applied_at: str | None = None
    target_salary: str | None = None
    notes: str | None = None


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
    company_name: str
    posting_title: str
    stage: str
    applied_at: str | None
    target_salary: str | None
    notes: str | None
    created_at: str
    updated_at: str


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
        company_name=row[2],
        posting_title=row[3],
        stage=row[4],
        applied_at=row[5],
        target_salary=row[6],
        notes=row[7],
        created_at=row[8],
        updated_at=row[9],
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
