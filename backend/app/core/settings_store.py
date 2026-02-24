import json
from pathlib import Path

from app.core.config import app_settings
from app.schemas.settings import AppConfig


def settings_file_path() -> Path:
    root = Path(app_settings.runtime_data_root)
    config_dir = root / "config"
    config_dir.mkdir(parents=True, exist_ok=True)
    return config_dir / "app_config.json"


def default_settings() -> AppConfig:
    root = Path(app_settings.runtime_data_root)
    return AppConfig(
        environment="local",
        runtime_data_root=str(root),
        database={"path": str(root / "data" / "job_assistant.db")},
        storage={
            "artifacts_dir": str(root / "data" / "artifacts"),
            "backups_dir": str(root / "data" / "backups"),
            "encrypt_artifacts": True,
        },
        resume={"allowed_extensions": [".docx"], "max_size_mb": 2},
        fetch={
            "interval_minutes": 120,
            "max_workers": 2,
            "timeout_seconds": 20,
            "max_retries": 3,
            "backoff_seconds": [1, 3, 8],
            "role_filters": {
                "enabled": False,
                "title_contains": [],
                "description_contains": [],
                "match_mode": "any",
            },
        },
        scoring={
            "weights": {
                "ats_searchability": 0.35,
                "hard_skills": 0.45,
                "soft_skills": 0.2,
            },
            "minimum_confidence_for_strong_recommendation": 0.7,
        },
        retention={"job_postings_days": 180, "logs_days": 30},
    )


def get_settings() -> AppConfig:
    path = settings_file_path()
    if not path.exists():
        defaults = default_settings()
        save_settings(defaults)
        return defaults

    data = json.loads(path.read_text(encoding="utf-8"))
    return AppConfig.model_validate(data)


def save_settings(config: AppConfig) -> None:
    path = settings_file_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(config.model_dump_json(indent=2), encoding="utf-8")
