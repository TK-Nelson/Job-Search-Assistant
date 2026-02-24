from __future__ import annotations

from apscheduler.schedulers.background import BackgroundScheduler

from app.services.maintenance import create_backup, run_retention_cleanup


_scheduler: BackgroundScheduler | None = None


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
