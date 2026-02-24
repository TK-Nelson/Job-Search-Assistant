from __future__ import annotations

import shutil
import sqlite3
from datetime import datetime
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

from fastapi import HTTPException

from app.core.settings_store import get_settings
from app.db.database import get_connection, get_db_path
from app.schemas.maintenance import BackupRead


def _backups_dir() -> Path:
    settings = get_settings()
    path = Path(settings.storage.backups_dir)
    path.mkdir(parents=True, exist_ok=True)
    return path


def _artifacts_dir() -> Path:
    settings = get_settings()
    path = Path(settings.storage.artifacts_dir)
    path.mkdir(parents=True, exist_ok=True)
    return path


def _latest_backup_path() -> Path | None:
    backups = sorted(_backups_dir().glob("job_assistant_backup_*.zip"), key=lambda p: p.stat().st_mtime, reverse=True)
    return backups[0] if backups else None


def _safe_members(members: list[str]) -> bool:
    for member in members:
        if member.startswith("/") or ".." in Path(member).parts:
            return False
    return True


def create_backup() -> tuple[str, str]:
    db_path = get_db_path()
    if not db_path.exists():
        raise HTTPException(
            status_code=400,
            detail={"code": "VALIDATION_ERROR", "message": "Database file does not exist yet. Initialize DB first."},
        )

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_name = f"job_assistant_backup_{timestamp}.zip"
    backup_path = _backups_dir() / backup_name

    with get_connection() as conn:
        conn.execute("VACUUM")
        conn.commit()

    artifacts_dir = _artifacts_dir()
    with ZipFile(backup_path, "w", ZIP_DEFLATED) as archive:
        archive.write(db_path, arcname="db/job_assistant.db")
        if artifacts_dir.exists():
            for file_path in artifacts_dir.rglob("*"):
                if file_path.is_file():
                    rel = file_path.relative_to(artifacts_dir)
                    archive.write(file_path, arcname=str(Path("artifacts") / rel))

    return backup_name, str(backup_path)


def list_backups() -> list[BackupRead]:
    items: list[BackupRead] = []
    for file_path in sorted(_backups_dir().glob("job_assistant_backup_*.zip"), key=lambda p: p.stat().st_mtime, reverse=True):
        stat = file_path.stat()
        items.append(
            BackupRead(
                name=file_path.name,
                path=str(file_path),
                size_bytes=stat.st_size,
                created_at=datetime.fromtimestamp(stat.st_mtime).isoformat(),
            )
        )
    return items


def restore_backup(backup_name: str | None = None) -> str:
    backup_path = _backups_dir() / backup_name if backup_name else _latest_backup_path()
    if backup_path is None or not backup_path.exists():
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Backup not found."})

    db_path = get_db_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    artifacts_dir = _artifacts_dir()

    temp_extract = _backups_dir() / "_restore_tmp"
    if temp_extract.exists():
        shutil.rmtree(temp_extract, ignore_errors=True)
    temp_extract.mkdir(parents=True, exist_ok=True)

    with ZipFile(backup_path, "r") as archive:
        names = archive.namelist()
        if not _safe_members(names):
            raise HTTPException(status_code=400, detail={"code": "VALIDATION_ERROR", "message": "Unsafe backup archive."})
        archive.extractall(temp_extract)

    db_backup = temp_extract / "db" / "job_assistant.db"
    if not db_backup.exists():
        raise HTTPException(status_code=400, detail={"code": "VALIDATION_ERROR", "message": "Backup missing database file."})

    shutil.copy2(db_backup, db_path)

    extracted_artifacts = temp_extract / "artifacts"
    if extracted_artifacts.exists():
        artifacts_dir.mkdir(parents=True, exist_ok=True)
        for file_path in extracted_artifacts.rglob("*"):
            if file_path.is_file():
                rel = file_path.relative_to(extracted_artifacts)
                target = artifacts_dir / rel
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(file_path, target)

    shutil.rmtree(temp_extract, ignore_errors=True)
    return backup_path.name


def run_retention_cleanup() -> tuple[int, int]:
    settings = get_settings()
    deleted_job_postings = 0
    deleted_log_files = 0

    try:
        with get_connection() as conn:
            cutoff_days = max(1, int(settings.retention.job_postings_days))
            deleted_job_postings = conn.execute(
                """
                DELETE FROM job_postings
                WHERE status != 'active' AND first_seen_at < datetime('now', ?)
                """,
                (f"-{cutoff_days} day",),
            ).rowcount
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

    runtime_root = Path(settings.runtime_data_root)
    logs_dir = runtime_root / "logs"
    if logs_dir.exists():
        cutoff_seconds = datetime.now().timestamp() - (max(1, int(settings.retention.logs_days)) * 86400)
        for log_file in logs_dir.rglob("*.log"):
            try:
                if log_file.stat().st_mtime < cutoff_seconds:
                    log_file.unlink(missing_ok=True)
                    deleted_log_files += 1
            except OSError:
                continue

    return deleted_job_postings, deleted_log_files
