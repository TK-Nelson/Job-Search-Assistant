"""Probe Deloitte, Twitch, MetLife for their actual ATS APIs."""
import requests
import re
import json

s = requests.Session()
s.headers.update({
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept": "*/*",
})

# --- Deloitte (detected Lever) ---
print("=== Deloitte ===")
r = s.get("https://apply.deloitte.com/en_US/careers", timeout=20)
html = r.text
lever_matches = re.findall(r"lever\.co/([a-zA-Z0-9_-]+)", html)
if lever_matches:
    for token in sorted(set(lever_matches)):
        print(f"  Lever board in HTML: {token}")

for name in ["deloitte", "deloitteus", "deloitte-us", "deloitte4"]:
    api_url = f"https://api.lever.co/v0/postings/{name}?limit=5"
    r2 = s.get(api_url, timeout=10)
    if r2.status_code == 200:
        d = r2.json()
        if isinstance(d, list) and d:
            print(f"  Lever '{name}': {len(d)} jobs")
            for j in d[:3]:
                t = j.get("text", "?")
                loc = j.get("categories", {}).get("location", "?")
                print(f"    - {t} | {loc}")
            break
    else:
        print(f"  Lever '{name}': {r2.status_code}")

# Also look for any other patterns
print(f"  Page length: {len(html)}")
# Check for smartrecruiters, successfactors, etc
for pat in ["smartrecruiters", "successfactors", "taleo", "jobvite", "ashbyhq"]:
    if pat in html.lower():
        print(f"  Found {pat} reference in HTML")

print()

# --- Twitch ---
print("=== Twitch ===")
r = s.get("https://careers.twitch.com/en/careers", timeout=20)
html = r.text
print(f"  Page length: {len(html)}")

# Check for any ATS references
for pat in ["lever", "greenhouse", "workday", "smartrecruiters", "ashby", "icims", "taleo", "jobvite"]:
    if pat in html.lower():
        print(f"  Found '{pat}' reference")

# Twitch is owned by Amazon - check if jobs are on Amazon
print("  Trying Amazon Jobs for Twitch...")
s.get("https://www.amazon.jobs/en/search", timeout=15)
r3 = s.get("https://www.amazon.jobs/en/search.json",
           params={"offset": 0, "result_limit": 10, "sort": "recent",
                   "base_query": "twitch", "country": "USA"},
           timeout=15)
if r3.status_code == 200:
    d = r3.json()
    hits = d.get("hits", 0)
    jobs = d.get("jobs", [])
    print(f"  Amazon Jobs 'twitch': {hits} hits, {len(jobs)} returned")
    for j in jobs[:5]:
        t = j.get("title", "?")
        loc = j.get("normalized_location", "?")
        co = j.get("company_name", "?")
        print(f"    - [{co}] {t} | {loc}")

# Try Greenhouse for Twitch
for name in ["twitch", "twitchtv", "twitchinteractive"]:
    api_url = f"https://boards-api.greenhouse.io/v1/boards/{name}/jobs"
    r4 = s.get(api_url, timeout=10)
    if r4.status_code == 200:
        d = r4.json()
        jobs = d.get("jobs", [])
        if jobs:
            print(f"  Greenhouse '{name}': {len(jobs)} jobs")
            for j in jobs[:3]:
                print(f"    - {j.get('title', '?')}")

print()

# --- MetLife ---
print("=== MetLife ===")
r = s.get("https://www.metlifecareers.com/en_US/ml", timeout=25)
html = r.text
print(f"  Page length: {len(html)}")

for pat in ["lever", "greenhouse", "workday", "smartrecruiters", "ashby", "icims",
            "taleo", "successfactors", "jobvite", "radancy", "talentbrew", "phenom"]:
    if pat in html.lower():
        print(f"  Found '{pat}' reference")

# Try Workday with various tenant patterns
for tenant, inst, site in [
    ("metlife", "wd1", "MetLife"),
    ("metlife", "wd1", "External"),
    ("metlife", "wd5", "MetLife"),
    ("metlife", "wd5", "External"),
    ("metlife", "wd3", "MetLife"),
    ("metlife", "wd3", "External"),
    ("metlife", "wd1", "MetLife_Careers"),
]:
    url = f"https://{tenant}.{inst}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs"
    try:
        r5 = s.post(url, json={"appliedFacets": {}, "limit": 5, "offset": 0, "searchText": ""}, timeout=8)
        if r5.status_code == 200:
            d = r5.json()
            total = d.get("total", 0)
            if total > 0:
                print(f"  Workday {tenant}.{inst}/{site}: {total} jobs!")
                for j in d.get("jobPostings", [])[:3]:
                    print(f"    - {j.get('title', '?')} | {j.get('locationsText','?')}")
                break
    except Exception:
        pass

# Check for TalentBrew/Radancy URLs in HTML
tb_urls = re.findall(r"tbcdn\.talentbrew\.com/company/(\d+)", html)
if tb_urls:
    print(f"  TalentBrew company IDs: {sorted(set(tb_urls))}")

# Check for eightfold
ef_matches = re.findall(r"([a-z0-9-]+)\.eightfold\.ai", html)
if ef_matches:
    print(f"  Eightfold tenants: {sorted(set(ef_matches))}")
    for tenant in sorted(set(ef_matches)):
        ef_url = f"https://{tenant}.eightfold.ai/api/apply/v2/jobs"
        try:
            r6 = s.get(ef_url, params={"num": 10, "start": 0, "domain": f"{tenant}.com"}, timeout=10)
            print(f"  Eightfold API: {r6.status_code}")
            if r6.status_code == 200:
                data = r6.json()
                positions = data.get("positions", [])
                print(f"    Positions: {len(positions)}")
        except Exception as e:
            print(f"  Eightfold error: {e}")
