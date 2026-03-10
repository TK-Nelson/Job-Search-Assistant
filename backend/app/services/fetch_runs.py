import sqlite3
import json

from fastapi import HTTPException

from app.core.settings_store import get_settings
from app.db.database import get_connection
from app.schemas.fetch import FetchRunRead, map_fetch_run_row
from app.services.audit import write_audit_event
from app.services.ingestion import ingest_company_careers_page


def _running_fetch_exists(conn: sqlite3.Connection) -> bool:
    row = conn.execute("SELECT id FROM fetch_runs WHERE status = 'running' LIMIT 1").fetchone()
    return row is not None


def _followed_company_count(conn: sqlite3.Connection) -> int:
    row = conn.execute("SELECT COUNT(*) FROM companies WHERE followed = 1").fetchone()
    return int(row[0]) if row else 0


def _get_routine(conn: sqlite3.Connection) -> dict | None:
    """Load the single fetch routine if one exists."""
    row = conn.execute(
        "SELECT id, title_keywords_json, description_keywords_json, keyword_match_mode, "
        "company_ids_json, use_followed_companies FROM fetch_routines ORDER BY id LIMIT 1"
    ).fetchone()
    if not row:
        return None
    return {
        "id": row[0],
        "title_keywords": json.loads(row[1] or "[]"),
        "description_keywords": json.loads(row[2] or "[]"),
        "keyword_match_mode": row[3] or "any",
        "company_ids": json.loads(row[4] or "[]"),
        "use_followed_companies": bool(row[5]),
    }


def _resolve_companies(conn: sqlite3.Connection, routine: dict | None) -> list[tuple]:
    """Determine which companies to fetch based on routine config."""
    if routine:
        ids_set: set[int] = set()
        if routine["use_followed_companies"]:
            rows = conn.execute("SELECT id FROM companies WHERE followed = 1").fetchall()
            ids_set.update(r[0] for r in rows)
        if routine["company_ids"]:
            ids_set.update(routine["company_ids"])
        if not ids_set:
            return []
        placeholders = ",".join("?" for _ in ids_set)
        return conn.execute(
            f"SELECT id, name, careers_url FROM companies WHERE id IN ({placeholders}) ORDER BY id ASC",
            list(ids_set),
        ).fetchall()
    else:
        # Legacy fallback: all followed companies
        return conn.execute(
            "SELECT id, name, careers_url FROM companies WHERE followed = 1 ORDER BY id ASC"
        ).fetchall()


def start_and_complete_fetch_run() -> FetchRunRead:
    settings = get_settings()

    try:
        with get_connection() as conn:
            if _running_fetch_exists(conn):
                raise HTTPException(
                    status_code=409,
                    detail={"code": "CONFLICT", "message": "A fetch run is already in progress."},
                )

            routine = _get_routine(conn)
            companies_rows = _resolve_companies(conn, routine)
            if not companies_rows:
                raise HTTPException(
                    status_code=400,
                    detail={
                        "code": "VALIDATION_ERROR",
                        "message": "No companies to fetch. Configure a fetch routine or follow at least one company.",
                    },
                )

            conn.execute(
                """
                INSERT INTO fetch_runs (status)
                VALUES ('running')
                """
            )
            run_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]

            companies_checked = len(companies_rows)
            postings_new = 0
            postings_updated = 0
            postings_skipped = 0
            postings_filtered_out = 0
            all_errors: list[str] = []

            # Merge routine keywords with settings-level filters
            filter_enabled = settings.fetch.role_filters.enabled
            title_contains = list(settings.fetch.role_filters.title_contains)
            description_contains = list(settings.fetch.role_filters.description_contains)
            match_mode = settings.fetch.role_filters.match_mode

            if routine:
                if routine["title_keywords"] or routine["description_keywords"]:
                    filter_enabled = True
                title_contains = list(set(title_contains + routine["title_keywords"]))
                description_contains = list(set(description_contains + routine["description_keywords"]))
                if routine["keyword_match_mode"]:
                    match_mode = routine["keyword_match_mode"]

            for company_id, company_name, careers_url in companies_rows:
                new_count, updated_count, skipped_count, filtered_out_count, errors = ingest_company_careers_page(
                    conn=conn,
                    company_id=company_id,
                    company_name=company_name,
                    careers_url=careers_url,
                    timeout_seconds=settings.fetch.timeout_seconds,
                    max_retries=settings.fetch.max_retries,
                    role_filter_enabled=filter_enabled,
                    role_filter_title_contains=title_contains,
                    role_filter_description_contains=description_contains,
                    role_filter_match_mode=match_mode,
                )
                postings_new += new_count
                postings_updated += updated_count
                postings_skipped += skipped_count
                postings_filtered_out += filtered_out_count
                all_errors.extend(errors)

            run_status = "success" if not all_errors else "partial_failure"

            conn.execute(
                """
                UPDATE fetch_runs
                SET
                  completed_at = datetime('now'),
                  status = ?,
                  companies_checked = ?,
                  postings_new = ?,
                  postings_updated = ?,
                  postings_skipped = ?,
                                    postings_filtered_out = ?,
                  errors_json = ?
                WHERE id = ?
                """,
                (
                    run_status,
                    companies_checked,
                    postings_new,
                    postings_updated,
                    postings_skipped,
                                        postings_filtered_out,
                    json.dumps(all_errors),
                    run_id,
                ),
            )
            conn.commit()

            # Update routine last_run_at
            if routine:
                conn.execute(
                    "UPDATE fetch_routines SET last_run_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
                    (routine["id"],),
                )
                conn.commit()

            row = conn.execute(
                """
                SELECT id, started_at, completed_at, status, companies_checked,
                      postings_new, postings_updated, postings_skipped, postings_filtered_out, errors_json
                FROM fetch_runs
                WHERE id = ?
                """,
                (run_id,),
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

    run = map_fetch_run_row(row)
    write_audit_event(
        event_type="fetch.run",
        entity_type="fetch_run",
        entity_id=str(run.id),
        payload={
            "status": run.status,
            "companies_checked": run.companies_checked,
            "postings_new": run.postings_new,
            "postings_updated": run.postings_updated,
            "postings_skipped": run.postings_skipped,
            "postings_filtered_out": run.postings_filtered_out,
        },
    )
    return run


def list_fetch_runs(limit: int = 20) -> list[FetchRunRead]:
    safe_limit = max(1, min(limit, 100))
    try:
        with get_connection() as conn:
            rows = conn.execute(
                """
                SELECT id, started_at, completed_at, status, companies_checked,
                      postings_new, postings_updated, postings_skipped, postings_filtered_out, errors_json
                FROM fetch_runs
                ORDER BY id DESC
                LIMIT ?
                """,
                (safe_limit,),
            ).fetchall()
    except sqlite3.OperationalError as exc:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "VALIDATION_ERROR",
                "message": "Database is not initialized. Run /api/v1/db/init first.",
                "details": {"reason": str(exc)},
            },
        )

    return [map_fetch_run_row(row) for row in rows]


def get_fetch_run(run_id: int) -> FetchRunRead:
    try:
        with get_connection() as conn:
            row = conn.execute(
                """
                SELECT id, started_at, completed_at, status, companies_checked,
                      postings_new, postings_updated, postings_skipped, postings_filtered_out, errors_json
                FROM fetch_runs
                WHERE id = ?
                """,
                (run_id,),
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
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Fetch run not found."})

    return map_fetch_run_row(row)
