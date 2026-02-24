from fastapi import APIRouter, Query

from app.schemas.audit import AuditEventListResponse
from app.services.audit import list_audit_events

router = APIRouter()


@router.get("/audit-events", response_model=AuditEventListResponse)
def get_audit_events(
    limit: int = Query(default=100, ge=1, le=500),
    eventType: str | None = Query(default=None),
) -> AuditEventListResponse:
    items = list_audit_events(limit=limit, event_type=eventType)
    return AuditEventListResponse(items=items, count=len(items))
