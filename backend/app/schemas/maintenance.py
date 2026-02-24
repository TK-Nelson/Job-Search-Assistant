from pydantic import BaseModel


class BackupRead(BaseModel):
    name: str
    path: str
    size_bytes: int
    created_at: str


class BackupListResponse(BaseModel):
    items: list[BackupRead]
    count: int


class BackupCreateResponse(BaseModel):
    status: str
    backup_name: str
    backup_path: str


class RestoreRequest(BaseModel):
    backup_name: str | None = None


class RestoreResponse(BaseModel):
    status: str
    restored_backup_name: str


class RetentionCleanupResponse(BaseModel):
    status: str
    deleted_job_postings: int
    deleted_log_files: int
