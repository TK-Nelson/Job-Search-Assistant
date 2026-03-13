import json
from pathlib import Path

from fastapi import APIRouter, HTTPException

from app.core.path_validation import validate_candidate_paths
from app.core.settings_store import get_settings, save_settings
from app.schemas.settings import (
    AppConfig,
    PathValidationRequest,
    PathValidationResult,
)

router = APIRouter()

PROFILE_DEFAULT = {
    "profile_version": "1.0",
    "owner": {
        "display_name": "",
        "target_roles": ["UX Designer", "Product Designer"],
        "positioning_preference": "strategy_plus_execution",
    },
    "portfolio_sources": [],
    "experience_signals": {
        "industries": [],
        "scope_patterns": [],
        "leadership_signals": [],
        "outcome_examples": [],
    },
    "review_preferences": {
        "prioritize_positioning_mismatch": True,
        "auto_rewrite_enabled": False,
        "evidence_strict_mode": True,
    },
}


def _profile_path() -> Path:
    repo_root = Path(__file__).resolve().parents[4]
    return repo_root / "config" / "personal_profile.local.json"


def _read_profile() -> dict:
    path = _profile_path()
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(PROFILE_DEFAULT, indent=2), encoding="utf-8")
        return PROFILE_DEFAULT
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return PROFILE_DEFAULT


def _save_profile(payload: dict) -> dict:
    path = _profile_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return payload


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


@router.get("/settings/personal-profile")
def read_personal_profile() -> dict:
    return _read_profile()


@router.put("/settings/personal-profile")
def update_personal_profile(payload: dict) -> dict:
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail={"code": "VALIDATION_ERROR", "message": "Payload must be an object."})
    return _save_profile(payload)


# ---------------------------------------------------------------------------
# Gemini API key management
# ---------------------------------------------------------------------------

@router.get("/settings/gemini-key")
def get_gemini_key_status() -> dict:
    """Return whether a key is stored (never exposes the actual key)."""
    from app.core.secret_store import get_secret
    key = get_secret("gemini_api_key")
    masked = f"{key[:4]}…{key[-4:]}" if key and len(key) > 8 else None
    return {"configured": bool(key), "masked_key": masked}


@router.put("/settings/gemini-key")
def set_gemini_key(payload: dict) -> dict:
    """Store or clear the Gemini API key."""
    from app.core.secret_store import set_secret, get_secret
    from app.services.gemini import reset_client

    api_key = str(payload.get("api_key", "") or "").strip()
    if not api_key:
        # Clear the key
        try:
            import keyring
            keyring.delete_password("JobSearchAssistant", "gemini_api_key")
        except Exception:
            pass
        reset_client()
        return {"configured": False, "masked_key": None}

    set_secret("gemini_api_key", api_key)
    reset_client()

    masked = f"{api_key[:4]}…{api_key[-4:]}" if len(api_key) > 8 else "****"
    return {"configured": True, "masked_key": masked}


@router.get("/settings/gemini-usage")
def get_gemini_usage() -> dict:
    """Return current Gemini rate limiter state."""
    from app.services.gemini import get_rate_state
    return get_rate_state().usage_summary()
