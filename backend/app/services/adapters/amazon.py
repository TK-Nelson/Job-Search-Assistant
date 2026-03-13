"""Amazon Jobs adapter – uses the /search.json public API."""

from __future__ import annotations

import json
import urllib.request
from urllib.parse import quote_plus

from .base import BaseAdapter, JobResult

_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"


class AmazonJobsAdapter(BaseAdapter):
    """
    Amazon's career site exposes ``/search.json`` which returns structured
    JSON with ``jobs[]`` containing *title*, *location*, *job_path*,
    *posted_date*, and *description_short*.
    """

    def search(
        self,
        search_url: str,
        keywords: list[str],
        limit: int = 20,
    ) -> list[JobResult]:
        query = self._build_query(keywords)
        url = (
            f"{search_url.rstrip('/')}?base_query={quote_plus(query)}"
            f"&country%5B%5D=USA&result_limit={limit}&sort=relevant"
        )
        req = urllib.request.Request(url, headers={
            "User-Agent": _USER_AGENT,
            "Accept": "application/json",
        })
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read().decode("utf-8", errors="ignore"))

        results: list[JobResult] = []
        for job in data.get("jobs", [])[:limit]:
            job_path = job.get("job_path", "")
            abs_url = f"https://www.amazon.jobs{job_path}" if job_path.startswith("/") else job_path
            city = job.get("city", "")
            state = job.get("state", "")
            location_parts = [p for p in (city, state) if p]
            results.append(
                JobResult(
                    title=job.get("title", "Untitled"),
                    location=", ".join(location_parts) if location_parts else job.get("location", "Unknown"),
                    url=abs_url,
                    posted_date=job.get("posted_date"),
                    description_text=job.get("description_short", job.get("title", "")),
                )
            )
        return results
