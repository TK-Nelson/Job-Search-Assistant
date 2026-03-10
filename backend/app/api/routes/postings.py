import sqlite3

from fastapi import APIRouter, HTTPException, Query

from app.db.database import get_connection
from app.schemas.posting import JobPostingListResponse, JobPostingRead, map_job_posting_row

router = APIRouter()


def _safe_sort(sort: str) -> str:
    if sort == "match":
        return "COALESCE(ar.overall_score, jp.parser_confidence * 100.0) DESC, jp.last_seen_at DESC"
    return "jp.last_seen_at DESC"


@router.get("/job-postings", response_model=JobPostingListResponse)
def list_job_postings(
    companyId: int | None = Query(default=None),
    status: str = Query(default="active"),
    sort: str = Query(default="freshness"),
    resumeVersionId: int | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
) -> JobPostingListResponse:
    order_by = _safe_sort(sort)

    resume_filter_sql = "AND ar2.resume_version_id = ?" if resumeVersionId is not None else ""

    base_query = f"""
        SELECT
          jp.id,
          jp.company_id,
          c.name AS company_name,
          jp.title,
          jp.location,
          jp.posted_date,
          jp.canonical_url,
          jp.source_url,
          jp.description_text,
          jp.parser_confidence,
          jp.parser_quality_flag,
          jp.first_seen_at,
          jp.last_seen_at,
          jp.status,
          ar.overall_score,
          ar.evidence_json,
          ar.matched_keywords_json,
          jp.salary_range,
          jp.seniority_level,
          jp.workplace_type,
          jp.years_experience,
          jp.commitment_type,
          jp.archived_at
        FROM job_postings jp
        JOIN companies c ON c.id = jp.company_id
        LEFT JOIN analysis_runs ar
            ON ar.id = (
                SELECT ar2.id
                FROM analysis_runs ar2
                WHERE ar2.job_posting_id = jp.id
                {resume_filter_sql}
                ORDER BY ar2.id DESC
                LIMIT 1
            )
        WHERE jp.status = ?
    """
    params: list = []

    if resumeVersionId is not None:
        params.append(resumeVersionId)

    params.append(status)

    if companyId is not None:
        base_query += " AND jp.company_id = ?"
        params.append(companyId)

    base_query += f" ORDER BY {order_by} LIMIT ?"
    params.append(limit)

    try:
        with get_connection() as conn:
            rows = conn.execute(base_query, tuple(params)).fetchall()
    except sqlite3.OperationalError as exc:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "VALIDATION_ERROR",
                "message": "Database is not initialized. Run /api/v1/db/init first.",
                "details": {"reason": str(exc)},
            },
        )

    items = [map_job_posting_row(row) for row in rows]
    return JobPostingListResponse(items=items, count=len(items))


@router.get("/job-postings/{posting_id}", response_model=JobPostingRead)
def get_job_posting(posting_id: int, resumeVersionId: int | None = Query(default=None)) -> JobPostingRead:
    resume_filter_sql = "AND ar2.resume_version_id = ?" if resumeVersionId is not None else ""
    params: list = []
    if resumeVersionId is not None:
        params.append(resumeVersionId)
    params.append(posting_id)

    try:
        with get_connection() as conn:
            row = conn.execute(
                f"""
                SELECT
                  jp.id,
                  jp.company_id,
                  c.name AS company_name,
                  jp.title,
                  jp.location,
                  jp.posted_date,
                  jp.canonical_url,
                  jp.source_url,
                  jp.description_text,
                  jp.parser_confidence,
                  jp.parser_quality_flag,
                  jp.first_seen_at,
                  jp.last_seen_at,
                  jp.status,
                  ar.overall_score,
                  ar.evidence_json,
                  ar.matched_keywords_json,
                  jp.salary_range,
                  jp.seniority_level,
                  jp.workplace_type,
                  jp.years_experience,
                  jp.commitment_type,
                  jp.archived_at
                FROM job_postings jp
                JOIN companies c ON c.id = jp.company_id
                LEFT JOIN analysis_runs ar
                    ON ar.id = (
                        SELECT ar2.id
                        FROM analysis_runs ar2
                        WHERE ar2.job_posting_id = jp.id
                        {resume_filter_sql}
                        ORDER BY ar2.id DESC
                        LIMIT 1
                    )
                WHERE jp.id = ?
                """,
                tuple(params),
            ).fetchone()
    except sqlite3.OperationalError as exc:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "VALIDATION_ERROR",
                "message": "Database is not initialized. Run /api/v1/db/init first.",
                "details": {"reason": str(exc)},
            },
        )

    if not row:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Job posting not found."})

    return map_job_posting_row(row)


@router.delete("/job-postings/{posting_id}")
def delete_job_posting(posting_id: int) -> dict:
    try:
        with get_connection() as conn:
            row = conn.execute("SELECT id FROM job_postings WHERE id = ?", (posting_id,)).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Job posting not found."})

            conn.execute("DELETE FROM job_postings WHERE id = ?", (posting_id,))
            conn.commit()
    except sqlite3.OperationalError as exc:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "VALIDATION_ERROR",
                "message": "Database is not initialized. Run /api/v1/db/init first.",
                "details": {"reason": str(exc)},
            },
        )

    return {"status": "deleted", "job_posting_id": posting_id}


# ── Archive / Unarchive ────────────────────────────────────────────

@router.post("/job-postings/{posting_id}/archive")
def archive_job_posting(posting_id: int) -> dict:
    try:
        with get_connection() as conn:
            row = conn.execute("SELECT id, archived_at FROM job_postings WHERE id = ?", (posting_id,)).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Job posting not found."})
            if row[1]:
                return {"status": "already_archived", "job_posting_id": posting_id}
            conn.execute(
                "UPDATE job_postings SET archived_at = datetime('now') WHERE id = ?",
                (posting_id,),
            )
            conn.commit()
    except sqlite3.OperationalError as exc:
        raise HTTPException(status_code=400, detail={"code": "VALIDATION_ERROR", "message": str(exc)})

    return {"status": "archived", "job_posting_id": posting_id}


@router.post("/job-postings/{posting_id}/unarchive")
def unarchive_job_posting(posting_id: int) -> dict:
    try:
        with get_connection() as conn:
            row = conn.execute("SELECT id, archived_at FROM job_postings WHERE id = ?", (posting_id,)).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Job posting not found."})
            if not row[1]:
                return {"status": "not_archived", "job_posting_id": posting_id}
            conn.execute(
                "UPDATE job_postings SET archived_at = NULL WHERE id = ?",
                (posting_id,),
            )
            conn.commit()
    except sqlite3.OperationalError as exc:
        raise HTTPException(status_code=400, detail={"code": "VALIDATION_ERROR", "message": str(exc)})

    return {"status": "unarchived", "job_posting_id": posting_id}


@router.post("/job-postings/lifecycle-cleanup")
def run_lifecycle_cleanup() -> dict:
    """Auto-archive postings not viewed in 30 days; delete postings archived for 2+ months."""
    try:
        with get_connection() as conn:
            # Auto-archive: not viewed in 30 days, no linked application, not already archived
            archived_result = conn.execute(
                """
                UPDATE job_postings
                SET archived_at = datetime('now')
                WHERE archived_at IS NULL
                  AND id NOT IN (SELECT job_posting_id FROM applications)
                  AND (
                    last_viewed_at IS NOT NULL AND last_viewed_at < datetime('now', '-30 days')
                    OR last_viewed_at IS NULL AND last_seen_at < datetime('now', '-30 days')
                  )
                """
            )
            auto_archived = archived_result.rowcount

            # Auto-delete: archived for 2+ months
            deleted_result = conn.execute(
                """
                DELETE FROM job_postings
                WHERE archived_at IS NOT NULL
                  AND archived_at < datetime('now', '-60 days')
                """
            )
            auto_deleted = deleted_result.rowcount

            conn.commit()
    except sqlite3.OperationalError as exc:
        raise HTTPException(status_code=400, detail={"code": "VALIDATION_ERROR", "message": str(exc)})

    return {"auto_archived": auto_archived, "auto_deleted": auto_deleted}
