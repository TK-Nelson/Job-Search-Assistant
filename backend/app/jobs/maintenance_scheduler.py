from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

from apscheduler.schedulers.background import BackgroundScheduler

from app.services.maintenance import create_backup, run_retention_cleanup


_scheduler: BackgroundScheduler | None = None
_log = logging.getLogger(__name__)


def _scheduled_backup() -> None:
    try:
        create_backup()
    except Exception:
        return


def _scheduled_cleanup() -> None:
    try:
        run_retention_cleanup()
    except Exception:
        return


def _scheduled_lifecycle_cleanup() -> None:
    """Run lifecycle cleanup (auto-archive + auto-delete) daily for postings AND applications."""
    try:
        from app.db.database import get_connection
        with get_connection() as conn:
            # --- Job postings lifecycle ---
            conn.execute(
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
            conn.execute(
                """
                DELETE FROM job_postings
                WHERE archived_at IS NOT NULL
                  AND archived_at < datetime('now', '-60 days')
                """
            )

            # --- Applications lifecycle ---
            # Auto-archive: not updated in 30+ days
            conn.execute(
                """
                UPDATE applications
                SET archived_at = datetime('now')
                WHERE archived_at IS NULL
                  AND updated_at < datetime('now', '-30 days')
                """
            )
            # Auto-delete: archived 1+ day ago
            conn.execute(
                """
                DELETE FROM applications
                WHERE archived_at IS NOT NULL
                  AND archived_at < datetime('now', '-1 day')
                """
            )

            conn.commit()
    except Exception:
        return


def _scheduled_fetch_check() -> None:
    """Periodically check if the fetch routine is due and run it."""
    try:
        from app.db.database import get_connection

        with get_connection() as conn:
            row = conn.execute(
                "SELECT id, frequency_minutes, last_run_at, enabled "
                "FROM fetch_routines ORDER BY id LIMIT 1"
            ).fetchone()

        if not row:
            return

        routine_id, frequency_minutes, last_run_at, enabled = row
        if not enabled:
            return

        # Determine if enough time has passed since the last run
        now = datetime.now(timezone.utc)
        if last_run_at:
            try:
                last_run = datetime.fromisoformat(last_run_at.replace("Z", "+00:00"))
                if last_run.tzinfo is None:
                    last_run = last_run.replace(tzinfo=timezone.utc)
                elapsed_minutes = (now - last_run).total_seconds() / 60.0
                if elapsed_minutes < frequency_minutes:
                    return  # Not time yet
            except (ValueError, TypeError):
                pass  # If we can't parse, run anyway

        _log.info("Scheduled fetch triggered (frequency=%d min).", frequency_minutes)

        from app.services.fetch_runs import start_and_complete_fetch_run

        start_and_complete_fetch_run()
        _log.info("Scheduled fetch completed successfully.")
    except Exception as exc:
        _log.warning("Scheduled fetch failed: %s", exc)


def start_maintenance_scheduler() -> None:
    global _scheduler
    if _scheduler and _scheduler.running:
        return

    scheduler = BackgroundScheduler(timezone="UTC")
    scheduler.add_job(_scheduled_backup, "interval", hours=24, id="daily_backup", max_instances=1, replace_existing=True)
    scheduler.add_job(
        _scheduled_cleanup,
        "interval",
        hours=24,
        id="daily_retention_cleanup",
        max_instances=1,
        replace_existing=True,
    )
    scheduler.add_job(
        _scheduled_lifecycle_cleanup,
        "interval",
        hours=24,
        id="daily_lifecycle_cleanup",
        max_instances=1,
        replace_existing=True,
    )
    scheduler.add_job(
        _scheduled_fetch_check,
        "interval",
        minutes=2,
        id="fetch_routine_check",
        max_instances=1,
        replace_existing=True,
    )
    scheduler.start()
    _scheduler = scheduler


def stop_maintenance_scheduler() -> None:
    global _scheduler
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
    _scheduler = None


def get_maintenance_scheduler_status() -> str:
    if _scheduler and _scheduler.running:
        return "running"
    return "not_started"
