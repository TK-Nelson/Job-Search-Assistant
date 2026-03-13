import json
import sqlite3

from fastapi import APIRouter, HTTPException, Query

from app.db.database import get_connection
from app.schemas.fetch_routine import (
    FetchedRoleRead,
    FetchedRolesResponse,
    FetchRoutineCreate,
    FetchRoutineRead,
    FetchRoutineUpdate,
)

router = APIRouter()

ALLOWED_FREQUENCIES = {120, 360, 720, 1440, 10080}  # 2h, 6h, 12h, daily, weekly
FREQUENCY_LABELS = {120: "Every 2 hours", 360: "Every 6 hours", 720: "Every 12 hours", 1440: "Daily", 10080: "Weekly"}


def _row_to_routine(row: tuple) -> FetchRoutineRead:
    return FetchRoutineRead(
        id=row[0],
        title_keywords=json.loads(row[1] or "[]"),
        description_keywords=json.loads(row[2] or "[]"),
        keyword_match_mode=row[3],
        max_role_age_days=row[4],
        frequency_minutes=row[5],
        company_ids=json.loads(row[6] or "[]"),
        use_followed_companies=bool(row[7]),
        enabled=bool(row[8]),
        last_run_at=row[9],
        created_at=row[10],
        updated_at=row[11],
    )


ROUTINE_COLS = (
    "id, title_keywords_json, description_keywords_json, keyword_match_mode, "
    "max_role_age_days, frequency_minutes, company_ids_json, use_followed_companies, "
    "enabled, last_run_at, created_at, updated_at"
)


# ── Routine CRUD ──────────────────────────────────────────────────

@router.get("/fetch-routine", response_model=FetchRoutineRead | None)
def get_fetch_routine():
    """Get the single global fetch routine, or null if none exists."""
    with get_connection() as conn:
        row = conn.execute(f"SELECT {ROUTINE_COLS} FROM fetch_routines ORDER BY id LIMIT 1").fetchone()
    if not row:
        return None
    return _row_to_routine(row)


@router.post("/fetch-routine", response_model=FetchRoutineRead, status_code=201)
def create_fetch_routine(body: FetchRoutineCreate):
    """Create the global fetch routine. Only one may exist."""
    if body.keyword_match_mode not in ("any", "all"):
        raise HTTPException(400, detail="keyword_match_mode must be 'any' or 'all'")
    if body.frequency_minutes not in ALLOWED_FREQUENCIES:
        raise HTTPException(400, detail=f"frequency_minutes must be one of {sorted(ALLOWED_FREQUENCIES)}")
    if body.max_role_age_days < 1 or body.max_role_age_days > 90:
        raise HTTPException(400, detail="max_role_age_days must be between 1 and 90")

    with get_connection() as conn:
        existing = conn.execute("SELECT id FROM fetch_routines LIMIT 1").fetchone()
        if existing:
            raise HTTPException(409, detail="A fetch routine already exists. Update or delete it instead.")

        conn.execute(
            """
            INSERT INTO fetch_routines
              (title_keywords_json, description_keywords_json, keyword_match_mode,
               max_role_age_days, frequency_minutes, company_ids_json, use_followed_companies, enabled)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1)
            """,
            (
                json.dumps(body.title_keywords),
                json.dumps(body.description_keywords),
                body.keyword_match_mode,
                body.max_role_age_days,
                body.frequency_minutes,
                json.dumps(body.company_ids),
                1 if body.use_followed_companies else 0,
            ),
        )
        conn.commit()
        row = conn.execute(f"SELECT {ROUTINE_COLS} FROM fetch_routines ORDER BY id DESC LIMIT 1").fetchone()

    return _row_to_routine(row)


@router.patch("/fetch-routine", response_model=FetchRoutineRead)
def update_fetch_routine(body: FetchRoutineUpdate):
    """Update the global fetch routine."""
    with get_connection() as conn:
        row = conn.execute(f"SELECT {ROUTINE_COLS} FROM fetch_routines ORDER BY id LIMIT 1").fetchone()
        if not row:
            raise HTTPException(404, detail="No fetch routine exists. Create one first.")
        routine_id = row[0]

        sets: list[str] = []
        params: list = []

        if body.title_keywords is not None:
            sets.append("title_keywords_json = ?")
            params.append(json.dumps(body.title_keywords))
        if body.description_keywords is not None:
            sets.append("description_keywords_json = ?")
            params.append(json.dumps(body.description_keywords))
        if body.keyword_match_mode is not None:
            if body.keyword_match_mode not in ("any", "all"):
                raise HTTPException(400, detail="keyword_match_mode must be 'any' or 'all'")
            sets.append("keyword_match_mode = ?")
            params.append(body.keyword_match_mode)
        if body.max_role_age_days is not None:
            if body.max_role_age_days < 1 or body.max_role_age_days > 90:
                raise HTTPException(400, detail="max_role_age_days must be between 1 and 90")
            sets.append("max_role_age_days = ?")
            params.append(body.max_role_age_days)
        if body.frequency_minutes is not None:
            if body.frequency_minutes not in ALLOWED_FREQUENCIES:
                raise HTTPException(400, detail=f"frequency_minutes must be one of {sorted(ALLOWED_FREQUENCIES)}")
            sets.append("frequency_minutes = ?")
            params.append(body.frequency_minutes)
        if body.company_ids is not None:
            sets.append("company_ids_json = ?")
            params.append(json.dumps(body.company_ids))
        if body.use_followed_companies is not None:
            sets.append("use_followed_companies = ?")
            params.append(1 if body.use_followed_companies else 0)
        if body.enabled is not None:
            sets.append("enabled = ?")
            params.append(1 if body.enabled else 0)

        if not sets:
            return _row_to_routine(row)

        sets.append("updated_at = datetime('now')")
        params.append(routine_id)
        conn.execute(f"UPDATE fetch_routines SET {', '.join(sets)} WHERE id = ?", params)
        conn.commit()

        row = conn.execute(f"SELECT {ROUTINE_COLS} FROM fetch_routines WHERE id = ?", (routine_id,)).fetchone()

    return _row_to_routine(row)


@router.delete("/fetch-routine", status_code=204)
def delete_fetch_routine():
    """Delete the global fetch routine."""
    with get_connection() as conn:
        row = conn.execute("SELECT id FROM fetch_routines LIMIT 1").fetchone()
        if not row:
            raise HTTPException(404, detail="No fetch routine exists.")
        conn.execute("DELETE FROM fetch_routines WHERE id = ?", (row[0],))
        conn.commit()
    return None


# ── Fetched roles list ────────────────────────────────────────────

@router.get("/fetch-routine/roles", response_model=FetchedRolesResponse)
def get_fetched_roles(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    """
    Return active roles, filtered by the routine criteria
    (keywords + max age). Excludes postings that already have a linked
    application and postings that have been archived.
    If no routine exists, returns all qualifying active roles.
    """
    with get_connection() as conn:
        routine_row = conn.execute(f"SELECT {ROUTINE_COLS} FROM fetch_routines ORDER BY id LIMIT 1").fetchone()
        routine = _row_to_routine(routine_row) if routine_row else None

        where_clauses = [
            "jp.status = 'active'",
            "jp.archived_at IS NULL",
            "NOT EXISTS (SELECT 1 FROM applications a WHERE a.job_posting_id = jp.id)",
        ]
        params: list = []

        if routine:
            # Date gate
            where_clauses.append("jp.first_seen_at >= datetime('now', ?)")
            params.append(f"-{routine.max_role_age_days} days")

            # Company filter
            if routine.use_followed_companies and routine.company_ids:
                # Both followed + specific IDs
                placeholders = ",".join("?" for _ in routine.company_ids)
                where_clauses.append(
                    f"(c.followed = 1 OR jp.company_id IN ({placeholders}))"
                )
                params.extend(routine.company_ids)
            elif routine.use_followed_companies:
                where_clauses.append("c.followed = 1")
            elif routine.company_ids:
                placeholders = ",".join("?" for _ in routine.company_ids)
                where_clauses.append(f"jp.company_id IN ({placeholders})")
                params.extend(routine.company_ids)

        where_sql = " AND ".join(where_clauses)

        # Total count
        count_row = conn.execute(
            f"SELECT COUNT(*) FROM job_postings jp JOIN companies c ON c.id = jp.company_id WHERE {where_sql}",
            params,
        ).fetchone()
        total = count_row[0] if count_row else 0

        # New count (first seen in the last fetch run)
        last_run = conn.execute(
            "SELECT started_at FROM fetch_runs WHERE status IN ('success','partial_failure') ORDER BY id DESC LIMIT 1"
        ).fetchone()
        new_count = 0
        if last_run:
            new_params = list(params)
            new_where = where_sql + " AND jp.first_seen_at >= ?"
            new_params.append(last_run[0])
            new_row = conn.execute(
                f"SELECT COUNT(*) FROM job_postings jp JOIN companies c ON c.id = jp.company_id WHERE {new_where}",
                new_params,
            ).fetchone()
            new_count = new_row[0] if new_row else 0

        # Paginated results
        query_params = list(params)
        query_params.extend([limit, offset])
        rows = conn.execute(
            f"""
            SELECT jp.id, jp.company_id, c.name, c.logo_url, jp.title, jp.location,
                   jp.posted_date, jp.canonical_url, jp.first_seen_at, jp.last_seen_at,
                   jp.status, jp.salary_range, jp.seniority_level, jp.workplace_type,
                   jp.commitment_type, jp.archived_at,
                   ar.overall_score, jp.description_text
            FROM job_postings jp
            JOIN companies c ON c.id = jp.company_id
            LEFT JOIN analysis_runs ar
                ON ar.id = (
                    SELECT ar2.id FROM analysis_runs ar2
                    WHERE ar2.job_posting_id = jp.id
                    ORDER BY ar2.id DESC LIMIT 1
                )
            WHERE {where_sql}
            ORDER BY jp.first_seen_at DESC
            LIMIT ? OFFSET ?
            """,
            query_params,
        ).fetchall()

    items = [
        FetchedRoleRead(
            id=r[0],
            company_id=r[1],
            company_name=r[2],
            company_logo_url=r[3],
            title=r[4],
            location=r[5],
            posted_date=r[6],
            canonical_url=r[7],
            first_seen_at=r[8],
            last_seen_at=r[9],
            status=r[10],
            salary_range=r[11],
            seniority_level=r[12],
            workplace_type=r[13],
            commitment_type=r[14],
            archived_at=r[15] if len(r) > 15 else None,
            match_score=round(float(r[16]), 1) if len(r) > 16 and r[16] is not None else None,
            description_text=r[17] if len(r) > 17 else None,
        )
        for r in rows
    ]

    return FetchedRolesResponse(items=items, total=total, new_count=new_count)


# ── Frequency options (for frontend dropdown) ────────────────────

@router.get("/fetch-routine/frequency-options")
def get_frequency_options():
    """Return available frequency presets for the UI."""
    return [
        {"value": k, "label": v}
        for k, v in sorted(FREQUENCY_LABELS.items())
    ]
