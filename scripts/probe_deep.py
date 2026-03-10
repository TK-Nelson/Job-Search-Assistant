"""
Deep probe for failing platforms.
Inspects HTML/JS for actual API endpoints, tries alternate request formats.
"""

import json
import re
import sys
import time
from pathlib import Path

import requests

BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND_DIR))

SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept": "application/json, text/html, */*",
    "Accept-Language": "en-US,en;q=0.9",
})

TIMEOUT = 25


def extract_api_clues(html: str) -> dict:
    """Extract API references from HTML/JS source."""
    # API path patterns
    api_paths = re.findall(r'["\'](/api/[^"\']{3,100})["\']', html)
    # Full URL patterns with API
    full_urls = re.findall(r'["\'](https?://[^"\']*(?:api|search|jobs|careers)[^"\']{0,100})["\']', html, re.I)
    # fetch() calls
    fetch_calls = re.findall(r'fetch\(\s*["\']([^"\']+)["\']', html)
    # XMLHttpRequest URLs
    xhr_urls = re.findall(r'\.open\(\s*["\'](?:GET|POST)["\']\s*,\s*["\']([^"\']+)["\']', html)
    # __NEXT_DATA__
    next_data_match = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.DOTALL)
    next_data = None
    if next_data_match:
        try:
            next_data = json.loads(next_data_match.group(1))
        except Exception:
            next_data = "parse_error"

    return {
        "api_paths": sorted(set(api_paths))[:30],
        "full_api_urls": sorted(set(full_urls))[:30],
        "fetch_calls": sorted(set(fetch_calls))[:20],
        "xhr_urls": sorted(set(xhr_urls))[:20],
        "has_next_data": next_data is not None,
        "next_data_summary": _summarize_next_data(next_data) if next_data and next_data != "parse_error" else None,
    }


def _summarize_next_data(nd: dict) -> dict:
    summary = {"keys": list(nd.keys())}
    if "props" in nd and "pageProps" in nd.get("props", {}):
        pp = nd["props"]["pageProps"]
        summary["pageProps_keys"] = list(pp.keys())[:20]
        # Look for job data
        for key in ("jobs", "positions", "listings", "results", "data"):
            if key in pp:
                val = pp[key]
                if isinstance(val, list):
                    summary[f"pageProps.{key}"] = f"list[{len(val)}]"
                    if val:
                        summary[f"pageProps.{key}_sample_keys"] = list(val[0].keys())[:15] if isinstance(val[0], dict) else str(type(val[0]))
                elif isinstance(val, dict):
                    summary[f"pageProps.{key}_keys"] = list(val.keys())[:15]
    return summary


def deep_probe_phenom(name: str, url: str):
    """Deep probe for Phenom People sites."""
    print(f"\n{'='*60}")
    print(f"  DEEP PROBE: {name} (Phenom)")
    print(f"  URL: {url}")
    print(f"{'='*60}")

    from urllib.parse import urlparse
    parsed = urlparse(url)
    base = f"{parsed.scheme}://{parsed.netloc}"

    # Step 1: Fetch the page and extract API clues
    print("\n[1] Fetching page and extracting API clues...")
    try:
        r = SESSION.get(url, timeout=TIMEOUT)
        html = r.text
        print(f"    Status: {r.status_code}, Length: {len(html)}")
        clues = extract_api_clues(html)
        if clues["api_paths"]:
            print(f"    API paths in HTML/JS ({len(clues['api_paths'])}):")
            for p in clues["api_paths"][:15]:
                print(f"      {p}")
        if clues["full_api_urls"]:
            print(f"    Full API URLs ({len(clues['full_api_urls'])}):")
            for u in clues["full_api_urls"][:15]:
                print(f"      {u}")
        if clues["has_next_data"]:
            print(f"    __NEXT_DATA__ found: {json.dumps(clues['next_data_summary'], indent=4)}")
    except Exception as e:
        print(f"    ERROR fetching page: {e}")
        return

    # Step 2: Try many Phenom API endpoint variations
    print("\n[2] Trying Phenom API endpoints...")
    endpoints = [
        ("POST", f"{base}/api/apply/v2/jobs", {"appliedFacets": {}, "limit": 20, "offset": 0, "searchText": ""}),
        ("POST", f"{base}/api/apply/v2/jobs", {"landingPage": parsed.path, "searchText": "", "limit": 20, "offset": 0}),
        ("POST", f"{base}/api/apply/v2/jobs", {"landingPage": "", "searchText": "", "limit": 20, "offset": 0, "facets": []}),
        ("GET", f"{base}/api/apply/v2/jobs?limit=20&offset=0", None),
        ("GET", f"{base}/api/jobs?limit=20&offset=0", None),
        ("POST", f"{base}/api/jobs", {"limit": 20, "offset": 0, "searchText": ""}),
        ("GET", f"{base}/wday/cxs/jobs?limit=20", None),
        ("POST", f"{base}/api/apply/v2/jobs/search", {"searchText": "", "limit": 20, "offset": 0}),
        ("POST", f"{base}/api/apply/v2/jobs/search", {"query": "", "limit": 20, "offset": 0}),
        ("GET", f"{base}/widgets-api/smashfly-widgets/api/jobs?limit=20&offset=0", None),
        ("POST", f"{base}/search-api/api/jobs", {"searchText": "", "limit": 20, "offset": 0}),
        ("POST", f"{base}/global/en/search-results", {"limit": 20, "offset": 0, "searchText": ""}),
        # Phenom TalentConnect patterns
        ("GET", f"{base}/api/v1/search?limit=20&offset=0", None),
        ("POST", f"{base}/api/v1/search", {"query": "", "limit": 20, "offset": 0}),
    ]

    for method, endpoint, payload in endpoints:
        try:
            if method == "POST":
                resp = SESSION.post(endpoint, json=payload, timeout=10,
                                   headers={"Content-Type": "application/json"})
            else:
                resp = SESSION.get(endpoint, timeout=10)

            status = resp.status_code
            ct = resp.headers.get("Content-Type", "")
            body_preview = resp.text[:300]

            is_json = "json" in ct.lower()
            result_info = ""
            if is_json:
                try:
                    d = resp.json()
                    if isinstance(d, dict):
                        result_info = f"keys={list(d.keys())}"
                        for k in ("total", "totalCount", "count"):
                            if k in d:
                                result_info += f" {k}={d[k]}"
                        for k in ("jobs", "positions", "results", "jobPostings", "data"):
                            if k in d and isinstance(d[k], list):
                                result_info += f" {k}=[{len(d[k])} items]"
                    elif isinstance(d, list):
                        result_info = f"list[{len(d)}]"
                except Exception:
                    pass

            marker = " <<<" if status == 200 and is_json else ""
            print(f"    {method} {endpoint}")
            print(f"      -> {status} {ct[:40]} {result_info}{marker}")

            if status == 200 and is_json and result_info:
                # Print sample if we got job data
                try:
                    d = resp.json()
                    jobs = d.get("jobs", d.get("positions", d.get("jobPostings", d.get("results", []))))
                    if isinstance(jobs, list) and jobs:
                        print(f"      SAMPLE JOB KEYS: {list(jobs[0].keys())[:15]}")
                        for j in jobs[:3]:
                            t = j.get("title", j.get("name", j.get("jobTitle", "?")))
                            l = j.get("location", j.get("city", "?"))
                            print(f"        - {t} | {l}")
                except Exception:
                    pass

        except requests.exceptions.Timeout:
            print(f"    {method} {endpoint}")
            print(f"      -> TIMEOUT")
        except Exception as e:
            print(f"    {method} {endpoint}")
            print(f"      -> ERROR: {str(e)[:80]}")

    # Step 3: Try to find JS bundle URLs and scan them for API endpoints
    print("\n[3] Scanning JS bundles for API endpoints...")
    script_urls = re.findall(r'<script[^>]+src="([^"]+\.js[^"]*)"', html)
    print(f"    Found {len(script_urls)} script tags")

    api_endpoints_from_js = set()
    for script_url in script_urls[:5]:  # Only check first 5
        full_url = script_url if script_url.startswith("http") else f"{base}{script_url}"
        try:
            sr = SESSION.get(full_url, timeout=10)
            if sr.status_code == 200:
                js = sr.text
                apis = re.findall(r'["\'](/api/[^"\']{5,80})["\']', js)
                for a in apis:
                    api_endpoints_from_js.add(a)
        except Exception:
            pass

    if api_endpoints_from_js:
        print(f"    API endpoints found in JS bundles:")
        for ep in sorted(api_endpoints_from_js)[:20]:
            print(f"      {ep}")


def deep_probe_amazon():
    """Deep probe Amazon Jobs API."""
    print(f"\n{'='*60}")
    print(f"  DEEP PROBE: Amazon Jobs")
    print(f"{'='*60}")

    # First get the page and look for the API format
    r = SESSION.get("https://www.amazon.jobs/en/", timeout=TIMEOUT)
    html = r.text
    clues = extract_api_clues(html)

    if clues["api_paths"]:
        print(f"  API paths: {clues['api_paths'][:10]}")
    if clues["full_api_urls"]:
        print(f"  Full URLs: {clues['full_api_urls'][:10]}")

    # Try various Amazon API formats
    print("\n  Trying Amazon API formats...")

    attempts = [
        # Standard search
        {"url": "https://www.amazon.jobs/api/search-jobs", "method": "POST",
         "json": {"offset": 0, "result_limit": 10, "sort": "recent",
                  "category": [], "schedule_type_id": [], "normalized_location": [],
                  "job_type": [], "country": [], "min_qualifying_grade": 0,
                  "radius": 0}},
        # With Content-Type
        {"url": "https://www.amazon.jobs/api/search-jobs", "method": "POST",
         "json": {"offset": 0, "result_limit": 10, "sort": "recent",
                  "category": [], "schedule_type_id": [], "normalized_location": [],
                  "job_type": []}},
        # Minimal
        {"url": "https://www.amazon.jobs/api/search-jobs", "method": "POST",
         "json": {"offset": 0, "result_limit": 10}},
        # Search with base_query
        {"url": "https://www.amazon.jobs/en/search", "method": "GET",
         "params": {"offset": 0, "result_limit": 10, "sort": "recent", "base_query": ""}},
        # Internal API
        {"url": "https://www.amazon.jobs/en/internal/search", "method": "GET",
         "params": {"offset": 0, "result_limit": 10}},
        # v1 API
        {"url": "https://amazon.jobs/api/v1/search-jobs", "method": "POST",
         "json": {"offset": 0, "result_limit": 10}},
    ]

    for att in attempts:
        try:
            if att["method"] == "POST":
                resp = SESSION.post(att["url"], json=att.get("json"), timeout=15,
                                   headers={"Content-Type": "application/json"})
            else:
                resp = SESSION.get(att["url"], params=att.get("params"), timeout=15)

            ct = resp.headers.get("Content-Type", "")
            print(f"\n  {att['method']} {att['url']}")
            print(f"    Status: {resp.status_code}, CT: {ct[:50]}")
            if resp.status_code == 200:
                try:
                    d = resp.json()
                    print(f"    Keys: {list(d.keys()) if isinstance(d, dict) else 'list'}")
                    for k in ("hits", "jobs", "results", "total", "totalHits"):
                        if k in d:
                            v = d[k]
                            if isinstance(v, list):
                                print(f"    {k}: list[{len(v)}]")
                                if v:
                                    print(f"    {k}[0] keys: {list(v[0].keys())[:15]}")
                                    print(f"    Sample: {v[0].get('title', v[0].get('business_title', '?'))}")
                            else:
                                print(f"    {k}: {v}")
                except Exception:
                    print(f"    Body: {resp.text[:200]}")
            else:
                print(f"    Body: {resp.text[:200]}")
        except Exception as e:
            print(f"\n  {att['method']} {att['url']}")
            print(f"    ERROR: {e}")


def deep_probe_dayforce():
    """Deep probe Dayforce API for Shamrock."""
    print(f"\n{'='*60}")
    print(f"  DEEP PROBE: Dayforce (Shamrock)")
    print(f"{'='*60}")

    base = "https://jobs.dayforcehcm.com"

    # Try various API patterns
    attempts = [
        f"{base}/api/jobposting/v2/search/shamrocktc/CANDIDATEPORTAL",
        f"{base}/api/jobposting/v1/search/shamrocktc/CANDIDATEPORTAL",
        f"{base}/api/jobposting/search/shamrocktc/CANDIDATEPORTAL",
        f"{base}/en-US/shamrocktc/CANDIDATEPORTAL/jobs",  # HTML page
    ]

    for url in attempts:
        try:
            r = SESSION.get(url, timeout=15, params={"skip": 0, "take": 20})
            ct = r.headers.get("Content-Type", "")
            print(f"\n  GET {url}")
            print(f"    Status: {r.status_code}, CT: {ct[:50]}, Length: {len(r.text)}")
            if r.status_code == 200 and "json" in ct.lower():
                d = r.json()
                print(f"    Keys: {list(d.keys()) if isinstance(d, dict) else type(d)}")
        except Exception as e:
            print(f"\n  GET {url}\n    ERROR: {e}")

    # Try POST
    try:
        r = SESSION.post(f"{base}/api/jobposting/v2/search/shamrocktc/CANDIDATEPORTAL",
                        json={"skip": 0, "take": 20}, timeout=15)
        print(f"\n  POST {base}/api/jobposting/v2/search/shamrocktc/CANDIDATEPORTAL")
        print(f"    Status: {r.status_code}, Body: {r.text[:200]}")
    except Exception as e:
        print(f"    ERROR: {e}")

    # Try fetching the jobs listing page and look for API clues
    try:
        r = SESSION.get(f"{base}/en-US/shamrocktc/CANDIDATEPORTAL/jobs", timeout=15)
        html = r.text
        clues = extract_api_clues(html)
        if clues["api_paths"]:
            print(f"\n  API paths from listing page: {clues['api_paths'][:15]}")
        if clues["full_api_urls"]:
            print(f"  Full URLs: {clues['full_api_urls'][:15]}")
    except Exception as e:
        print(f"  Listing page error: {e}")


def deep_probe_konrad():
    """Deep probe Konrad (detected Greenhouse)."""
    print(f"\n{'='*60}")
    print(f"  DEEP PROBE: Konrad (Greenhouse)")
    print(f"{'='*60}")

    # Try known Greenhouse board tokens for Konrad
    board_guesses = ["konrad", "konradgroup", "konradcareers"]

    for token in board_guesses:
        url = f"https://boards-api.greenhouse.io/v1/boards/{token}/jobs"
        try:
            r = SESSION.get(url, timeout=10)
            print(f"\n  GET {url}")
            print(f"    Status: {r.status_code}")
            if r.status_code == 200:
                d = r.json()
                jobs = d.get("jobs", [])
                print(f"    Jobs: {len(jobs)}")
                for j in jobs[:3]:
                    print(f"      - {j.get('title', '?')} | {j.get('location', {}).get('name', '?')}")
                return
        except Exception as e:
            print(f"    ERROR: {e}")

    # Scan the page for the board token
    try:
        r = SESSION.get("https://www.konrad.com/careers/job/associate-ui-ux-designer_7652952003?gh_src=o1jbap193us", timeout=15)
        html = r.text
        # Look for Greenhouse board references - various patterns
        patterns = [
            r'boards-api\.greenhouse\.io/v1/boards/([a-zA-Z0-9_-]+)',
            r'boards\.greenhouse\.io/([a-zA-Z0-9_-]+)',
            r'greenhouse\.io/embed/job_board\?for=([a-zA-Z0-9_-]+)',
            r'"board_token"\s*:\s*"([^"]+)"',
            r'"boardToken"\s*:\s*"([^"]+)"',
            r'gh_board["\s:=]+([a-zA-Z0-9_-]+)',
            r'data-board["\s=]+([a-zA-Z0-9_-]+)',
        ]
        for p in patterns:
            match = re.search(p, html)
            if match:
                token = match.group(1)
                print(f"\n  Found token via pattern: {token}")
                url = f"https://boards-api.greenhouse.io/v1/boards/{token}/jobs"
                r2 = SESSION.get(url, timeout=10)
                if r2.status_code == 200:
                    d = r2.json()
                    jobs = d.get("jobs", [])
                    print(f"    Jobs: {len(jobs)}")
                    for j in jobs[:3]:
                        print(f"      - {j.get('title', '?')} | {j.get('location', {}).get('name', '?')}")
                    return
                else:
                    print(f"    Token {token} returned {r2.status_code}")

        # Extract the job ID from the URL to find the board via the harvest API
        job_id_match = re.search(r'_(\d+)', "associate-ui-ux-designer_7652952003")
        if job_id_match:
            job_id = job_id_match.group(1)
            print(f"\n  Trying Greenhouse harvest API for job {job_id}...")
            r3 = SESSION.get(f"https://boards-api.greenhouse.io/v1/boards/konradgroup/jobs/{job_id}", timeout=10)
            print(f"    Status: {r3.status_code}")

    except Exception as e:
        print(f"  Page scan error: {e}")


if __name__ == "__main__":
    # Probe the failing sites
    deep_probe_phenom("PNC Bank", "https://careers.pnc.com/global/en/c/technology-jobs")
    deep_probe_phenom("Capital One", "https://www.capitalonecareers.com/search-jobs")
    deep_probe_phenom("CVS Health", "https://jobs.cvshealth.com/us/en/it-jobs")
    deep_probe_amazon()
    deep_probe_dayforce()
    deep_probe_konrad()
