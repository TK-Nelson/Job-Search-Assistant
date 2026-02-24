from pydantic import BaseModel


def normalize_parser_confidence(value: float | int | None) -> float:
    raw = float(value or 0.0)
    if raw < 0:
        return 0.0
    if raw <= 1:
        return round(raw, 4)
    if raw <= 10:
        return round(raw / 10.0, 4)
    if raw <= 100:
        return round(raw / 100.0, 4)
    return 1.0


class ResumeVersionRead(BaseModel):
    id: int
    source_name: str
    version_tag: str
    mime_type: str
    file_ext: str
    file_path: str
    checksum_sha256: str
    notes: str | None = None
    parser_confidence: float
    created_at: str


class ResumeVersionListResponse(BaseModel):
    items: list[ResumeVersionRead]
    count: int


class ResumePasteRequest(BaseModel):
    title: str
    text: str
    notes: str | None = None


class ResumeNotesUpdate(BaseModel):
    notes: str | None = None


class ResumeConcernRead(BaseModel):
    code: str
    severity: str
    message: str
    delta_label: str | None = None
    delta_value: float | None = None


class ResumeDiagnosticsRead(BaseModel):
    resume_version_id: int
    parser_confidence: float
    concerns: list[ResumeConcernRead]
    highlight_terms: list[str]
    extracted_text: str


def map_resume_row(row: tuple) -> ResumeVersionRead:
    return ResumeVersionRead(
        id=row[0],
        source_name=row[1],
        version_tag=row[2],
        mime_type=row[3],
        file_ext=row[4],
        file_path=row[5],
        checksum_sha256=row[6],
        notes=row[7],
        parser_confidence=normalize_parser_confidence(row[8]),
        created_at=row[9],
    )
