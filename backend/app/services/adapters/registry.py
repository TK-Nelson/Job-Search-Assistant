"""
Adapter registry – maps ``portal_type`` → adapter instance and provides
URL-based auto-detection of portal platforms.
"""

from __future__ import annotations

import re
from urllib.parse import urlparse

from .activate import ActivateAdapter
from .amazon import AmazonJobsAdapter
from .base import BaseAdapter
from .deloitte import DeloitteAdapter
from .greenhouse import GreenhouseAdapter
from .phenom import PhenomAdapter
from .talent_brew import TalentBrewAdapter
from .workday import WorkdayAdapter

# ── Singleton adapter instances ───────────────────────────────────

_ADAPTERS: dict[str, BaseAdapter] = {
    "activate": ActivateAdapter(),
    "amazon_jobs": AmazonJobsAdapter(),
    "workday": WorkdayAdapter(),
    "greenhouse": GreenhouseAdapter(),
    "talent_brew": TalentBrewAdapter(),
    "deloitte": DeloitteAdapter(),
    "phenom": PhenomAdapter(),
}

SUPPORTED_PORTAL_TYPES = frozenset(_ADAPTERS.keys())


def get_adapter(portal_type: str) -> BaseAdapter | None:
    """Return the adapter for *portal_type*, or ``None`` if unsupported."""
    return _ADAPTERS.get(portal_type)


# ── Auto-detection from URL ──────────────────────────────────────

_DETECTION_RULES: list[tuple[re.Pattern, str]] = [
    (re.compile(r"amazon\.jobs", re.I), "amazon_jobs"),
    (re.compile(r"myworkdayjobs\.com", re.I), "workday"),
    (re.compile(r"greenhouse\.io", re.I), "greenhouse"),
    (re.compile(r"boards\.greenhouse\.io|boards-api\.greenhouse\.io", re.I), "greenhouse"),
    # Known TalentBrew / TMP Worldwide sites
    (re.compile(r"capitalonecareers\.com", re.I), "talent_brew"),
    # Phenom People career sites
    (re.compile(r"jobs\.cvshealth\.com", re.I), "phenom"),
    (re.compile(r"careers\.pnc\.com", re.I), "phenom"),
    (re.compile(r"careers\.usbank\.com", re.I), "phenom"),
    (re.compile(r"phenompeople\.com", re.I), "phenom"),
    # Generic Phenom pattern: any site with /search-results in the path
    (re.compile(r"/search-results", re.I), "phenom"),
    # Activate platform (Huntington, etc.)
    (re.compile(r"activatecdn", re.I), "activate"),
    (re.compile(r"/search/searchjobs", re.I), "activate"),
    (re.compile(r"huntington-careers\.com", re.I), "activate"),
    # Deloitte-specific
    (re.compile(r"apply\.deloitte\.com", re.I), "deloitte"),
]


def detect_portal_type(url: str) -> str | None:
    """
    Attempt to identify the ATS platform from a careers or search URL.
    Returns a portal_type string, or ``None`` if the platform is unknown.
    """
    if not url:
        return None
    for pattern, portal_type in _DETECTION_RULES:
        if pattern.search(url):
            return portal_type
    return None


def derive_search_url(portal_type: str, careers_url: str) -> str | None:
    """
    Given a portal type and the company's general careers page URL, try
    to derive the API-level search URL that the adapter needs.

    Returns ``None`` if derivation isn't possible.
    """
    if not careers_url:
        return None

    careers_url = careers_url.strip().rstrip("/")

    if portal_type == "amazon_jobs":
        # https://www.amazon.jobs/en/ → https://www.amazon.jobs/en/search.json
        parsed = urlparse(careers_url)
        base = f"{parsed.scheme}://{parsed.netloc}"
        # Preserve locale prefix if present (e.g. /en)
        path_parts = [p for p in parsed.path.strip("/").split("/") if p]
        locale = path_parts[0] if path_parts and len(path_parts[0]) <= 5 else "en"
        return f"{base}/{locale}/search.json"

    if portal_type == "workday":
        # https://generalmotors.wd5.myworkdayjobs.com/Careers_GM
        # → https://generalmotors.wd5.myworkdayjobs.com/wday/cxs/generalmotors/Careers_GM/jobs
        parsed = urlparse(careers_url)
        host = parsed.netloc
        org = host.split(".")[0]
        path_parts = [p for p in parsed.path.strip("/").split("/") if p]
        # Filter out locale segments
        board_parts = [p for p in path_parts if not re.match(r"^[a-z]{2}(-[A-Z]{2})?$", p)]
        board = board_parts[0] if board_parts else "jobs"
        return f"https://{host}/wday/cxs/{org}/{board}/jobs"

    if portal_type == "greenhouse":
        # Greenhouse needs a board slug. Try to extract from career site URL
        # or just return None (user must provide)
        parsed = urlparse(careers_url)
        if "greenhouse.io" in parsed.netloc:
            parts = [p for p in parsed.path.strip("/").split("/") if p]
            if "boards" in parts:
                idx = parts.index("boards")
                if idx + 1 < len(parts):
                    slug = parts[idx + 1]
                    return f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs"
            elif parts:
                return f"https://boards-api.greenhouse.io/v1/boards/{parts[0]}/jobs"
        # Can't derive from a non-greenhouse URL – user needs to provide the board slug
        return None

    if portal_type == "talent_brew":
        # https://www.capitalonecareers.com/search-jobs → .../search-jobs/results
        if "/search-jobs" in careers_url:
            base = careers_url.split("/search-jobs")[0] + "/search-jobs"
            return f"{base}/results"
        return f"{careers_url}/search-jobs/results"

    if portal_type == "phenom":
        # Phenom sites use /<locale>/search-results
        # https://jobs.cvshealth.com/us/en/search-results
        # https://careers.pnc.com/global/en/search-results
        if "/search-results" in careers_url:
            return careers_url.split("?")[0]  # strip any existing params
        # Try to find the search-results path from the careers URL
        from urllib.parse import urlparse as _urlparse
        p = _urlparse(careers_url)
        # Walk common locale patterns
        for locale in ["us/en", "global/en", "en"]:
            candidate = f"{p.scheme}://{p.netloc}/{locale}/search-results"
            return candidate
        return None

    if portal_type == "activate":
        # Activate sites: the adapter derives the API URL itself;
        # just need the base site URL.
        parsed = urlparse(careers_url)
        return f"{parsed.scheme}://{parsed.netloc}"

    if portal_type == "deloitte":
        # https://apply.deloitte.com/en_US/careers → .../SearchJobs
        if "/SearchJobs" in careers_url:
            return careers_url
        return f"{careers_url}/SearchJobs"

    return None
