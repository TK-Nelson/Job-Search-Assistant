import hashlib
import sqlite3

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.db.database import get_connection
from app.schemas.posting import JobPostingListResponse, JobPostingRead, map_job_posting_row

router = APIRouter()


class PostingCreateBody(BaseModel):
    company_id: int
    title: str = Field(min_length=1, max_length=500)
    source_url: str | None = Field(default=None, max_length=2000)
    description_text: str | None = Field(default=None, max_length=100000)
    location: str | None = Field(default=None, max_length=300)


class PostingUpdateBody(BaseModel):
    title: str | None = None
    location: str | None = None


def _safe_sort(sort: str) -> str:
    if sort == "match":
        return "COALESCE(ar.overall_score, jp.parser_confidence * 100.0) DESC, jp.last_seen_at DESC"
    return "jp.last_seen_at DESC"


def _manual_fingerprint(company_id: int, title: str, source_url: str | None) -> str:
    norm_title = title.strip().lower()
    if source_url and source_url.strip().startswith(("http://", "https://")):
        seed = f"{company_id}|{source_url.strip().lower()}"
    else:
        seed = f"{company_id}|manual|{norm_title}"
    return hashlib.sha256(seed.encode("utf-8")).hexdigest()


@router.post("/job-postings")
def create_job_posting(body: PostingCreateBody) -> dict:
    """Create a manual job posting for a role not sourced from the fetch routine."""
    safe_title = body.title.strip()
    source_url = (body.source_url or "").strip() or None
    desc = (body.description_text or "").strip() or f"Manually added role: {safe_title}"
    location = (body.location or "").strip() or "unknown"
    canonical_url = source_url if source_url else f"manual://posting/{body.company_id}/{hashlib.sha1(safe_title.encode()).hexdigest()[:16]}"
    fingerprint = _manual_fingerprint(body.company_id, safe_title, source_url)

    try:
        with get_connection() as conn:
            company = conn.execute("SELECT id FROM companies WHERE id = ?", (body.company_id,)).fetchone()
            if not company:
                raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Company not found."})

            existing = conn.execute("SELECT id FROM job_postings WHERE fingerprint = ?", (fingerprint,)).fetchone()
            if existing:
                return {"status": "exists", "job_posting_id": int(existing[0])}

            conn.execute(
                """
                INSERT INTO job_postings (
                  company_id, title, location, posted_date,
                  canonical_url, source_url, description_text, fingerprint,
                  parser_confidence, parser_quality_flag,
                  source_kind, created_via, status
                ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, 1.0, 'ok', 'manual_paste', 'comparison_input', 'active')
                """,
                (body.company_id, safe_title, location, canonical_url, source_url or canonical_url, desc, fingerprint),
            )
            posting_id = int(conn.execute("SELECT last_insert_rowid()").fetchone()[0])
            conn.commit()
    except sqlite3.OperationalError as exc:
        raise HTTPException(status_code=400, detail={"code": "VALIDATION_ERROR", "message": str(exc)})

    return {"status": "created", "job_posting_id": posting_id}


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
          jp.team,
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


@router.get("/job-postings/lifecycle-warnings")
def get_lifecycle_warnings() -> dict:
    """Return counts of postings approaching auto-archive (within 7 days) and auto-delete (within 14 days)."""
    try:
        with get_connection() as conn:
            # Approaching auto-archive: not viewed in 23-30 days, not archived, no linked app
            approaching_archive = conn.execute(
                """
                SELECT COUNT(*) FROM job_postings
                WHERE archived_at IS NULL
                  AND id NOT IN (SELECT job_posting_id FROM applications)
                  AND (
                    (last_viewed_at IS NOT NULL AND last_viewed_at < datetime('now', '-23 days')
                     AND last_viewed_at >= datetime('now', '-30 days'))
                    OR (last_viewed_at IS NULL AND last_seen_at < datetime('now', '-23 days')
                        AND last_seen_at >= datetime('now', '-30 days'))
                  )
                """
            ).fetchone()[0]

            # Approaching auto-delete: archived 46-60 days ago
            approaching_delete = conn.execute(
                """
                SELECT COUNT(*) FROM job_postings
                WHERE archived_at IS NOT NULL
                  AND archived_at < datetime('now', '-46 days')
                  AND archived_at >= datetime('now', '-60 days')
                """
            ).fetchone()[0]

            # Postings approaching retention cleanup (status != 'active', within 14 days of cutoff)
            from app.core.settings_store import get_settings as _get_settings
            settings = _get_settings()
            cutoff_days = max(1, int(settings.retention.job_postings_days))
            warn_days = cutoff_days - 14
            approaching_retention = conn.execute(
                """
                SELECT COUNT(*) FROM job_postings
                WHERE status != 'active'
                  AND first_seen_at < datetime('now', ?)
                  AND first_seen_at >= datetime('now', ?)
                """,
                (f"-{warn_days} day", f"-{cutoff_days} day"),
            ).fetchone()[0]

    except sqlite3.OperationalError:
        return {"approaching_archive": 0, "approaching_delete": 0, "approaching_retention": 0}

    return {
        "approaching_archive": approaching_archive,
        "approaching_delete": approaching_delete,
        "approaching_retention": approaching_retention,
    }


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
                  jp.team,
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


@router.patch("/job-postings/{posting_id}")
def update_job_posting(posting_id: int, body: PostingUpdateBody) -> dict:
    """Update editable fields on a job posting (title, location)."""
    sets: list[str] = []
    params: list = []
    if body.title is not None:
        sets.append("title = ?")
        params.append(body.title.strip())
    if body.location is not None:
        sets.append("location = ?")
        params.append(body.location.strip())
    if not sets:
        return {"status": "no_changes", "job_posting_id": posting_id}
    params.append(posting_id)
    try:
        with get_connection() as conn:
            row = conn.execute("SELECT id FROM job_postings WHERE id = ?", (posting_id,)).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Job posting not found."})
            conn.execute(f"UPDATE job_postings SET {', '.join(sets)} WHERE id = ?", params)
            conn.commit()
    except sqlite3.OperationalError as exc:
        raise HTTPException(status_code=400, detail={"code": "VALIDATION_ERROR", "message": str(exc)})
    return {"status": "updated", "job_posting_id": posting_id}


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
