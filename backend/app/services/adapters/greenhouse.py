"""Greenhouse adapter – uses the public boards JSON API."""

from __future__ import annotations

import json
import re
import urllib.request
from html.parser import HTMLParser
from urllib.parse import urlparse

from .base import BaseAdapter, JobResult

_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
_API_BASE = "https://boards-api.greenhouse.io/v1/boards"


class _HTMLStripper(HTMLParser):
    """Tiny helper to strip HTML tags from Greenhouse content."""

    def __init__(self) -> None:
        super().__init__()
        self._parts: list[str] = []

    def handle_data(self, data: str) -> None:
        self._parts.append(data)

    def get_text(self) -> str:
        return " ".join(self._parts).strip()


def _strip_html(html: str) -> str:
    s = _HTMLStripper()
    s.feed(html)
    return s.get_text()


def _resolve_board_slug(search_url: str) -> str:
    """
    Derive the Greenhouse board slug from *search_url*.

    Accepted formats
    ----------------
    • Slug only:  ``twitch``
    • API URL:    ``https://boards-api.greenhouse.io/v1/boards/twitch/jobs``
    • Board URL:  ``https://boards.greenhouse.io/twitch``
    • Job-boards: ``https://job-boards.greenhouse.io/twitch``
    """
    s = search_url.strip().rstrip("/")
    if not s:
        raise ValueError("Empty search_url for Greenhouse adapter")

    # Plain slug (no slashes, no dots)
    if "/" not in s and "." not in s:
        return s

    parsed = urlparse(s)
    parts = [p for p in parsed.path.strip("/").split("/") if p]

    # API URL: /v1/boards/{slug}/jobs → slug is after "boards"
    if "boards" in parts:
        idx = parts.index("boards")
        if idx + 1 < len(parts):
            return parts[idx + 1]

    # Fallback: first path segment
    return parts[0] if parts else s


class GreenhouseAdapter(BaseAdapter):
    """
    Greenhouse boards API returns all jobs for a board in one call.
    We filter client-side by keyword.
    """

    def search(
        self,
        search_url: str,
        keywords: list[str],
        limit: int = 20,
    ) -> list[JobResult]:
        slug = _resolve_board_slug(search_url)
        url = f"{_API_BASE}/{slug}/jobs?content=true"

        req = urllib.request.Request(url, headers={
            "User-Agent": _USER_AGENT,
            "Accept": "application/json",
        })
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read().decode("utf-8", errors="ignore"))

        all_jobs = data.get("jobs", [])

        # Client-side keyword filter
        kw_lower = [k.lower() for k in keywords if k]
        if kw_lower:
            filtered = []
            for j in all_jobs:
                text = (
                    f"{j.get('title', '')} "
                    f"{_strip_html(j.get('content', ''))} "
                    f"{j.get('location', {}).get('name', '') if isinstance(j.get('location'), dict) else ''}"
                ).lower()
                if any(kw in text for kw in kw_lower):
                    filtered.append(j)
            all_jobs = filtered

        results: list[JobResult] = []
        for j in all_jobs[:limit]:
            loc = j.get("location", {})
            location_name = loc.get("name", "Unknown") if isinstance(loc, dict) else str(loc)
            content = _strip_html(j.get("content", ""))[:500]  # truncate for storage
            results.append(
                JobResult(
                    title=j.get("title", "Untitled"),
                    location=location_name,
                    url=j.get("absolute_url", ""),
                    posted_date=j.get("first_published") or j.get("updated_at"),
                    description_text=content if content else j.get("title", ""),
                )
            )
        return results
