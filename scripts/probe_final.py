"""
Final platform probe — uses correct API endpoints for all companies.

Findings from prior probes:
- PNC, CVS, U.S. Bank: Phenom frontend but Workday backend
- Capital One: TalentBrew frontend but Workday backend
- GM, Availity: Direct Workday
- Konrad: Greenhouse (board: konradgroup)
- Amazon: search.json API
- AXS: Greenhouse (need to find board token)
- MetLife, Deloitte, Twitch, Aramark: Unknown/custom (need further investigation)
- Shamrock (Dayforce), Demandflow, Applied Systems, Net Jets: Single job URLs
"""
import json
import re
import sys
import time
from pathlib import Path
from urllib.parse import urlparse

import requests

BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND_DIR))
from app.db.database import get_connection

SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept": "application/json, text/html, */*",
    "Accept-Language": "en-US,en;q=0.9",
})
TIMEOUT = 20


# ═══════════════════════════════════════════════════════════════════
#  Platform connectors
# ═══════════════════════════════════════════════════════════════════

def fetch_workday(tenant: str, wd_instance: str, site_name: str, label: str = "") -> dict:
    """
    Workday JSON API.
    POST https://{tenant}.{wd_instance}.myworkdayjobs.com/wday/cxs/{tenant}/{site_name}/jobs
    """
    host = f"{tenant}.{wd_instance}.myworkdayjobs.com"
    api_url = f"https://{host}/wday/cxs/{tenant}/{site_name}/jobs"
    payload = {"appliedFacets": {}, "limit": 20, "offset": 0, "searchText": ""}

    try:
        resp = SESSION.post(api_url, json=payload, timeout=TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        return {"error": str(e), "api_url": api_url}

    total = data.get("total", 0)
    jobs = data.get("jobPostings", [])

    roles = []
    for jp in jobs[:10]:
        roles.append({
            "title": jp.get("title", ""),
            "location": jp.get("locationsText", ""),
            "posted": jp.get("postedOn", ""),
            "url": f"https://{host}/en-US{jp['externalPath']}" if jp.get("externalPath") else "",
        })

    return {
        "platform": "workday",
        "label": label,
        "api_url": api_url,
        "total_jobs": total,
        "sample_roles": roles,
    }


def fetch_greenhouse(board_token: str, label: str = "") -> dict:
    """
    Greenhouse boards API.
    GET https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs
    """
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
        "label": label,
        "api_url": api_url,
        "total_jobs": len(jobs),
        "sample_roles": roles,
    }


def fetch_amazon(label: str = "") -> dict:
    """
    Amazon Jobs search.json.
    GET https://www.amazon.jobs/en/search.json?offset=0&result_limit=20&sort=recent&country=USA
    """
    api_url = "https://www.amazon.jobs/en/search.json"
    params = {
        "offset": 0,
        "result_limit": 20,
        "sort": "recent",
        "country": "USA",
    }

    try:
        # Need to visit the page first for cookies
        SESSION.get("https://www.amazon.jobs/en/search", timeout=TIMEOUT)
        resp = SESSION.get(api_url, params=params, timeout=TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        return {"error": str(e), "api_url": api_url}

    hits_count = data.get("hits", 0)
    jobs = data.get("jobs", [])

    roles = []
    for job in jobs[:10]:
        roles.append({
            "title": job.get("title", ""),
            "location": job.get("normalized_location", job.get("city", "")),
            "posted": job.get("posted_date", ""),
            "url": f"https://www.amazon.jobs{job['job_path']}" if job.get("job_path") else "",
            "id": job.get("id_icims", job.get("id", "")),
        })

    return {
        "platform": "amazon",
        "label": label,
        "api_url": api_url,
        "total_jobs": hits_count,
        "sample_roles": roles,
    }


def detect_workday_from_page(url: str) -> dict | None:
    """Visit a Phenom/TalentBrew page and extract Workday URLs."""
    try:
        r = SESSION.get(url, timeout=TIMEOUT)
        matches = re.findall(
            r'(https?://([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com/([^/\s"\'<>]+))',
            r.text
        )
        if matches:
            # Deduplicate
            seen = {}
            for full_url, tenant, instance, site in matches:
                key = f"{tenant}.{instance}.{site}"
                if key not in seen:
                    seen[key] = (tenant, instance, site)
            return seen
    except Exception:
        pass
    return None


def try_detect_greenhouse_board(url: str) -> str | None:
    """Try to detect the Greenhouse board token from a page or URL."""
    try:
        r = SESSION.get(url, timeout=TIMEOUT)
        html = r.text

        patterns = [
            r'boards-api\.greenhouse\.io/v1/boards/([a-zA-Z0-9_-]+)',
            r'boards\.greenhouse\.io/([a-zA-Z0-9_-]+)',
            r'greenhouse\.io/embed/job_board\?for=([a-zA-Z0-9_-]+)',
            r'"boardToken"\s*:\s*"([^"]+)"',
            r'"board_token"\s*:\s*"([^"]+)"',
        ]
        for p in patterns:
            match = re.search(p, html)
            if match:
                return match.group(1)
    except Exception:
        pass
    return None


def probe_unknown_site(name: str, url: str) -> dict:
    """Try to auto-detect the platform for an unknown site."""
    result = {"platform": "unknown", "label": name}

    # Try to detect Workday backend
    wd = detect_workday_from_page(url)
    if wd:
        first_key = next(iter(wd))
        tenant, instance, site = wd[first_key]
        wd_result = fetch_workday(tenant, instance, site, label=f"{name} (Workday)")
        if "error" not in wd_result:
            return wd_result
        result["workday_attempt"] = wd_result

    # Try to detect Greenhouse
    gh = try_detect_greenhouse_board(url)
    if gh:
        gh_result = fetch_greenhouse(gh, label=f"{name} (Greenhouse)")
        if "error" not in gh_result:
            return gh_result
        result["greenhouse_attempt"] = gh_result

    # Basic page info
    try:
        r = SESSION.get(url, timeout=TIMEOUT, allow_redirects=True)
        result["final_url"] = r.url
        result["page_status"] = r.status_code
        result["page_length"] = len(r.text)
    except Exception as e:
        result["error"] = str(e)

    return result


# ═══════════════════════════════════════════════════════════════════
#  Company → Platform mapping (from our research)
# ═══════════════════════════════════════════════════════════════════

COMPANY_API_MAP = {
    # id: (probe_function, args, recommended_careers_url)
    1:  ("workday", ("pnc", "wd5", "External"), "PNC Bank"),
    2:  ("workday", ("generalmotors", "wd5", "Careers_GM"), "General Motors"),
    4:  ("workday", ("capitalone", "wd12", "Capital_One"), "Capital One"),
    5:  ("workday", ("availity", "wd1", "Availity_Careers_US"), "Availity"),
    15: ("amazon", (), "Amazon"),
    16: ("workday", ("cvshealth", "wd1", "CVS_Health_Careers"), "CVS Health"),
    19: ("greenhouse", ("konradgroup",), "Konrad"),
    20: ("workday", ("usbank", "wd1", "US_Bank_Careers"), "U.S. Bank"),
}


def run_final_probe():
    print("=" * 78)
    print("  FINAL PLATFORM PROBE — Correct API Endpoints")
    print("=" * 78)

    with get_connection() as conn:
        rows = conn.execute(
            "SELECT id, name, careers_url, followed FROM companies ORDER BY followed DESC, id"
        ).fetchall()

    results = []
    successful = 0
    failed = 0

    for company_id, name, careers_url, followed in rows:
        print(f"\n{'─'*78}")
        marker = " [FOLLOWED]" if followed else ""
        print(f"[{company_id}] {name}{marker}")

        if not careers_url or "manual.local" in careers_url:
            print(f"  SKIP — no valid URL")
            continue

        start_t = time.time()

        if company_id in COMPANY_API_MAP:
            platform, args, label = COMPANY_API_MAP[company_id]
            if platform == "workday":
                result = fetch_workday(*args, label=name)
            elif platform == "greenhouse":
                result = fetch_greenhouse(*args, label=name)
            elif platform == "amazon":
                result = fetch_amazon(label=name)
            else:
                result = {"error": f"Unknown platform type: {platform}"}
        else:
            # Try auto-detection
            print(f"  Auto-detecting platform for {careers_url}...")
            result = probe_unknown_site(name, careers_url)

        elapsed = time.time() - start_t
        result["company_id"] = company_id
        result["company_name"] = name
        result["careers_url"] = careers_url
        result["followed"] = bool(followed)
        result["elapsed"] = round(elapsed, 2)
        results.append(result)

        if "error" in result:
            failed += 1
            print(f"  Platform: {result.get('platform', '?')}")
            print(f"  ERROR: {result['error']}")
        else:
            successful += 1
            total = result.get("total_jobs", 0)
            platform = result.get("platform", "?")
            print(f"  Platform: {platform}")
            print(f"  API: {result.get('api_url', '?')}")
            print(f"  Total jobs: {total}")
            sample = result.get("sample_roles", [])
            for role in sample[:5]:
                title = role.get("title", "?")
                loc = role.get("location", "?")
                print(f"    • {title} — {loc}")

        print(f"  Time: {elapsed:.1f}s")

    # ── Summary ──────────────────────────────────────────────────
    print(f"\n{'='*78}")
    print(f"  SUMMARY: {successful} working, {failed} failed, {len(rows)} total")
    print(f"{'='*78}")

    print(f"\n  ✓ WORKING ({successful}):")
    for r in results:
        if "error" not in r and r.get("total_jobs", 0) > 0:
            print(f"    [{r['company_id']}] {r['company_name']}: {r['platform']} — {r['total_jobs']} jobs")
            if r.get("api_url"):
                print(f"         API: {r['api_url']}")

    print(f"\n  ✗ NOT WORKING ({failed}):")
    for r in results:
        if "error" in r:
            print(f"    [{r.get('company_id', '?')}] {r.get('company_name', '?')}: {r.get('error', '')[:80]}")

    print(f"\n  ? ZERO RESULTS:")
    for r in results:
        if "error" not in r and r.get("total_jobs", 0) == 0:
            print(f"    [{r.get('company_id', '?')}] {r.get('company_name', '?')}: {r.get('platform', '?')}")

    # Save results
    output_path = Path(__file__).resolve().parent.parent / ".runtime" / "final_probe_results.json"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, default=str)
    print(f"\n  Results saved to: {output_path}")


if __name__ == "__main__":
    run_final_probe()
