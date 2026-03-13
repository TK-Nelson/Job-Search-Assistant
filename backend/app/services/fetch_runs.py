import sqlite3
import json
import logging
import time

from fastapi import HTTPException

from app.core.settings_store import get_settings
from app.db.database import get_connection
from app.schemas.fetch import FetchRunRead, map_fetch_run_row
from app.services.audit import write_audit_event
from app.services.ingestion_v2 import ingest_company_via_adapter

logger = logging.getLogger(__name__)


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
            f"SELECT id, name, careers_url, portal_type, search_url FROM companies WHERE id IN ({placeholders}) ORDER BY id ASC",
            list(ids_set),
        ).fetchall()
    else:
        # Legacy fallback: all followed companies
        return conn.execute(
            "SELECT id, name, careers_url, portal_type, search_url FROM companies WHERE followed = 1 ORDER BY id ASC"
        ).fetchall()


# ---------------------------------------------------------------------------
# Auto-review: Gemini analysis for newly fetched postings
# ---------------------------------------------------------------------------

def _get_latest_resume_version_id(conn: sqlite3.Connection) -> int | None:
    """Return the id of the most recently uploaded resume version, or None."""
    row = conn.execute(
        "SELECT id FROM resume_versions ORDER BY id DESC LIMIT 1"
    ).fetchone()
    return int(row[0]) if row else None


def _posting_already_has_comparison(conn: sqlite3.Connection, job_posting_id: int) -> bool:
    row = conn.execute(
        "SELECT 1 FROM comparison_reports WHERE job_posting_id = ? LIMIT 1",
        (job_posting_id,),
    ).fetchone()
    return row is not None


def auto_review_new_postings(
    conn: sqlite3.Connection,
    new_posting_ids: list[int],
    resume_version_id: int,
) -> tuple[int, int, list[str]]:
    """
    Run Gemini analysis on a batch of new postings, creating comparison
    reports for each.

    Returns (reviewed_count, skipped_count, errors).
    """
    from app.services.gemini import gemini_available, get_rate_state, RateLimitExceeded
    from app.services.analysis_llm import run_gemini_analysis
    from app.services.notifications import create_notification

    if not gemini_available():
        return 0, len(new_posting_ids), ["Gemini API key not configured — skipping auto-review."]

    reviewed = 0
    skipped = 0
    errors: list[str] = []

    for posting_id in new_posting_ids:
        # Check rate limit before each call
        state = get_rate_state()
        allowed, reason = state.can_send()
        if not allowed:
            msg = f"Gemini rate limit reached — {len(new_posting_ids) - reviewed - skipped} postings skipped. {reason}"
            create_notification(level="warning", title="Gemini rate limit", message=msg)
            errors.append(msg)
            skipped += len(new_posting_ids) - reviewed - skipped
            break

        # Skip if already has a comparison
        if _posting_already_has_comparison(conn, posting_id):
            skipped += 1
            continue

        try:
            analysis, llm_json_text = run_gemini_analysis(resume_version_id, posting_id)

            # Get company name for comparison report
            posting_row = conn.execute(
                "SELECT c.name, jp.source_url FROM job_postings jp JOIN companies c ON c.id = jp.company_id WHERE jp.id = ?",
                (posting_id,),
            ).fetchone()
            company_name = posting_row[0] if posting_row else "Unknown"
            source_url = posting_row[1] if posting_row else None

            conn.execute(
                """
                INSERT INTO comparison_reports (
                  job_posting_id, resume_version_id, analysis_run_id,
                  source_company_input, source_url_input,
                  evaluation_source, llm_response_json,
                  applied_decision, linked_application_id
                ) VALUES (?, ?, ?, ?, ?, 'gemini_api', ?, 'unknown', NULL)
                """,
                (
                    posting_id,
                    resume_version_id,
                    analysis.analysis_run_id,
                    company_name,
                    source_url,
                    llm_json_text,
                ),
            )
            conn.commit()
            reviewed += 1

            # Small delay to stay under RPM
            time.sleep(4.5)

        except Exception as exc:
            logger.warning("Auto-review failed for posting %d: %s", posting_id, exc)
            errors.append(f"Auto-review failed for posting {posting_id}: {exc}")
            skipped += 1

    # Emit warning notification if approaching limits
    warning = state.should_warn()
    if warning:
        create_notification(level="warning", title="Gemini usage warning", message=warning)

    if reviewed > 0:
        create_notification(
            level="info",
            title="Auto-review complete",
            message=f"Gemini reviewed {reviewed} new posting(s). {skipped} skipped.",
        )

    return reviewed, skipped, errors


def start_and_complete_fetch_run(exempt_company_ids: set[int] | None = None) -> FetchRunRead:
    settings = get_settings()
    exempt_ids = exempt_company_ids or set()

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
            all_new_posting_ids: list[int] = []

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

            companies_fetched = 0
            for company_id, company_name, careers_url, portal_type, search_url in companies_rows:
                # Skip exempted companies (user chose to skip in preflight)
                if company_id in exempt_ids:
                    continue

                # Skip companies without adapter support
                if not portal_type or not search_url:
                    all_errors.append(
                        f"{company_name}: No supported portal configured. "
                        f"Set a portal type and search URL, or skip this company."
                    )
                    continue

                # Small delay between companies to avoid triggering rate limits
                if companies_fetched > 0:
                    time.sleep(1.0)

                # Build keyword list for adapter search – use title keywords
                # only (shorter, more focused). Description keywords are used
                # in the double-filter pass after results come back.
                search_keywords = list(set(title_contains)) if title_contains else list(set(description_contains))
                if not search_keywords:
                    search_keywords = [""]  # empty search = all jobs

                new_count, updated_count, skipped_count, filtered_out_count, errors, new_ids = ingest_company_via_adapter(
                    conn=conn,
                    company_id=company_id,
                    company_name=company_name,
                    portal_type=portal_type,
                    search_url=search_url,
                    keywords=search_keywords,
                    limit=50,
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
                all_new_posting_ids.extend(new_ids)
                companies_fetched += 1

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

    # --- Auto-review new postings with Gemini ---
    if all_new_posting_ids:
        try:
            with get_connection() as conn:
                resume_id = _get_latest_resume_version_id(conn)
                if resume_id:
                    reviewed, ar_skipped, ar_errors = auto_review_new_postings(
                        conn, all_new_posting_ids, resume_id,
                    )
                    logger.info(
                        "Auto-review: %d reviewed, %d skipped, %d errors",
                        reviewed, ar_skipped, len(ar_errors),
                    )
                else:
                    from app.services.notifications import create_notification
                    create_notification(
                        level="info",
                        title="Auto-review skipped",
                        message="No resume uploaded yet. Upload a resume so Gemini can auto-review fetched roles.",
                    )
        except Exception as exc:
            logger.warning("Auto-review batch failed: %s", exc)

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
