import os
from pathlib import Path


def _runtime_root_override() -> str | None:
    candidate = (
        os.environ.get("JOB_SEARCH_ASSISTANT_RUNTIME_ROOT", "").strip()
        or os.environ.get("JSA_RUNTIME_ROOT", "").strip()
    )
    if not candidate:
        return None
    return str(Path(candidate).expanduser().resolve())


def _local_app_data_root() -> str:
    override = _runtime_root_override()
    if override:
        return override

    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        return str(Path(local_app_data) / "JobSearchAssistant")

    fallback = Path.home() / "AppData" / "Local" / "JobSearchAssistant"
    return str(fallback)


class AppSettings:
    def __init__(self) -> None:
        self.runtime_data_root = _local_app_data_root()


app_settings = AppSettings()
