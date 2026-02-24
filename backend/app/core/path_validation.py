import os
from pathlib import Path

from app.schemas.settings import PathValidationResult


def _expand(path_value: str) -> Path:
    expanded = os.path.expandvars(path_value)
    return Path(expanded).expanduser().resolve()


def _contains_onedrive(path_obj: Path) -> bool:
    parts = [part.lower() for part in path_obj.parts]
    return "onedrive" in parts


def _can_write(path_obj: Path) -> tuple[bool, str | None]:
    try:
        probe_dir = path_obj if path_obj.suffix == "" else path_obj.parent
        probe_dir.mkdir(parents=True, exist_ok=True)
        probe = probe_dir / ".write_test"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink(missing_ok=True)
        return True, None
    except Exception as exc:
        return False, str(exc)


def validate_candidate_paths(
    runtime_data_root: str,
    database_path: str,
    artifacts_dir: str,
    backups_dir: str,
) -> PathValidationResult:
    warnings: list[str] = []
    errors: list[str] = []

    paths = {
        "runtime_data_root": _expand(runtime_data_root),
        "database_path": _expand(database_path),
        "artifacts_dir": _expand(artifacts_dir),
        "backups_dir": _expand(backups_dir),
    }

    for key, path_obj in paths.items():
        if _contains_onedrive(path_obj):
            warnings.append(f"{key} appears to be in a OneDrive-synced folder: {path_obj}")

        writable, reason = _can_write(path_obj)
        if not writable:
            errors.append(f"{key} is not writable: {reason}")

    valid = len(errors) == 0
    return PathValidationResult(valid=valid, warnings=warnings, errors=errors)
