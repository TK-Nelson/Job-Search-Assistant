from fastapi import APIRouter

from app.schemas.maintenance import (
    BackupCreateResponse,
    BackupListResponse,
    RestoreRequest,
    RestoreResponse,
    RetentionCleanupResponse,
)
from app.services.maintenance import create_backup, list_backups, restore_backup, run_retention_cleanup

router = APIRouter()


@router.get("/maintenance/backups", response_model=BackupListResponse)
def get_backups() -> BackupListResponse:
    items = list_backups()
    return BackupListResponse(items=items, count=len(items))


@router.post("/maintenance/backup", response_model=BackupCreateResponse)
def create_backup_endpoint() -> BackupCreateResponse:
    backup_name, backup_path = create_backup()
    return BackupCreateResponse(status="ok", backup_name=backup_name, backup_path=backup_path)


@router.post("/maintenance/restore", response_model=RestoreResponse)
def restore_backup_endpoint(payload: RestoreRequest) -> RestoreResponse:
    restored_backup = restore_backup(payload.backup_name)
    return RestoreResponse(status="ok", restored_backup_name=restored_backup)


@router.post("/maintenance/cleanup", response_model=RetentionCleanupResponse)
def cleanup_endpoint() -> RetentionCleanupResponse:
    deleted_postings, deleted_logs = run_retention_cleanup()
    return RetentionCleanupResponse(
        status="ok",
        deleted_job_postings=deleted_postings,
        deleted_log_files=deleted_logs,
    )
