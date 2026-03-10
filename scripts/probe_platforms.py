"""
Read-only probe script to test querying job platforms via their actual APIs.

This does NOT write to the database. It only prints what it finds.

Usage:
    cd backend
    .venv\Scripts\python.exe ..\scripts\probe_platforms.py
"""

import json
import re
import sys
import textwrap
import time
from pathlib import Path
from urllib.parse import urlparse, urlencode

import requests

# ── Make backend importable ──────────────────────────────────────
BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND_DIR))

from app.db.database import get_connection

# ── Shared HTTP session ──────────────────────────────────────────
SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept": "application/json, text/html, */*",
    "Accept-Language": "en-US,en;q=0.9",
})

TIMEOUT = 20  # seconds


# ═══════════════════════════════════════════════════════════════════
#  Platform detection
# ═══════════════════════════════════════════════════════════════════

def detect_platform(url: str) -> str:
    """Detect the ATS platform from the careers URL."""
    lower = url.lower()
    parsed = urlparse(url)
    host = parsed.netloc.lower()

    # Workday
    if "myworkdayjobs.com" in host or "wd.myworkday.com" in host:
        return "workday"

    # Greenhouse
    if "greenhouse.io" in host or "boards.greenhouse.io" in host:
        return "greenhouse"

    # iCIMS
    if "icims.com" in host:
        return "icims"

    # Dayforce / Ceridian
    if "dayforcehcm.com" in host:
        return "dayforce"

    # Amazon Jobs
    if "amazon.jobs" in host:
        return "amazon"

    # Phenom People — detect by probing common API paths
    # Known Phenom domains from our DB:
    phenom_patterns = [
        "careers.pnc.com",
        "jobs.cvshealth.com",
        "careers.usbank.com",
        "capitalonecareers.com",
        "metlifecareers.com",
    ]
    for pat in phenom_patterns:
        if pat in host:
            return "phenom"

    # Try to auto-detect Phenom by checking for common Phenom markers
    # (we'll try the API in the probe)
    return "unknown"


# ═══════════════════════════════════════════════════════════════════
#  Platform-specific probes (READ ONLY)
# ═══════════════════════════════════════════════════════════════════

def probe_workday(url: str) -> dict:
    """
    Workday external career sites expose a JSON API.
    URL format: https://{tenant}.wd{N}.myworkdayjobs.com/{SiteName}
    API:  POST https://{host}/wday/cxs/{tenant}/{SiteName}/jobs
    Body: {"appliedFacets":{},"limit":20,"offset":0,"searchText":""}
    """
    parsed = urlparse(url)
    host = parsed.netloc  # e.g. "generalmotors.wd5.myworkdayjobs.com"
    path_parts = [p for p in parsed.path.strip("/").split("/") if p]

    if not path_parts:
        return {"error": "Cannot determine Workday site name from URL path"}

    # Extract tenant from subdomain (e.g. "generalmotors" from "generalmotors.wd5...")
    tenant = host.split(".")[0]
    site_name = path_parts[0]  # e.g. "Careers_GM"

    api_url = f"https://{host}/wday/cxs/{tenant}/{site_name}/jobs"

    payload = {
        "appliedFacets": {},
        "limit": 20,
        "offset": 0,
        "searchText": "",
    }

    try:
        resp = SESSION.post(api_url, json=payload, timeout=TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        return {"error": str(e), "api_url": api_url}

    total = data.get("total", 0)
    job_postings = data.get("jobPostings", [])

    roles = []
    for jp in job_postings[:10]:  # Sample first 10
        roles.append({
            "title": jp.get("title", ""),
            "location": jp.get("locationsText", ""),
            "posted": jp.get("postedOn", ""),
            "url": f"https://{host}/en-US{jp['externalPath']}" if jp.get("externalPath") else "",
        })

    return {
        "platform": "workday",
        "api_url": api_url,
        "total_jobs": total,
        "sample_roles": roles,
    }


def probe_greenhouse(url: str) -> dict:
    """
    Greenhouse boards API.
    URL patterns:
      - https://boards.greenhouse.io/{company}
      - https://boards.greenhouse.io/embed/job_app?token=X  (single job)
    API: GET https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs
    """
    parsed = urlparse(url)

    # Try to extract board token from URL
    board_token = None
    path_parts = [p for p in parsed.path.strip("/").split("/") if p]

    if "boards.greenhouse.io" in parsed.netloc:
        if "embed" in path_parts:
            # Single job embed, try to get the company from a different source
            # For now, we can't derive the board_token from a single job URL easily
            # Try extracting from gh_src or other params
            return {
                "error": "URL is a single job embed, not a board listing. "
                         "Need the board URL like https://boards.greenhouse.io/{company}"
            }
        elif path_parts:
            board_token = path_parts[0]
    elif "greenhouse.io" in parsed.netloc:
        # Some companies use job-boards.greenhouse.io or custom subdomains
        if path_parts:
            board_token = path_parts[0]

    if not board_token:
        return {"error": "Cannot determine Greenhouse board token from URL"}

    api_url = f"https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs"

    try:
        resp = SESSION.get(api_url, timeout=TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        return {"error": str(e), "api_url": api_url}

    jobs = data.get("jobs", [])

    roles = []
    for job in jobs[:10]:
        loc = job.get("location", {})
        roles.append({
            "title": job.get("title", ""),
            "location": loc.get("name", "") if isinstance(loc, dict) else str(loc),
            "posted": job.get("updated_at", ""),
            "url": job.get("absolute_url", ""),
        })

    return {
        "platform": "greenhouse",
        "api_url": api_url,
        "total_jobs": len(jobs),
        "sample_roles": roles,
    }


def probe_greenhouse_from_company_site(url: str) -> dict:
    """
    Some companies embed Greenhouse on their own domain (e.g. konrad.com/careers).
    Try to find the Greenhouse board token from the page, then use the API.
    """
    try:
        resp = SESSION.get(url, timeout=TIMEOUT)
        html = resp.text

        # Look for greenhouse board references in the HTML/JS
        # Common patterns: greenhouse.io/boards/{token}, gh_src=, greenhouse
        gh_match = re.search(r'boards(?:-api)?\.greenhouse\.io/v1/boards/([a-zA-Z0-9_-]+)', html)
        if not gh_match:
            gh_match = re.search(r'boards\.greenhouse\.io/([a-zA-Z0-9_-]+)', html)
        if not gh_match:
            gh_match = re.search(r'greenhouse\.io/embed/job_board\?for=([a-zA-Z0-9_-]+)', html)

        if gh_match:
            board_token = gh_match.group(1)
            api_url = f"https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs"
            resp2 = SESSION.get(api_url, timeout=TIMEOUT)
            resp2.raise_for_status()
            data = resp2.json()
            jobs = data.get("jobs", [])
            roles = []
            for job in jobs[:10]:
                loc = job.get("location", {})
                roles.append({
                    "title": job.get("title", ""),
                    "location": loc.get("name", "") if isinstance(loc, dict) else str(loc),
                    "url": job.get("absolute_url", ""),
                })
            return {
                "platform": "greenhouse (embedded)",
                "api_url": api_url,
                "board_token": board_token,
                "total_jobs": len(jobs),
                "sample_roles": roles,
            }
    except Exception as e:
        return {"error": f"Could not detect embedded Greenhouse: {e}"}

    return {"error": "No Greenhouse board found on page"}


def probe_phenom(url: str) -> dict:
    """
    Phenom People career sites.
    Common API endpoints:
      - /api/apply/v2/jobs  (POST with JSON body)
      - /api/jobs  (GET with query params)
      - /widgets-api/smashfly-widgets/api/jobs
    """
    parsed = urlparse(url)
    base = f"{parsed.scheme}://{parsed.netloc}"

    # Try multiple known Phenom API paths
    api_attempts = [
        {
            "name": "/api/apply/v2/jobs",
            "method": "POST",
            "url": f"{base}/api/apply/v2/jobs",
            "json": {
                "appliedFacets": {},
                "limit": 20,
                "offset": 0,
                "searchText": "",
            },
        },
        {
            "name": "/api/jobs",
            "method": "GET",
            "url": f"{base}/api/jobs",
            "params": {"limit": 20, "offset": 0},
        },
        {
            "name": "/widgets-api/smashfly-widgets/api/jobs",
            "method": "GET",
            "url": f"{base}/widgets-api/smashfly-widgets/api/jobs",
            "params": {"limit": 20, "offset": 0},
        },
        {
            "name": "/api/apply/v2/jobs (alt body)",
            "method": "POST",
            "url": f"{base}/api/apply/v2/jobs",
            "json": {
                "landingPage": "",
                "searchText": "",
                "limit": 20,
                "offset": 0,
            },
        },
    ]

    for attempt in api_attempts:
        try:
            if attempt["method"] == "POST":
                resp = SESSION.post(
                    attempt["url"],
                    json=attempt.get("json"),
                    timeout=TIMEOUT,
                    headers={"Content-Type": "application/json"},
                )
            else:
                resp = SESSION.get(
                    attempt["url"],
                    params=attempt.get("params"),
                    timeout=TIMEOUT,
                )

            if resp.status_code == 200:
                data = resp.json()
                # Phenom responses vary. Try common shapes:
                jobs = (
                    data.get("positions", [])
                    or data.get("jobs", [])
                    or data.get("data", {}).get("jobs", [])
                    or data.get("results", [])
                    or data.get("jobPostings", [])
                )
                total = (
                    data.get("total", 0)
                    or data.get("totalCount", 0)
                    or data.get("count", 0)
                    or len(jobs)
                )

                if jobs or total > 0:
                    roles = []
                    for job in (jobs[:10] if isinstance(jobs, list) else []):
                        roles.append({
                            "title": job.get("title", job.get("name", "")),
                            "location": job.get("location", job.get("city", "")),
                            "url": job.get("applyUrl", job.get("url", "")),
                        })
                    return {
                        "platform": "phenom",
                        "api_url": attempt["url"],
                        "api_path": attempt["name"],
                        "total_jobs": total,
                        "sample_roles": roles,
                        "raw_keys": list(data.keys()) if isinstance(data, dict) else "non-dict",
                    }

        except Exception:
            continue

    # If standard Phenom APIs didn't work, try to inspect the page for API clues
    try:
        resp = SESSION.get(url, timeout=TIMEOUT)
        html = resp.text
        # Look for API base URLs in the HTML/JS
        api_matches = re.findall(r'["\'](/api/[^"\']+)["\']', html)
        return {
            "error": "No standard Phenom API returned jobs",
            "api_hints_from_html": list(set(api_matches))[:20],
            "page_status": resp.status_code,
            "page_length": len(html),
        }
    except Exception as e:
        return {"error": f"Failed to fetch page: {e}"}


def probe_amazon(url: str) -> dict:
    """
    Amazon Jobs API.
    POST https://www.amazon.jobs/api/search-jobs
    """
    api_url = "https://www.amazon.jobs/api/search-jobs"

    payload = {
        "category": [],
        "city": [],
        "country": [],
        "facets": [],
        "industry": [],
        "isManager": [],
        "jobState": [],
        "offset": 0,
        "queryType": "recent",
        "result_limit": 20,
        "schedule": [],
        "state": [],
    }

    try:
        resp = SESSION.post(
            api_url,
            json=payload,
            timeout=TIMEOUT,
            headers={"Content-Type": "application/json"},
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        return {"error": str(e), "api_url": api_url}

    hits = data.get("hits", data.get("jobs", []))
    total = data.get("totalHits", data.get("total", len(hits)))

    roles = []
    for job in (hits[:10] if isinstance(hits, list) else []):
        roles.append({
            "title": job.get("title", job.get("business_title", "")),
            "location": job.get("normalized_location", job.get("location", "")),
            "posted": job.get("posted_date", ""),
            "url": f"https://www.amazon.jobs{job['url_next_step']}" if job.get("url_next_step") else "",
        })

    return {
        "platform": "amazon",
        "api_url": api_url,
        "total_jobs": total,
        "sample_roles": roles,
        "raw_keys": list(data.keys()) if isinstance(data, dict) else "non-dict",
    }


def probe_icims(url: str) -> dict:
    """
    iCIMS career portals.
    API: GET https://{host}/jobs/search?...
    Or: The embed URL often has /jobs/{id}/job but listing pages
        use /jobs/search with parameters.
    """
    parsed = urlparse(url)
    base = f"{parsed.scheme}://{parsed.netloc}"

    # Try the search API
    search_url = f"{base}/jobs/search"
    params = {
        "pr": 20,        # page results
        "o": 0,          # offset
        "searchRelation": "keyword_all",
    }

    try:
        resp = SESSION.get(search_url, params=params, timeout=TIMEOUT)
        if resp.status_code == 200:
            # iCIMS returns HTML for the search page, need to parse it
            html = resp.text
            # Look for job data in the HTML
            job_matches = re.findall(
                r'class="[^"]*iCIMS_JobsTable[^"]*".*?href="([^"]+)"[^>]*>([^<]+)',
                html, re.DOTALL
            )

            # Also try JSON endpoint
            api_url = f"{base}/jobs/search?api=1"
            resp2 = SESSION.get(api_url, timeout=TIMEOUT)
            if resp2.status_code == 200:
                try:
                    data = resp2.json()
                    return {
                        "platform": "icims",
                        "api_url": api_url,
                        "raw_keys": list(data.keys()),
                        "total_jobs": data.get("total", len(data.get("jobs", []))),
                    }
                except Exception:
                    pass

            # Look for embedded JSON data
            json_match = re.search(r'var\s+iCIMS\s*=\s*({.*?});', html, re.DOTALL)
            portal_match = re.search(r'"portalId"\s*:\s*"?(\d+)"?', html)

            return {
                "platform": "icims",
                "search_url": search_url,
                "page_status": resp.status_code,
                "page_length": len(html),
                "html_job_links_found": len(job_matches),
                "sample_links": job_matches[:5],
                "has_json_data": bool(json_match),
                "portal_id": portal_match.group(1) if portal_match else None,
            }
    except Exception as e:
        return {"error": str(e)}

    return {"error": "Could not access iCIMS search"}


def probe_dayforce(url: str) -> dict:
    """
    Dayforce (Ceridian) job boards.
    URL: https://jobs.dayforcehcm.com/en-US/{company}/CANDIDATEPORTAL/jobs
    API: GET https://jobs.dayforcehcm.com/api/jobposting/v2/search/{company}/CANDIDATEPORTAL
    """
    parsed = urlparse(url)
    path_parts = [p for p in parsed.path.strip("/").split("/") if p]

    # Extract company slug: typically /en-US/{company}/CANDIDATEPORTAL/...
    company_slug = None
    for i, part in enumerate(path_parts):
        if part.lower() in ("en-us", "en-ca", "fr-ca", "en-gb"):
            if i + 1 < len(path_parts):
                company_slug = path_parts[i + 1]
                break
    if not company_slug and len(path_parts) >= 2:
        company_slug = path_parts[0]

    if not company_slug:
        return {"error": "Cannot determine Dayforce company slug from URL"}

    api_url = f"https://jobs.dayforcehcm.com/api/jobposting/v2/search/{company_slug}/CANDIDATEPORTAL"

    try:
        resp = SESSION.get(api_url, params={"skip": 0, "take": 20}, timeout=TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        # Try alternate API path
        try:
            alt_url = f"https://jobs.dayforcehcm.com/api/jobposting/search/{company_slug}/CANDIDATEPORTAL"
            resp = SESSION.get(alt_url, params={"skip": 0, "take": 20}, timeout=TIMEOUT)
            resp.raise_for_status()
            data = resp.json()
            api_url = alt_url
        except Exception as e2:
            return {"error": f"Primary: {e} | Alt: {e2}", "api_url": api_url}

    jobs = data.get("jobs", data.get("data", []))
    total = data.get("totalCount", data.get("total", len(jobs)))

    roles = []
    for job in (jobs[:10] if isinstance(jobs, list) else []):
        roles.append({
            "title": job.get("title", job.get("jobTitle", "")),
            "location": job.get("location", job.get("city", "")),
            "url": job.get("url", job.get("applyUrl", "")),
        })

    return {
        "platform": "dayforce",
        "api_url": api_url,
        "total_jobs": total,
        "sample_roles": roles,
        "raw_keys": list(data.keys()) if isinstance(data, dict) else "non-dict",
    }


def probe_unknown(url: str) -> dict:
    """
    For unknown platforms, try a few common strategies:
    1. Check if it's secretly a known platform (Greenhouse embed, etc.)
    2. Try common ATS API paths
    3. Fall back to HTML inspection
    """
    parsed = urlparse(url)
    base = f"{parsed.scheme}://{parsed.netloc}"

    # Try fetching the page first to look for platform clues
    try:
        resp = SESSION.get(url, timeout=TIMEOUT, allow_redirects=True)
        html = resp.text
        final_url = resp.url

        # Check for platform indicators in HTML
        platform_clues = {}

        if "greenhouse" in html.lower() or "greenhouse.io" in html.lower():
            platform_clues["greenhouse"] = True
            gh_result = probe_greenhouse_from_company_site(url)
            if "error" not in gh_result:
                return gh_result

        if "workday" in html.lower() or "myworkday" in html.lower():
            platform_clues["workday"] = True

        if "phenom" in html.lower() or "talentconnect" in html.lower():
            platform_clues["phenom"] = True

        if "icims" in html.lower():
            platform_clues["icims"] = True

        if "lever.co" in html.lower():
            platform_clues["lever"] = True

        if "smartrecruiters" in html.lower():
            platform_clues["smartrecruiters"] = True

        # Check for redirects to known platforms
        if "myworkdayjobs.com" in final_url:
            return probe_workday(final_url)
        if "greenhouse.io" in final_url:
            return probe_greenhouse(final_url)

        # Try Phenom API on this domain
        phenom_result = probe_phenom(url)
        if "error" not in phenom_result:
            return phenom_result

        # Try common API paths
        api_paths_to_try = [
            "/api/jobs",
            "/api/v1/jobs",
            "/api/v2/jobs",
            "/api/search-jobs",
            "/api/careers/jobs",
        ]

        working_apis = []
        for path in api_paths_to_try:
            try:
                r = SESSION.get(f"{base}{path}", timeout=10)
                if r.status_code == 200:
                    try:
                        d = r.json()
                        working_apis.append({"path": path, "keys": list(d.keys()) if isinstance(d, dict) else "list", "length": len(d) if isinstance(d, (list, dict)) else 0})
                    except Exception:
                        pass
            except Exception:
                pass

        # Look for API references in HTML/JS
        api_refs = re.findall(r'["\'](/api/[^"\']{3,80})["\']', html)
        fetch_refs = re.findall(r'fetch\(["\']([^"\']+)["\']', html)

        return {
            "platform": "unknown",
            "final_url": final_url,
            "page_status": resp.status_code,
            "page_length": len(html),
            "platform_clues": platform_clues,
            "working_apis": working_apis,
            "api_refs_in_html": list(set(api_refs))[:15],
            "fetch_refs_in_html": list(set(fetch_refs))[:15],
            "phenom_probe": phenom_result if "error" in phenom_result else "matched",
        }

    except Exception as e:
        return {"error": f"Failed to fetch page: {e}"}


# ═══════════════════════════════════════════════════════════════════
#  Main probe runner
# ═══════════════════════════════════════════════════════════════════

PLATFORM_PROBES = {
    "workday": probe_workday,
    "greenhouse": probe_greenhouse,
    "phenom": probe_phenom,
    "amazon": probe_amazon,
    "icims": probe_icims,
    "dayforce": probe_dayforce,
    "unknown": probe_unknown,
}


def run_probe():
    print("=" * 78)
    print("  JOB PLATFORM PROBE — Read-Only API Test")
    print("=" * 78)

    # Load companies from DB
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT id, name, careers_url, followed FROM companies ORDER BY followed DESC, id"
        ).fetchall()

    if not rows:
        print("\nNo companies in the database.")
        return

    print(f"\nFound {len(rows)} companies. Probing each...\n")

    results = []

    for company_id, name, careers_url, followed in rows:
        print("-" * 78)
        marker = " [FOLLOWED]" if followed else ""
        print(f"[{company_id}] {name}{marker}")
        print(f"    URL: {careers_url}")

        if not careers_url or not careers_url.startswith("http") or "manual.local" in careers_url:
            print(f"    ⊘ Skipping — invalid or manual URL")
            results.append({"company": name, "status": "skipped"})
            continue

        platform = detect_platform(careers_url)
        print(f"    Platform: {platform}")

        probe_fn = PLATFORM_PROBES.get(platform, probe_unknown)

        start_t = time.time()
        result = probe_fn(careers_url)
        elapsed = time.time() - start_t

        result["company_id"] = company_id
        result["company_name"] = name
        result["careers_url"] = careers_url
        result["followed"] = bool(followed)
        result["elapsed_seconds"] = round(elapsed, 2)
        results.append(result)

        if "error" in result:
            print(f"    ERROR: {result['error']}")
        else:
            total = result.get("total_jobs", 0)
            print(f"    Total jobs found: {total}")
            sample = result.get("sample_roles", [])
            if sample:
                print(f"    Sample roles ({len(sample)}):")
                for role in sample[:5]:
                    title = role.get("title", "?")
                    loc = role.get("location", "?")
                    print(f"      • {title} — {loc}")

        print(f"    Time: {elapsed:.1f}s")
        print()

    # ── Summary ──────────────────────────────────────────────────
    print("=" * 78)
    print("  SUMMARY")
    print("=" * 78)

    successes = [r for r in results if "error" not in r and r.get("status") != "skipped"]
    failures = [r for r in results if "error" in r]
    skipped = [r for r in results if r.get("status") == "skipped"]

    print(f"\n  Successful probes: {len(successes)}")
    for r in successes:
        print(f"    ✓ {r.get('company_name', '?')} — {r.get('platform', '?')} — {r.get('total_jobs', 0)} jobs")

    if failures:
        print(f"\n  Failed probes: {len(failures)}")
        for r in failures:
            print(f"    ✗ {r.get('company_name', '?')} — {r.get('error', '?')[:80]}")

    if skipped:
        print(f"\n  Skipped: {len(skipped)}")
        for r in skipped:
            print(f"    - {r.get('company', '?')}")

    # Write detailed results to file for review
    output_path = Path(__file__).resolve().parent.parent / ".runtime" / "probe_results.json"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, default=str)
    print(f"\n  Detailed results written to: {output_path}")
    print()


if __name__ == "__main__":
    run_probe()
