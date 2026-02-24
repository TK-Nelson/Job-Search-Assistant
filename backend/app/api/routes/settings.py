from fastapi import APIRouter, HTTPException

from app.core.path_validation import validate_candidate_paths
from app.core.settings_store import get_settings, save_settings
from app.schemas.settings import AppConfig, PathValidationRequest, PathValidationResult

router = APIRouter()


@router.get("/settings", response_model=AppConfig)
def read_settings() -> AppConfig:
    return get_settings()


@router.put("/settings", response_model=AppConfig)
def update_settings(payload: AppConfig) -> AppConfig:
    validation = validate_candidate_paths(
        runtime_data_root=payload.runtime_data_root,
        database_path=payload.database.path,
        artifacts_dir=payload.storage.artifacts_dir,
        backups_dir=payload.storage.backups_dir,
    )

    if not validation.valid:
        raise HTTPException(status_code=400, detail={"code": "VALIDATION_ERROR", "errors": validation.errors})

    save_settings(payload)
    return payload


@router.post("/settings/validate-paths", response_model=PathValidationResult)
def validate_paths(payload: PathValidationRequest) -> PathValidationResult:
    return validate_candidate_paths(
        runtime_data_root=payload.runtime_data_root,
        database_path=payload.database_path,
        artifacts_dir=payload.artifacts_dir,
        backups_dir=payload.backups_dir,
    )
