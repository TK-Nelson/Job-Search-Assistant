"""
Activate adapter – fetches jobs from the Activate (Jeturk / jTurk) ATS platform.

Used by Huntington Bank and similar organisations.  The platform exposes a
simple JSON API at ``/Search/SearchResults`` that returns paginated job records.

Quirks
------
* The HTTP response body is **double-JSON-encoded** – the outer layer is a
  JSON string whose value is itself a JSON object.  We must call
  ``json.loads()`` twice.
* Several fields (``Title``, ``CityStateDataAbbrev``, …) contain inline
  ``<span>`` tags for highlighting.  We strip those before returning results.
"""

from __future__ import annotations

import json
import logging
import re
import urllib.parse
import urllib.request

from .base import BaseAdapter, JobResult

log = logging.getLogger(__name__)

_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"

_STRIP_HTML = re.compile(r"<[^>]+>")


class ActivateAdapter(BaseAdapter):
    """
    Activate career-site adapter.

    ``search_url`` should be the base site URL (e.g.
    ``https://huntington-careers.com``).  The adapter appends the
    ``/Search/SearchResults`` endpoint automatically.
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
        page_size = min(limit, 50)

        while len(results) < limit:
            records, total = self._fetch_page(search_url, query, offset, page_size)
            if records is None:
                break

            for rec in records:
                if len(results) >= limit:
                    break
                result = self._map_record(rec, search_url)
                if result:
                    results.append(result)

            offset += page_size
            if offset >= total or not records:
                break

        log.info(
            "Activate adapter: %d results for '%s' from %s",
            len(results), query, search_url,
        )
        return results

    # ── helpers ───────────────────────────────────────────────────

    @staticmethod
    def _api_url(search_url: str) -> str:
        """Derive the API endpoint from the base site URL."""
        base = search_url.rstrip("/")
        # If the URL already ends with the endpoint path, use it as-is.
        if base.endswith("/Search/SearchResults"):
            return base
        # Strip any path beyond the host (e.g. /search/searchjobs)
        parsed = urllib.parse.urlparse(base)
        return f"{parsed.scheme}://{parsed.netloc}/Search/SearchResults"

    @classmethod
    def _fetch_page(
        cls,
        search_url: str,
        query: str,
        offset: int,
        page_size: int,
    ) -> tuple[list[dict] | None, int]:
        """
        Fetch one page of results.

        Returns ``(records, total_count)`` or ``(None, 0)`` on failure.
        """
        params = {
            "keyword": query,
            "jtStartIndex": str(offset),
            "jtPageSize": str(page_size),
            "jtSorting": "",
        }
        url = f"{cls._api_url(search_url)}?{urllib.parse.urlencode(params)}"
        req = urllib.request.Request(url, headers={
            "User-Agent": _USER_AGENT,
            "Accept": "application/json",
            "X-Requested-With": "XMLHttpRequest",
        })

        try:
            with urllib.request.urlopen(req, timeout=25) as resp:
                raw = resp.read().decode("utf-8", errors="ignore")
        except Exception as exc:
            log.warning("Activate fetch failed for %s: %s", url, exc)
            return None, 0

        # Double-JSON-decode
        try:
            data = json.loads(json.loads(raw))
        except (json.JSONDecodeError, TypeError):
            # Fallback: maybe only single-encoded
            try:
                data = json.loads(raw)
            except (json.JSONDecodeError, TypeError):
                log.warning("Activate: could not decode JSON from %s", url)
                return None, 0

        if not isinstance(data, dict) or data.get("Result") != "OK":
            log.warning("Activate: unexpected response from %s: %s", url, str(data)[:200])
            return None, 0

        records = data.get("Records", [])
        total = data.get("TotalRecordCount", 0)
        return records, total

    @classmethod
    def _map_record(cls, rec: dict, search_url: str) -> JobResult | None:
        """Map one Activate record to a ``JobResult``."""
        title = cls._clean(rec.get("Title", ""))
        if not title:
            return None

        job_id = rec.get("ID", "")
        location = cls._clean_location(rec.get("CityStateDataAbbrev", ""))

        posted = rec.get("PostedDateRaw", None)

        # Build the detail URL
        parsed = urllib.parse.urlparse(search_url.rstrip("/"))
        base = f"{parsed.scheme}://{parsed.netloc}"
        slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
        detail_url = f"{base}/search/jobdetails/{slug}/{job_id}" if job_id else ""

        return JobResult(
            title=title,
            location=location,
            url=detail_url,
            posted_date=posted,
            description_text=title,
        )

    @staticmethod
    def _clean(value: str) -> str:
        """Strip HTML tags (replacing <br/> with newline) and collapse whitespace."""
        # Turn <br>, <br/>, <br /> into newlines before stripping other tags
        text = re.sub(r"<br\s*/?>", "\n", value, flags=re.I)
        text = _STRIP_HTML.sub("", text)
        return " ".join(text.split()).strip()

    @staticmethod
    def _clean_location(value: str) -> str:
        """Clean location field, keeping only the first location."""
        # Multiple locations appear as adjacent <span> tags with no separator.
        # Insert a pipe between closing/opening tags before stripping HTML.
        text = re.sub(r"</span>\s*<span>", " | ", value, flags=re.I)
        text = _STRIP_HTML.sub("", text)
        # Take the first location
        first = text.split("|")[0].strip().rstrip(",")
        return first
