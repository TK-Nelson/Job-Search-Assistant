"""TalentBrew / TMP Worldwide adapter (Capital One–style JSON+HTML results)."""

from __future__ import annotations

import json
import re
import urllib.request
from urllib.parse import quote_plus, urljoin, urlparse

from .base import BaseAdapter, JobResult

_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"


def _extract_jobs_from_results_html(html: str, base_url: str) -> list[dict]:
    """
    The TalentBrew ``/search-jobs/results`` endpoint returns JSON whose
    ``results`` field is an HTML string containing job cards like::

        <a href="/job/…" data-job-id="…">
          <div class="job-search-info">
            <span>ID</span>
            <span class="job-date-posted">MM/DD/YYYY</span>
          </div>
          <h2>Job Title</h2>
          <span class="job-location">City, ST</span>
        </a>
    """
    jobs: list[dict] = []

    # Match each <a> block pointing to a /job/ page
    link_pattern = re.compile(
        r'<a[^>]+href="(/job/[^"]+)"[^>]*>(.*?)</a>',
        re.IGNORECASE | re.DOTALL,
    )
    title_pattern = re.compile(r'<h2[^>]*>(.*?)</h2>', re.I | re.DOTALL)
    loc_pattern = re.compile(
        r'<span[^>]*class="[^"]*job-location[^"]*"[^>]*>(.*?)</span>',
        re.I | re.DOTALL,
    )
    date_pattern = re.compile(
        r'<span[^>]*class="[^"]*job-date-posted[^"]*"[^>]*>(.*?)</span>',
        re.I | re.DOTALL,
    )

    for m in link_pattern.finditer(html):
        href = m.group(1)
        inner = m.group(2)

        # Extract title from <h2>
        title_m = title_pattern.search(inner)
        if title_m:
            title = re.sub(r"<[^>]+>", "", title_m.group(1)).strip()
        else:
            # Fallback: strip all tags from the full anchor content
            title = re.sub(r"<[^>]+>", "", inner).strip()
            # Try to extract just the meaningful part (skip ID/date lines)
            lines = [ln.strip() for ln in title.splitlines() if ln.strip()]
            # Filter out purely numeric lines and date-like lines
            meaningful = [
                ln for ln in lines
                if not re.match(r'^\d+$', ln) and not re.match(r'^\d{2}/\d{2}/\d{4}$', ln)
            ]
            title = meaningful[0] if meaningful else (lines[0] if lines else "")

        if not title:
            continue

        # Extract location
        loc_m = loc_pattern.search(inner)
        location = re.sub(r"<[^>]+>", "", loc_m.group(1)).strip() if loc_m else "Unknown"

        # Extract posted date
        date_m = date_pattern.search(inner)
        posted_date = date_m.group(1).strip() if date_m else None

        abs_url = urljoin(base_url, href)
        jobs.append({
            "title": title,
            "url": abs_url,
            "location": location,
            "posted_date": posted_date,
        })

    return jobs


class TalentBrewAdapter(BaseAdapter):
    """
    TalentBrew sites expose ``/search-jobs/results`` which returns JSON
    with a ``results`` field containing an HTML fragment of job cards.
    """

    def search(
        self,
        search_url: str,
        keywords: list[str],
        limit: int = 20,
    ) -> list[JobResult]:
        query = self._build_query(keywords)
        base = search_url.rstrip("/")

        # Ensure we hit the /results JSON endpoint
        if not base.endswith("/results"):
            base = f"{base}/results"

        parsed = urlparse(base)
        site_base = f"{parsed.scheme}://{parsed.netloc}"

        url = (
            f"{base}?ActiveFacetID=0&CurrentPage=1"
            f"&RecordsPerPage={limit}"
            f"&Distance=50&RadiusUnitType=0"
            f"&Keywords={quote_plus(query)}"
            f"&ShowRadius=False&IsPagination=False"
            f"&CustomFacetName=&FacetTerm=&FacetType=0"
            f"&SearchResultsModuleName=Search+Results"
            f"&SearchFiltersModuleName=Search+Filters"
            f"&SortCriteria=0&SortDirection=0"
            f"&SearchType=5&PostalCode=&fc=&fl=&fcf=&afc=&afl=&afcf="
        )

        req = urllib.request.Request(url, headers={
            "User-Agent": _USER_AGENT,
            "Accept": "application/json",
        })
        with urllib.request.urlopen(req, timeout=20) as resp:
            body = resp.read().decode("utf-8", errors="ignore")

        try:
            data = json.loads(body)
            results_html = data.get("results", "")
        except json.JSONDecodeError:
            # Fall back to treating the whole body as HTML
            results_html = body

        jobs = _extract_jobs_from_results_html(results_html, site_base)

        results: list[JobResult] = []
        for job in jobs[:limit]:
            results.append(
                JobResult(
                    title=job["title"],
                    location=job.get("location", "Unknown"),
                    url=job["url"],
                    posted_date=job.get("posted_date"),
                    description_text=job["title"],
                )
            )
        return results
