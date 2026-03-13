"""Workday adapter – uses the public ``/wday/cxs/…/jobs`` JSON API."""

from __future__ import annotations

import json
import logging
import time
import urllib.request

from .base import BaseAdapter, JobResult

_log = logging.getLogger(__name__)
_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"


def _build_api_url(search_url: str) -> tuple[str, str]:
    """
    Derive the Workday REST endpoint and job-link base from *search_url*.

    Accepted formats
    ----------------
    • Full API URL:  ``https://{org}.{wd}.myworkdayjobs.com/wday/cxs/{org}/{board}/jobs``
    • Careers URL:   ``https://{org}.{wd}.myworkdayjobs.com/{board}``

    Returns ``(api_url, job_base)``  where *job_base* is used to build
    absolute URLs for individual postings.
    """
    stripped = search_url.rstrip("/")
    if "/wday/cxs/" in stripped and stripped.endswith("/jobs"):
        # Already a full API URL
        # job_base = everything before /wday/cxs/ + board slug
        parts = stripped.split("/wday/cxs/")
        base_domain = parts[0]
        # e.g. "generalmotors/Careers_GM/jobs" → board = Careers_GM
        cxs_parts = parts[1].split("/")
        board = cxs_parts[1] if len(cxs_parts) >= 2 else ""
        return stripped, f"{base_domain}/{board}"

    # Assume careers URL: https://{org}.{wd}.myworkdayjobs.com/{board}
    from urllib.parse import urlparse

    parsed = urlparse(stripped)
    host = parsed.netloc  # e.g. generalmotors.wd5.myworkdayjobs.com
    path_parts = [p for p in parsed.path.strip("/").split("/") if p]
    # First meaningful path segment is the board slug (e.g. "Careers_GM")
    # Filter out locale segments like "en-US"
    board = next((p for p in path_parts if not p.startswith("en")), path_parts[0] if path_parts else "jobs")
    org = host.split(".")[0]  # e.g. "generalmotors"
    api_url = f"https://{host}/wday/cxs/{org}/{board}/jobs"
    job_base = f"https://{host}/{board}"
    return api_url, job_base


class WorkdayAdapter(BaseAdapter):
    """
    Workday exposes a public POST endpoint that accepts ``searchText``
    and returns ``jobPostings[]`` with *title*, *locationsText*,
    *externalPath*, *postedOn*.
    """

    def search(
        self,
        search_url: str,
        keywords: list[str],
        limit: int = 20,
    ) -> list[JobResult]:
        api_url, job_base = _build_api_url(search_url)
        query = self._build_query(keywords)
        _log.info("Workday query=%r  api_url=%s  keywords=%r", query, api_url, keywords)

        headers = {
            "User-Agent": _USER_AGENT,
            "Accept": "application/json",
            "Content-Type": "application/json",
        }

        # Workday caps per-page at 20; paginate to honour the caller's limit.
        _PAGE_SIZE = 20
        all_postings: list[dict] = []
        offset = 0
        while len(all_postings) < limit:
            page_limit = min(_PAGE_SIZE, limit - len(all_postings))
            payload = json.dumps({
                "appliedFacets": {},
                "limit": page_limit,
                "offset": offset,
                "searchText": query,
            }).encode()

            # Workday occasionally returns transient 400s (rate-limit);
            # retry up to 2 times with increasing backoff.
            last_err: Exception | None = None
            for attempt in range(3):
                req = urllib.request.Request(api_url, data=payload, headers=headers)
                try:
                    with urllib.request.urlopen(req, timeout=20) as resp:
                        data = json.loads(resp.read().decode("utf-8", errors="ignore"))
                    _log.info("Workday offset=%d attempt=%d success, total=%d", offset, attempt, data.get("total", 0))
                    break
                except urllib.error.HTTPError as exc:
                    last_err = exc
                    _log.warning("Workday offset=%d attempt=%d HTTP %d", offset, attempt, exc.code)
                    if exc.code in (400, 429) and attempt < 2:
                        time.sleep(3 * (attempt + 1))
                        continue
                    raise
            else:
                raise last_err  # type: ignore[misc]

            page_postings = data.get("jobPostings", [])
            all_postings.extend(page_postings)
            total = data.get("total", 0)

            # Stop if we've exhausted results
            if not page_postings or offset + len(page_postings) >= total:
                break
            offset += len(page_postings)
            time.sleep(0.5)  # polite delay between pages

        results: list[JobResult] = []
        for jp in all_postings[:limit]:
            ext_path = jp.get("externalPath", "")
            abs_url = f"{job_base.rstrip('/')}{ext_path}" if ext_path.startswith("/") else ext_path
            # Workday postedOn is human-readable like "Posted 2 Days Ago"
            posted = jp.get("postedOn", "")
            bullet = jp.get("bulletFields", [])
            desc_parts = [str(b) for b in bullet if b] if bullet else []
            results.append(
                JobResult(
                    title=jp.get("title", "Untitled"),
                    location=jp.get("locationsText", "Unknown"),
                    url=abs_url,
                    posted_date=posted if posted else None,
                    description_text=" · ".join(desc_parts) if desc_parts else jp.get("title", ""),
                )
            )
        return results
