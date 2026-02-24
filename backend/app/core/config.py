import os
from pathlib import Path


def _local_app_data_root() -> str:
    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        return str(Path(local_app_data) / "JobSearchAssistant")

    fallback = Path.home() / "AppData" / "Local" / "JobSearchAssistant"
    return str(fallback)


class AppSettings:
    def __init__(self) -> None:
        self.runtime_data_root = _local_app_data_root()


app_settings = AppSettings()
