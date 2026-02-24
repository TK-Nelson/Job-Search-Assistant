from fastapi import APIRouter

from app.core.config import app_settings
from app.core.secret_store import secret_store_ready
from app.db.database import db_file_exists
from app.jobs.maintenance_scheduler import get_maintenance_scheduler_status

router = APIRouter()


@router.get("/health")
def health() -> dict:
    return {
        "db_ready": db_file_exists(),
        "scheduler_status": get_maintenance_scheduler_status(),
        "secret_store_ready": secret_store_ready(),
        "app_version": "0.1.0",
        "runtime_data_root": app_settings.runtime_data_root,
    }
