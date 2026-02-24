import sqlite3

from fastapi import APIRouter, HTTPException

from app.db.database import get_connection
from app.schemas.dashboard import DashboardSummaryResponse, StageCount

router = APIRouter()


def _db_uninitialized(exc: Exception) -> HTTPException:
    return HTTPException(
        status_code=400,
        detail={
            "code": "VALIDATION_ERROR",
            "message": "Database is not initialized. Run /api/v1/db/init first.",
            "details": {"reason": str(exc)},
        },
    )


@router.get("/dashboard/summary", response_model=DashboardSummaryResponse)
def get_dashboard_summary() -> DashboardSummaryResponse:
    try:
        with get_connection() as conn:
            followed_companies_count = conn.execute(
                "SELECT COUNT(*) FROM companies WHERE followed = 1"
            ).fetchone()[0]

            active_postings_count = conn.execute(
                "SELECT COUNT(*) FROM job_postings WHERE status = 'active'"
            ).fetchone()[0]

            recent_postings_count_7d = conn.execute(
                """
                SELECT COUNT(*) FROM job_postings
                WHERE first_seen_at >= datetime('now', '-7 day')
                """
            ).fetchone()[0]

            applications_total_count = conn.execute(
                "SELECT COUNT(*) FROM applications"
            ).fetchone()[0]

            stage_rows = conn.execute(
                """
                SELECT stage, COUNT(*)
                FROM applications
                GROUP BY stage
                ORDER BY stage ASC
                """
            ).fetchall()

            latest_run_row = conn.execute(
                """
                SELECT id, started_at, completed_at, status,
                      companies_checked, postings_new, postings_updated, postings_skipped, postings_filtered_out, errors_json
                FROM fetch_runs
                ORDER BY id DESC
                LIMIT 1
                """
            ).fetchone()
    except sqlite3.OperationalError as exc:
        raise _db_uninitialized(exc)

    latest_fetch_run = None
    new_roles_from_followed_last_run = 0
    latest_fetch_run_id = None
    latest_fetch_completed_at = None
    if latest_run_row:
        new_roles_from_followed_last_run = int(latest_run_row[5] or 0)
        latest_fetch_run_id = int(latest_run_row[0])
        latest_fetch_completed_at = latest_run_row[2]
        latest_fetch_run = {
            "id": latest_run_row[0],
            "started_at": latest_run_row[1],
            "completed_at": latest_run_row[2],
            "status": latest_run_row[3],
            "companies_checked": latest_run_row[4],
            "postings_new": latest_run_row[5],
            "postings_updated": latest_run_row[6],
            "postings_skipped": latest_run_row[7],
            "postings_filtered_out": latest_run_row[8],
            "errors_json": latest_run_row[9],
        }

    return DashboardSummaryResponse(
        followed_companies_count=int(followed_companies_count or 0),
        active_postings_count=int(active_postings_count or 0),
        recent_postings_count_7d=int(recent_postings_count_7d or 0),
        applications_total_count=int(applications_total_count or 0),
        new_roles_from_followed_last_run=new_roles_from_followed_last_run,
        latest_fetch_run_id=latest_fetch_run_id,
        latest_fetch_completed_at=latest_fetch_completed_at,
        applications_by_stage=[StageCount(stage=row[0], count=int(row[1])) for row in stage_rows],
        latest_fetch_run=latest_fetch_run,
    )
