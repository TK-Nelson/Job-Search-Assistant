"""Deloitte careers adapter – scrapes the server-rendered search page."""

from __future__ import annotations

import re
import urllib.request
from urllib.parse import quote_plus, urljoin

from .base import BaseAdapter, JobResult

_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"


class DeloitteAdapter(BaseAdapter):
    """
    Deloitte's career site renders job listings server-side.  The search page at
    ``/SearchJobs/{keywords}`` contains ``<a href="…JobDetail…">Title</a>`` links
    that we extract with regex.
    """

    def search(
        self,
        search_url: str,
        keywords: list[str],
        limit: int = 20,
    ) -> list[JobResult]:
        query = quote_plus(self._build_query(keywords))
        base = search_url.rstrip("/")

        # Ensure the base ends at the SearchJobs level
        if not base.endswith("/SearchJobs") and "/SearchJobs" not in base:
            base = f"{base}/SearchJobs"

        url = (
            f"{base}/{query}"
            f"?listFilterMode=1&jobRecordsPerPage={limit}&sort=relevancy"
        )

        req = urllib.request.Request(url, headers={
            "User-Agent": _USER_AGENT,
            "Accept": "text/html",
        })
        with urllib.request.urlopen(req, timeout=20) as resp:
            html = resp.read().decode("utf-8", errors="ignore")

        # Extract JobDetail links: href="…/JobDetail/…" followed by link text
        pattern = re.compile(
            r'href="([^"]*JobDetail[^"]*)"[^>]*>([^<]+)',
            re.IGNORECASE,
        )

        seen_urls: set[str] = set()
        results: list[JobResult] = []

        for m in pattern.finditer(html):
            href = m.group(1).strip()
            title = m.group(2).strip()
            if not title or not href:
                continue

            abs_url = urljoin(url, href)
            if abs_url in seen_urls:
                continue
            seen_urls.add(abs_url)

            results.append(
                JobResult(
                    title=title,
                    location="Unknown",  # location not reliably in the search listing HTML
                    url=abs_url,
                    posted_date=None,
                    description_text=title,
                )
            )
            if len(results) >= limit:
                break

        return results
