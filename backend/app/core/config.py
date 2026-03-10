"""Centralised application settings.

The runtime-data root (DB, config, artifacts) is resolved **once** at import
time from the ``JSA_RUNTIME_ROOT`` or ``JOB_SEARCH_ASSISTANT_RUNTIME_ROOT``
environment variable.  ``python-dotenv`` loads ``backend/.env`` automatically
so every Python entry-point — the API server, CLI scripts, migrations —
always sees the same value without requiring a wrapper shell script.
"""

import os
from pathlib import Path

# Load backend/.env BEFORE reading any env vars so that JSA_RUNTIME_ROOT
# is available regardless of how the process was launched.
from dotenv import load_dotenv

_env_file = Path(__file__).resolve().parent.parent.parent / ".env"  # backend/.env
load_dotenv(_env_file)


def _runtime_root() -> str:
    """Return the resolved runtime-data root directory.

    Checks ``JOB_SEARCH_ASSISTANT_RUNTIME_ROOT`` first (legacy), then
    ``JSA_RUNTIME_ROOT``.  Both are resolved relative to **backend/**
    so that a value like ``../.runtime`` works from any working directory.
    Falls back to ``%LOCALAPPDATA%/JobSearchAssistant`` only if neither
    variable is set — but that path should be considered deprecated.
    """
    candidate = (
        os.environ.get("JOB_SEARCH_ASSISTANT_RUNTIME_ROOT", "").strip()
        or os.environ.get("JSA_RUNTIME_ROOT", "").strip()
    )
    if candidate:
        # Resolve relative paths against the backend/ directory, not cwd.
        p = Path(candidate)
        if not p.is_absolute():
            p = _env_file.parent / p
        return str(p.resolve())

    # Deprecated fallback — warn if we ever land here.
    import warnings
    warnings.warn(
        "JSA_RUNTIME_ROOT is not set; falling back to %%LOCALAPPDATA%%. "
        "Set JSA_RUNTIME_ROOT in backend/.env to avoid split-database issues.",
        stacklevel=2,
    )
    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        return str(Path(local_app_data) / "JobSearchAssistant")
    return str(Path.home() / "AppData" / "Local" / "JobSearchAssistant")


class AppSettings:
    def __init__(self) -> None:
        self.runtime_data_root = _runtime_root()


app_settings = AppSettings()
