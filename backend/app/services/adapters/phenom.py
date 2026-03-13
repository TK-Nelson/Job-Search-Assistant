"""
Phenom People adapter – extracts jobs from server-rendered search-results HTML.

Phenom People career sites (used by CVS Health, PNC Bank, U.S. Bank, and many
others) embed a JSON blob inside a ``<script>`` tag or inline JavaScript on
the search-results page.  The blob contains an ``"eagerLoadRefineSearch"`` (or
similar) object whose ``data.jobs`` array holds fully structured job objects.

This adapter fetches the search-results HTML and extracts the embedded JSON
without requiring a headless browser.
"""

from __future__ import annotations

import json
import logging
import urllib.parse
import urllib.request

from .base import BaseAdapter, JobResult

log = logging.getLogger(__name__)

_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"

# Maximum pages to fetch (each page embeds 50 jobs).
_MAX_PAGES = 5


class PhenomAdapter(BaseAdapter):
    """
    Phenom People career-site adapter.

    ``search_url`` should be the full URL to the search-results page,
    e.g. ``https://jobs.cvshealth.com/us/en/search-results``.
    """

    # ── public interface ──────────────────────────────────────────

    def search(
        self,
        search_url: str,
        keywords: list[str],
        limit: int = 20,
    ) -> list[JobResult]:
        query = self._build_query(keywords)
        results: list[JobResult] = []
        offset = 0
        page_size = 50  # Phenom embeds 50 per server-rendered page

        for _ in range(_MAX_PAGES):
            if len(results) >= limit:
                break

            html = self._fetch_html(search_url, query, offset)
            if not html:
                break

            jobs = self._extract_jobs(html)
            if not jobs:
                break

            for j in jobs:
                if len(results) >= limit:
                    break
                result = self._map_job(j, search_url)
                if result:
                    results.append(result)

            # Pagination: Phenom uses ``from=`` param for offset
            if len(jobs) < page_size:
                break  # last page
            offset += page_size

        log.info("Phenom adapter: %d results for '%s' from %s", len(results), query, search_url)
        return results

    # ── helpers ───────────────────────────────────────────────────

    @staticmethod
    def _fetch_html(search_url: str, query: str, offset: int = 0) -> str | None:
        """Fetch the search-results HTML page."""
        params = {
            "keywords": query,
            "from": str(offset),
            "s": "1",
        }
        url = f"{search_url.rstrip('/')}?{urllib.parse.urlencode(params)}"
        req = urllib.request.Request(url, headers={
            "User-Agent": _USER_AGENT,
            "Accept": "text/html,application/xhtml+xml",
        })
        try:
            with urllib.request.urlopen(req, timeout=25) as resp:
                return resp.read().decode("utf-8", errors="ignore")
        except Exception as exc:
            log.warning("Phenom fetch failed for %s: %s", url, exc)
            return None

    @staticmethod
    def _extract_jobs(html: str) -> list[dict]:
        """
        Pull the embedded ``"jobs"`` JSON array from the server-rendered HTML.

        Phenom injects page-state data as inline JS.  We find the first
        ``"jobs":[`` marker followed by an array of objects (bracket-counted)
        and JSON-parse just that array.
        """
        search_from = 0
        while True:
            idx = html.find('"jobs"', search_from)
            if idx == -1:
                return []

            # Advance past "jobs" to find :[
            colon_idx = html.find(":", idx + 6)
            if colon_idx == -1 or colon_idx > idx + 10:
                search_from = idx + 6
                continue

            # Skip whitespace after colon
            arr_start = colon_idx + 1
            while arr_start < len(html) and html[arr_start] in " \t\n\r":
                arr_start += 1

            if arr_start >= len(html) or html[arr_start] != "[":
                search_from = idx + 6
                continue

            # Bracket-count to find matching ]
            depth = 0
            in_string = False
            escape_next = False
            end = -1
            for i in range(arr_start, min(arr_start + 600_000, len(html))):
                c = html[i]
                if escape_next:
                    escape_next = False
                    continue
                if c == "\\" and in_string:
                    escape_next = True
                    continue
                if c == '"':
                    in_string = not in_string
                    continue
                if in_string:
                    continue
                if c == "[":
                    depth += 1
                elif c == "]":
                    depth -= 1
                    if depth == 0:
                        end = i
                        break

            if end == -1:
                search_from = idx + 6
                continue

            try:
                jobs = json.loads(html[arr_start : end + 1])
                if (
                    isinstance(jobs, list)
                    and jobs
                    and isinstance(jobs[0], dict)
                    and any(
                        k in jobs[0]
                        for k in ("title", "jobTitle", "reqId", "applyUrl")
                    )
                ):
                    return jobs
            except json.JSONDecodeError:
                pass

            search_from = idx + 6

    @staticmethod
    def _map_job(raw: dict, base_url: str) -> JobResult | None:
        """Convert a raw Phenom job dict to a ``JobResult``."""
        title = raw.get("title") or raw.get("jobTitle") or ""
        if not title:
            return None

        # Location – try best fields
        location = (
            raw.get("location")
            or raw.get("cityState")
            or raw.get("cityStateCountry")
            or ""
        )

        # URL – prefer the direct apply link, strip /apply suffix for canonical
        apply_url = raw.get("applyUrl") or ""
        if apply_url:
            # Normalise: strip trailing /apply to get canonical posting URL
            url = apply_url.removesuffix("/apply")
        else:
            url = ""

        posted_date = raw.get("postedDate") or raw.get("dateCreated") or None
        # Normalise ISO timestamp → date only  (2026-02-23T00:00:00.000+0000 → 2026-02-23)
        if posted_date and "T" in posted_date:
            posted_date = posted_date.split("T")[0]

        description = raw.get("descriptionTeaser") or title

        return JobResult(
            title=title.strip(),
            location=location.strip(),
            url=url,
            posted_date=posted_date,
            description_text=description.strip(),
        )
