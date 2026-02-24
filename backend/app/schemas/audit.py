from pydantic import BaseModel


class AuditEventRead(BaseModel):
    id: int
    event_type: str
    entity_type: str
    entity_id: str
    correlation_id: str | None
    payload_json: str
    created_at: str


class AuditEventListResponse(BaseModel):
    items: list[AuditEventRead]
    count: int
