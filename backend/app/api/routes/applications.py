import sqlite3

from fastapi import APIRouter, HTTPException, Query

from app.db.database import get_connection
from app.schemas.application import (
    ApplicationCreate,
    ApplicationListResponse,
    ApplicationRead,
    ApplicationStageUpdate,
    ApplicationUpdate,
    StageHistoryResponse,
    map_application_row,
    map_stage_history_row,
)

router = APIRouter()


VALID_STAGES = {
    "saved",
    "applied",
    "phone_screen",
    "interview",
    "offer",
    "rejected",
    "withdrawn",
}


def _ensure_stage(stage: str) -> None:
    if stage not in VALID_STAGES:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "VALIDATION_ERROR",
                "message": f"Invalid stage '{stage}'.",
                "details": {"allowed": sorted(list(VALID_STAGES))},
            },
        )


def _db_uninitialized(exc: Exception) -> HTTPException:
    return HTTPException(
        status_code=400,
        detail={
            "code": "VALIDATION_ERROR",
            "message": "Database is not initialized. Run /api/v1/db/init first.",
            "details": {"reason": str(exc)},
        },
    )


@router.post("/applications", response_model=ApplicationRead)
def create_application(payload: ApplicationCreate) -> ApplicationRead:
    _ensure_stage(payload.stage)

    try:
        with get_connection() as conn:
            posting = conn.execute("SELECT id FROM job_postings WHERE id = ?", (payload.job_posting_id,)).fetchone()
            if not posting:
                raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Job posting not found."})

            conn.execute(
                """
                INSERT INTO applications (job_posting_id, stage, applied_at, target_salary, notes)
                VALUES (?, ?, ?, ?, ?)
                """,
                (payload.job_posting_id, payload.stage, payload.applied_at, payload.target_salary, payload.notes),
            )
            application_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]

            conn.execute(
                """
                INSERT INTO application_stage_history (application_id, from_stage, to_stage, reason)
                VALUES (?, NULL, ?, 'initial stage')
                """,
                (application_id, payload.stage),
            )
            conn.commit()

            row = conn.execute(
                """
                SELECT a.id, a.job_posting_id, c.name, jp.title, a.stage, a.applied_at,
                       a.target_salary, a.notes, a.created_at, a.updated_at
                FROM applications a
                JOIN job_postings jp ON jp.id = a.job_posting_id
                JOIN companies c ON c.id = jp.company_id
                WHERE a.id = ?
                """,
                (application_id,),
            ).fetchone()
    except sqlite3.OperationalError as exc:
        raise _db_uninitialized(exc)

    return map_application_row(row)


@router.get("/applications", response_model=ApplicationListResponse)
def list_applications(
    stage: str | None = Query(default=None),
    companyId: int | None = Query(default=None),
) -> ApplicationListResponse:
    if stage:
        _ensure_stage(stage)

    query = """
        SELECT a.id, a.job_posting_id, c.name, jp.title, a.stage, a.applied_at,
               a.target_salary, a.notes, a.created_at, a.updated_at
        FROM applications a
        JOIN job_postings jp ON jp.id = a.job_posting_id
        JOIN companies c ON c.id = jp.company_id
        WHERE 1=1
    """
    params: list = []

    if stage:
        query += " AND a.stage = ?"
        params.append(stage)
    if companyId is not None:
        query += " AND c.id = ?"
        params.append(companyId)

    query += " ORDER BY a.updated_at DESC"

    try:
        with get_connection() as conn:
            rows = conn.execute(query, tuple(params)).fetchall()
    except sqlite3.OperationalError as exc:
        raise _db_uninitialized(exc)

    items = [map_application_row(row) for row in rows]
    return ApplicationListResponse(items=items, count=len(items))


@router.put("/applications/{application_id}", response_model=ApplicationRead)
def update_application(application_id: int, payload: ApplicationUpdate) -> ApplicationRead:
    _ensure_stage(payload.stage)

    try:
        with get_connection() as conn:
            current = conn.execute(
                "SELECT stage FROM applications WHERE id = ?",
                (application_id,),
            ).fetchone()
            if not current:
                raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Application not found."})

            from_stage = current[0]

            conn.execute(
                """
                UPDATE applications
                SET stage = ?, applied_at = ?, target_salary = ?, notes = ?, updated_at = datetime('now')
                WHERE id = ?
                """,
                (payload.stage, payload.applied_at, payload.target_salary, payload.notes, application_id),
            )

            if from_stage != payload.stage:
                conn.execute(
                    """
                    INSERT INTO application_stage_history (application_id, from_stage, to_stage, reason)
                    VALUES (?, ?, ?, 'application update')
                    """,
                    (application_id, from_stage, payload.stage),
                )

            conn.commit()

            row = conn.execute(
                """
                SELECT a.id, a.job_posting_id, c.name, jp.title, a.stage, a.applied_at,
                       a.target_salary, a.notes, a.created_at, a.updated_at
                FROM applications a
                JOIN job_postings jp ON jp.id = a.job_posting_id
                JOIN companies c ON c.id = jp.company_id
                WHERE a.id = ?
                """,
                (application_id,),
            ).fetchone()
    except sqlite3.OperationalError as exc:
        raise _db_uninitialized(exc)

    return map_application_row(row)


@router.post("/applications/{application_id}/stage", response_model=ApplicationRead)
def update_application_stage(application_id: int, payload: ApplicationStageUpdate) -> ApplicationRead:
    _ensure_stage(payload.to_stage)

    try:
        with get_connection() as conn:
            current = conn.execute(
                "SELECT stage FROM applications WHERE id = ?",
                (application_id,),
            ).fetchone()
            if not current:
                raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Application not found."})

            from_stage = current[0]

            conn.execute(
                "UPDATE applications SET stage = ?, updated_at = datetime('now') WHERE id = ?",
                (payload.to_stage, application_id),
            )
            conn.execute(
                """
                INSERT INTO application_stage_history (application_id, from_stage, to_stage, reason)
                VALUES (?, ?, ?, ?)
                """,
                (application_id, from_stage, payload.to_stage, payload.reason),
            )
            conn.commit()

            row = conn.execute(
                """
                SELECT a.id, a.job_posting_id, c.name, jp.title, a.stage, a.applied_at,
                       a.target_salary, a.notes, a.created_at, a.updated_at
                FROM applications a
                JOIN job_postings jp ON jp.id = a.job_posting_id
                JOIN companies c ON c.id = jp.company_id
                WHERE a.id = ?
                """,
                (application_id,),
            ).fetchone()
    except sqlite3.OperationalError as exc:
        raise _db_uninitialized(exc)

    return map_application_row(row)


@router.get("/applications/{application_id}/history", response_model=StageHistoryResponse)
def list_application_history(application_id: int) -> StageHistoryResponse:
    try:
        with get_connection() as conn:
            rows = conn.execute(
                """
                SELECT id, application_id, from_stage, to_stage, changed_at, reason
                FROM application_stage_history
                WHERE application_id = ?
                ORDER BY id DESC
                """,
                (application_id,),
            ).fetchall()
    except sqlite3.OperationalError as exc:
        raise _db_uninitialized(exc)

    items = [map_stage_history_row(row) for row in rows]
    return StageHistoryResponse(items=items, count=len(items))
