"""
Phase 3: Fix remaining platform probes.
- Phenom: Need tenant ID from cookies/headers
- Amazon: Need proper search params
- Dayforce: Need numeric board IDs
- CVS: May be Workday under Phenom frontend
"""
import requests
import json
import re
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND_DIR))

s = requests.Session()
s.headers.update({
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
})


def probe_phenom_with_cookies(name, base_url, careers_path):
    """
    Phenom needs a session cookie. Visit the page first, then call the API.
    The 'Tenant not identified' error happens because we didn't get the
    site cookie that identifies the tenant.
    """
    print(f"\n{'='*60}")
    print(f"  {name} - Phenom with session cookies")
    print(f"{'='*60}")

    # Step 1: Visit the careers page to get cookies
    full_url = f"{base_url}{careers_path}"
    print(f"\n  [1] Visiting {full_url} to get cookies...")
    try:
        r = s.get(full_url, timeout=20, allow_redirects=True)
        print(f"      Status: {r.status_code}")
        print(f"      Cookies: {dict(s.cookies)}")
        # Also check Set-Cookie headers
        for cookie in r.cookies:
            print(f"      Cookie: {cookie.name}={cookie.value[:50]}...")
    except Exception as e:
        print(f"      ERROR: {e}")
        return

    # Step 2: Try the API with the session cookies
    print(f"\n  [2] Calling API with cookies...")
    api_url = f"{base_url}/api/apply/v2/jobs"
    try:
        r = s.get(api_url, params={"limit": 10, "offset": 0}, timeout=20)
        print(f"      Status: {r.status_code}, CT: {r.headers.get('Content-Type', '')[:40]}")
        if r.status_code == 200:
            try:
                d = r.json()
                status = d.get("status")
                error = d.get("errorMsg")
                print(f"      API status: {status}, error: {error}")
                data = d.get("data")
                if data and isinstance(data, dict):
                    print(f"      data keys: {list(data.keys())}")
                    for k, v in data.items():
                        if isinstance(v, list):
                            print(f"        {k}: list[{len(v)}]")
                            if v and isinstance(v[0], dict):
                                item = v[0]
                                print(f"          keys: {list(item.keys())[:15]}")
                                title = item.get("title", item.get("jobTitle", "?"))
                                loc = item.get("location", item.get("city", "?"))
                                print(f"          Sample: {title} | {loc}")
                        elif isinstance(v, (int, str, bool)):
                            print(f"        {k}: {v}")
                elif data is None and error:
                    print(f"      Still failing: {error}")
            except Exception:
                print(f"      Not JSON: {r.text[:200]}")
    except Exception as e:
        print(f"      ERROR: {e}")

    # Step 3: Also try POST with proper headers
    print(f"\n  [3] Trying POST with various body formats...")
    attempts = [
        {"appliedFacets": {}, "limit": 10, "offset": 0, "searchText": ""},
        {"landingPage": careers_path, "searchText": "", "limit": 10, "offset": 0},
        {"q": "", "limit": 10, "offset": 0, "domain": base_url.replace("https://", "")},
    ]
    for body in attempts:
        try:
            r = s.post(api_url, json=body, timeout=10,
                      headers={"Content-Type": "application/json", "Accept": "application/json"})
            ct = r.headers.get("Content-Type", "")
            if "json" in ct:
                d = r.json()
                status = d.get("status")
                data = d.get("data")
                if data:
                    print(f"      POST body={list(body.keys())} -> status={status}, data keys={list(data.keys()) if isinstance(data, dict) else type(data)}")
                else:
                    print(f"      POST body={list(body.keys())} -> status={status}, error={d.get('errorMsg')}")
            else:
                print(f"      POST body={list(body.keys())} -> {r.status_code} (not JSON)")
        except Exception as e:
            print(f"      POST body={list(body.keys())} -> ERROR: {e}")

    # Step 4: Try the /api/v1/search endpoint
    print(f"\n  [4] Trying /api/v1/search...")
    try:
        r = s.get(f"{base_url}/api/v1/search", params={"limit": 10, "offset": 0}, timeout=15)
        if r.status_code == 200 and "json" in r.headers.get("Content-Type", ""):
            d = r.json()
            print(f"      status={d.get('status')}, error={d.get('errorMsg')}")
            data = d.get("data")
            if data and isinstance(data, dict):
                print(f"      data keys: {list(data.keys())}")
    except Exception as e:
        print(f"      ERROR: {e}")

    # Step 5: Look for Workday URLs in the HTML (CVS has them)
    print(f"\n  [5] Checking for Workday backend...")
    try:
        r = s.get(full_url, timeout=15)
        wd_urls = re.findall(r'(https?://[a-z0-9-]+\.wd\d+\.myworkdayjobs\.com/[^\s"\'<>]+)', r.text)
        if wd_urls:
            print(f"      Found Workday URLs:")
            # Get unique base URLs
            seen = set()
            for u in wd_urls:
                base = re.match(r'(https?://[a-z0-9-]+\.wd\d+\.myworkdayjobs\.com/[^/]+)', u)
                if base and base.group(1) not in seen:
                    seen.add(base.group(1))
                    print(f"        {base.group(1)}")
        else:
            print(f"      No Workday URLs found in HTML")
    except Exception as e:
        print(f"      ERROR: {e}")

    # Clear cookies for next site
    s.cookies.clear()


def probe_amazon_search():
    """Amazon search.json with various query params."""
    print(f"\n{'='*60}")
    print(f"  Amazon Jobs - search.json")
    print(f"{'='*60}")

    base = "https://www.amazon.jobs"

    # Visit the search page to get cookies first
    print("\n  [1] Getting search page cookies...")
    r = s.get(f"{base}/en/search?offset=0&result_limit=10&sort=recent", timeout=15)
    print(f"      Status: {r.status_code}, Cookies: {list(s.cookies.keys())}")

    # Extract CSRF token if any
    html = r.text
    csrf = None
    csrf_match = re.search(r'authenticity_token.*?value="([^"]+)"', html)
    if csrf_match:
        csrf = csrf_match.group(1)
        print(f"      CSRF token: {csrf[:30]}...")

    # Try search.json with different params
    print("\n  [2] Trying search.json...")
    params_list = [
        {"offset": 0, "result_limit": 10, "sort": "recent"},
        {"offset": 0, "result_limit": 10, "sort": "recent", "base_query": "software"},
        {"offset": 0, "result_limit": 10, "sort": "recent", "latitude": "", "longitude": "", "loc_group_id": "", "loc_query": "", "base_query": "", "city": "", "country": "", "region": "", "county": "", "query_options": ""},
    ]

    for params in params_list:
        try:
            r = s.get(f"{base}/en/search.json", params=params, timeout=15,
                     headers={"Accept": "application/json"})
            print(f"\n      Params: {list(params.keys())}")
            print(f"      Status: {r.status_code}")
            if r.status_code == 200:
                d = r.json()
                hits = d.get("hits", 0)
                jobs = d.get("jobs", [])
                print(f"      hits: {hits}, jobs: {len(jobs)}")
                if jobs:
                    j = jobs[0]
                    print(f"      keys: {list(j.keys())[:15]}")
                    print(f"      Sample: {j.get('title', '?')} | {j.get('normalized_location', '?')}")
                    print(f"      URL: {j.get('job_path', '?')}")
        except Exception as e:
            print(f"      ERROR: {e}")

    s.cookies.clear()


def probe_dayforce_fix():
    """Dayforce needs numeric board ID, not the slug."""
    print(f"\n{'='*60}")
    print(f"  Dayforce (Shamrock) - finding correct API format")
    print(f"{'='*60}")

    # Visit the jobs page to find the correct API
    print("\n  [1] Visiting jobs listing page...")
    try:
        r = s.get("https://jobs.dayforcehcm.com/en-US/shamrocktc/CANDIDATEPORTAL/jobs", timeout=20)
        html = r.text
        print(f"      Status: {r.status_code}, Length: {len(html)}")

        # Look for API endpoints in the HTML/JS
        api_refs = re.findall(r'["\']((?:/api|https://[^"\']*api)[^"\']{5,100})["\']', html)
        if api_refs:
            print(f"      API refs: {sorted(set(api_refs))[:15]}")

        # Look for the board ID
        board_ids = re.findall(r'"boardId"\s*:\s*(\d+)', html)
        if board_ids:
            print(f"      Board IDs: {board_ids}")

        # Look for NEXT_DATA
        nd = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.DOTALL)
        if nd:
            data = json.loads(nd.group(1))
            pp = data.get("props", {}).get("pageProps", {})
            print(f"      __NEXT_DATA__ pageProps keys: {list(pp.keys())[:20]}")
            # Find relevant config
            for k in pp:
                v = pp[k]
                if isinstance(v, dict) and len(str(v)) < 2000:
                    if "board" in str(v).lower() or "api" in str(v).lower() or "job" in str(v).lower():
                        print(f"      pageProps.{k}: {json.dumps(v, indent=2)[:500]}")
                elif isinstance(v, list) and v:
                    print(f"      pageProps.{k}: list[{len(v)}]")
                    if isinstance(v[0], dict):
                        print(f"        keys: {list(v[0].keys())[:15]}")
                        if "title" in v[0] or "jobTitle" in v[0]:
                            title = v[0].get("title", v[0].get("jobTitle", "?"))
                            print(f"        Sample: {title}")

        # Look for JS bundles with API info
        scripts = re.findall(r'<script[^>]+src="([^"]*_next[^"]*)"', html)
        print(f"      JS bundles: {len(scripts)}")

    except Exception as e:
        print(f"      ERROR: {e}")

    s.cookies.clear()


if __name__ == "__main__":
    probe_phenom_with_cookies("PNC Bank", "https://careers.pnc.com", "/global/en/c/technology-jobs")
    probe_phenom_with_cookies("CVS Health", "https://jobs.cvshealth.com", "/us/en/it-jobs")
    probe_phenom_with_cookies("U.S. Bank", "https://careers.usbank.com", "/global/en")
    probe_amazon_search()
    probe_dayforce_fix()
