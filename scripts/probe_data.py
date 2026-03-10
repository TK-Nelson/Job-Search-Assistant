"""Quick data structure probe for Phenom and other APIs."""
import requests
import json
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND_DIR))

s = requests.Session()
s.headers.update({
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept": "application/json",
})


def probe_phenom_api(name, base_url):
    print(f"\n=== {name} ===")
    url = f"{base_url}/api/apply/v2/jobs"
    try:
        r = s.get(url, params={"limit": 5, "offset": 0}, timeout=20)
        print(f"  Status: {r.status_code}, CT: {r.headers.get('Content-Type', '')[:40]}")
        if r.status_code != 200:
            print(f"  Body: {r.text[:200]}")
            return

        try:
            d = r.json()
        except Exception:
            print(f"  Not JSON. Body: {r.text[:200]}")
            return

        print(f"  Top keys: {list(d.keys())}")
        print(f"  status: {d.get('status')}, error: {d.get('errorMsg')}")

        data = d.get("data", {})
        if isinstance(data, dict):
            print(f"  data keys: {list(data.keys())}")
            for k, v in data.items():
                if isinstance(v, list):
                    print(f"    data.{k}: list[{len(v)}]")
                    if v and isinstance(v[0], dict):
                        keys = list(v[0].keys())
                        print(f"      item keys: {keys[:20]}")
                        item = v[0]
                        title = item.get("title", item.get("jobTitle", item.get("name", "?")))
                        loc = item.get("location", item.get("city", "?"))
                        url_field = item.get("applyUrl", item.get("url", item.get("jobUrl", "?")))
                        print(f"      SAMPLE: {title} | {loc}")
                        print(f"      URL: {url_field}")
                        # Print full first item for structure analysis
                        print(f"      FULL ITEM: {json.dumps(item, indent=2, default=str)[:800]}")
                elif isinstance(v, (int, str, bool, float)):
                    print(f"    data.{k}: {v}")
                elif isinstance(v, dict):
                    print(f"    data.{k}: dict keys={list(v.keys())[:10]}")
        elif isinstance(data, list):
            print(f"  data is list[{len(data)}]")
            if data:
                print(f"    first keys: {list(data[0].keys())}")
        else:
            print(f"  data type: {type(data)}, value: {str(data)[:200]}")

    except Exception as e:
        print(f"  ERROR: {e}")


def probe_capital_one():
    """Capital One uses Workday behind TalentBrew/Radancy."""
    print("\n=== Capital One (Workday behind TalentBrew) ===")
    # The HTML references capitalone.wd12.myworkdayjobs.com
    url = "https://capitalone.wd12.myworkdayjobs.com/wday/cxs/capitalone/Capital_One/jobs"
    payload = {"appliedFacets": {}, "limit": 20, "offset": 0, "searchText": ""}
    try:
        r = s.post(url, json=payload, timeout=20)
        print(f"  Status: {r.status_code}")
        if r.status_code == 200:
            d = r.json()
            total = d.get("total", 0)
            jobs = d.get("jobPostings", [])
            print(f"  Total: {total}")
            for j in jobs[:5]:
                print(f"    - {j.get('title', '?')} | {j.get('locationsText', '?')}")
        else:
            print(f"  Body: {r.text[:200]}")
    except Exception as e:
        print(f"  ERROR: {e}")

    # Also try with different site names
    for site in ["Capital_One", "CapitalOne", "capital_one"]:
        url = f"https://capitalone.wd12.myworkdayjobs.com/wday/cxs/capitalone/{site}/jobs"
        try:
            r = s.post(url, json=payload, timeout=10)
            if r.status_code == 200:
                d = r.json()
                print(f"  Site '{site}': {d.get('total', 0)} jobs")
        except Exception:
            pass


def probe_amazon_deeper():
    """Amazon Jobs - try with different headers and formats."""
    print("\n=== Amazon Jobs (deeper) ===")

    # Try with form-encoded data
    url = "https://www.amazon.jobs/en/search.json"
    try:
        r = s.get(url, params={"offset": 0, "result_limit": 10, "sort": "recent",
                               "category[]": "", "schedule_type_id[]": ""}, timeout=15)
        print(f"  GET {url}: {r.status_code}, CT: {r.headers.get('Content-Type', '')[:40]}")
        if r.status_code == 200:
            try:
                d = r.json()
                print(f"    Keys: {list(d.keys())}")
                hits = d.get("hits", d.get("jobs", []))
                print(f"    hits: {len(hits)}")
                if hits:
                    print(f"    item keys: {list(hits[0].keys())[:15]}")
                    print(f"    Sample: {hits[0].get('title', '?')}")
            except Exception:
                print(f"    Not JSON: {r.text[:200]}")
    except Exception as e:
        print(f"  ERROR: {e}")

    # Try the search page and parse the embedded JSON data
    try:
        r = s.get("https://www.amazon.jobs/en/search?offset=0&result_limit=10&sort=recent&distanceType=Mi&radius=24km&latitude=&longitude=&loc_group_id=&loc_query=&base_query=&city=&country=&region=&county=&query_options=&", timeout=15)
        print(f"\n  GET search page: {r.status_code}, Length: {len(r.text)}")
        html = r.text

        import re
        # Look for embedded job data
        data_match = re.search(r'var defined_search_jobs\s*=\s*(\[.*?\]);', html, re.DOTALL)
        if data_match:
            d = json.loads(data_match.group(1))
            print(f"    Found embedded jobs: {len(d)}")
            if d:
                print(f"    Keys: {list(d[0].keys())[:15]}")
                print(f"    Sample: {d[0].get('title', '?')}")
        else:
            # Look for any JSON blobs with job data
            json_blobs = re.findall(r'"jobs"\s*:\s*(\[.*?\])', html[:50000], re.DOTALL)
            if json_blobs:
                print(f"    Found 'jobs' JSON blob, length: {len(json_blobs[0])}")

            # Check for React/Next data
            react_data = re.search(r'window\.__INITIAL_STATE__\s*=\s*({.*?});', html, re.DOTALL)
            if react_data:
                print("    Found __INITIAL_STATE__")

            # Amazon might use a CSRF token
            csrf = re.search(r'name="csrf[_-]token"[^>]*value="([^"]+)"', html)
            meta_csrf = re.search(r'<meta[^>]+name="csrf[_-]token"[^>]+content="([^"]+)"', html)
            if csrf:
                print(f"    CSRF token found: {csrf.group(1)[:30]}...")
            if meta_csrf:
                print(f"    Meta CSRF: {meta_csrf.group(1)[:30]}...")

    except Exception as e:
        print(f"  Search page ERROR: {e}")


def probe_dayforce_data():
    """Check what the Dayforce 400 response contains."""
    print("\n=== Dayforce (Shamrock) - inspect 400 response ===")
    url = "https://jobs.dayforcehcm.com/api/jobposting/v2/search/shamrocktc/CANDIDATEPORTAL"
    try:
        r = s.get(url, params={"skip": 0, "take": 20}, timeout=15)
        print(f"  Status: {r.status_code}")
        print(f"  Body: {r.text[:500]}")

        # Try POST with JSON body
        r2 = s.post(url, json={"skip": 0, "take": 20, "query": ""}, timeout=15,
                    headers={"Content-Type": "application/json"})
        print(f"\n  POST Status: {r2.status_code}")
        print(f"  POST Body: {r2.text[:500]}")

        # Try with different query params
        r3 = s.get(url, params={"$skip": 0, "$top": 20}, timeout=15)
        print(f"\n  GET with OData params: {r3.status_code}")
        print(f"  Body: {r3.text[:500]}")
    except Exception as e:
        print(f"  ERROR: {e}")


if __name__ == "__main__":
    # Phenom sites
    probe_phenom_api("PNC Bank", "https://careers.pnc.com")
    probe_phenom_api("CVS Health", "https://jobs.cvshealth.com")
    probe_phenom_api("U.S. Bank", "https://careers.usbank.com")
    probe_phenom_api("MetLife", "https://www.metlifecareers.com")

    # Capital One (Workday via TalentBrew)
    probe_capital_one()

    # Amazon
    probe_amazon_deeper()

    # Dayforce
    probe_dayforce_data()
