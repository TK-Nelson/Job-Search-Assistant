"""Centralized logo URL resolution for companies."""

import os
from urllib.parse import urlparse

LOGO_DEV_TOKEN = os.environ.get("LOGO_DEV_TOKEN", "")

JOB_BOARD_DOMAINS = {
    "myworkdayjobs.com", "greenhouse.io", "lever.co", "smartrecruiters.com",
    "icims.com", "jobvite.com", "jazz.co", "bamboohr.com", "breezy.hr",
    "workable.com", "ashbyhq.com", "rippling.com", "paylocity.com",
    "dayforcehcm.com", "ultipro.com", "taleo.net", "successfactors.com",
}

DOMAIN_OVERRIDES: dict[str, str] = {
    "general motors": "gm.com",
    "capital one": "capitalone.com",
    "pnc bank": "pnc.com",
}


def extract_domain(url: str) -> str | None:
    """Extract the root domain from a URL, filtering out job-board hosts."""
    if not url:
        return None
    parsed = urlparse(url)
    host = parsed.netloc or parsed.path
    if not host:
        return None
    host = host.split(":")[0]
    parts = host.split(".")
    domain = ".".join(parts[-2:]) if len(parts) >= 2 else host
    if domain.lower() in JOB_BOARD_DOMAINS:
        return None
    return domain


def resolve_logo_domain(company_name: str, careers_url: str) -> str:
    """Get the best domain for a company logo, falling back to name-based guess."""
    override = DOMAIN_OVERRIDES.get(company_name.strip().lower())
    if override:
        return override
    domain = extract_domain(careers_url or "")
    if not domain:
        name_slug = company_name.strip().lower().replace(" ", "")
        domain = f"{name_slug}.com"
    return domain


def build_logo_url(company_name: str, careers_url: str = "") -> str:
    """Build a full logo.dev URL for a company."""
    domain = resolve_logo_domain(company_name, careers_url)
    return f"https://img.logo.dev/{domain}?token={LOGO_DEV_TOKEN}&size=64&format=png"
