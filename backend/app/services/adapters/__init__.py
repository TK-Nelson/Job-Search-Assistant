"""Portal adapters for job search ingestion."""

from .base import BaseAdapter, JobResult
from .registry import (
    SUPPORTED_PORTAL_TYPES,
    derive_search_url,
    detect_portal_type,
    get_adapter,
)

__all__ = [
    "BaseAdapter",
    "JobResult",
    "SUPPORTED_PORTAL_TYPES",
    "derive_search_url",
    "detect_portal_type",
    "get_adapter",
]
