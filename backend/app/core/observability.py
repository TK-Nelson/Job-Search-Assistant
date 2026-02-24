from __future__ import annotations

import contextvars
import json
import logging
from datetime import datetime, timezone
from pathlib import Path

from app.core.settings_store import get_settings


_correlation_id_var: contextvars.ContextVar[str] = contextvars.ContextVar("correlation_id", default="")
_configured = False


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "message": record.getMessage(),
            "module": record.name,
            "correlation_id": getattr(record, "correlation_id", get_correlation_id()),
            "entity_type": getattr(record, "entity_type", None),
            "entity_id": getattr(record, "entity_id", None),
        }
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


def set_correlation_id(value: str) -> None:
    _correlation_id_var.set(value)


def get_correlation_id() -> str:
    return _correlation_id_var.get()


def configure_logging() -> None:
    global _configured
    if _configured:
        return

    settings = get_settings()
    runtime_root = Path(settings.runtime_data_root)
    logs_dir = runtime_root / "logs"
    logs_dir.mkdir(parents=True, exist_ok=True)
    log_path = logs_dir / "app.log"

    root_logger = logging.getLogger()
    root_logger.setLevel(logging.INFO)

    existing_file_handlers = [h for h in root_logger.handlers if isinstance(h, logging.FileHandler)]
    if not existing_file_handlers:
        file_handler = logging.FileHandler(log_path, encoding="utf-8")
        file_handler.setFormatter(JsonFormatter())
        root_logger.addHandler(file_handler)

    _configured = True


def get_logger(name: str) -> logging.Logger:
    configure_logging()
    return logging.getLogger(name)


def log_info(name: str, message: str, **extra: object) -> None:
    logger = get_logger(name)
    logger.info(message, extra={**extra, "correlation_id": get_correlation_id()})


def log_error(name: str, message: str, **extra: object) -> None:
    logger = get_logger(name)
    logger.error(message, extra={**extra, "correlation_id": get_correlation_id()})
