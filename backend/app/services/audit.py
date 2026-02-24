from __future__ import annotations

import json
import sqlite3

from fastapi import HTTPException

from app.core.observability import get_correlation_id, log_error, log_info
from app.db.database import get_connection
from app.schemas.audit import AuditEventRead


def write_audit_event(event_type: str, entity_type: str, entity_id: str, payload: dict | None = None) -> None:
    payload_json = json.dumps(payload or {})
    correlation_id = get_correlation_id() or None

    try:
        with get_connection() as conn:
            conn.execute(
                """
                INSERT INTO audit_events (event_type, entity_type, entity_id, correlation_id, payload_json)
                VALUES (?, ?, ?, ?, ?)
                """,
                (event_type, entity_type, entity_id, correlation_id, payload_json),
            )
            conn.commit()
        log_info("audit", "Audit event recorded", entity_type=entity_type, entity_id=entity_id)
    except sqlite3.OperationalError as exc:
        log_error("audit", f"Failed to write audit event: {exc}", entity_type=entity_type, entity_id=entity_id)


def list_audit_events(limit: int = 100, event_type: str | None = None) -> list[AuditEventRead]:
    safe_limit = max(1, min(limit, 500))
    query = """
        SELECT id, event_type, entity_type, entity_id, correlation_id, payload_json, created_at
        FROM audit_events
    """
    params: list = []
    if event_type:
        query += " WHERE event_type = ?"
        params.append(event_type)
    query += " ORDER BY id DESC LIMIT ?"
    params.append(safe_limit)

    try:
        with get_connection() as conn:
            rows = conn.execute(query, tuple(params)).fetchall()
    except sqlite3.OperationalError as exc:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "VALIDATION_ERROR",
                "message": "Database is not initialized. Run /api/v1/db/init first.",
                "details": {"reason": str(exc)},
            },
        )

    return [
        AuditEventRead(
            id=row[0],
            event_type=row[1],
            entity_type=row[2],
            entity_id=row[3],
            correlation_id=row[4],
            payload_json=row[5],
            created_at=row[6],
        )
        for row in rows
    ]
