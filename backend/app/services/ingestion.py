import hashlib
import re
import sqlite3
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen


class LinkExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[dict[str, str]] = []
        self._current_href: str | None = None
        self._current_text_parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "a":
            return
        href = None
        for key, value in attrs:
            if key.lower() == "href" and value:
                href = value
                break
        self._current_href = href
        self._current_text_parts = []

    def handle_data(self, data: str) -> None:
        if self._current_href is not None:
            self._current_text_parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() != "a" or not self._current_href:
            return
        text = " ".join(part.strip() for part in self._current_text_parts).strip()
        self.links.append({"href": self._current_href, "text": text})
        self._current_href = None
        self._current_text_parts = []


JOB_HINTS = (
    "job",
    "career",
    "position",
    "opening",
    "vacanc",
    "apply",
    "opportunit",
)

# Domains that are never actual job listings — social media, share widgets, etc.
_BLOCKED_DOMAINS = {
    "facebook.com", "www.facebook.com", "m.facebook.com",
    "twitter.com", "www.twitter.com", "x.com",
    "linkedin.com", "www.linkedin.com",
    "instagram.com", "www.instagram.com",
    "youtube.com", "www.youtube.com",
    "tiktok.com", "www.tiktok.com",
    "pinterest.com", "www.pinterest.com",
    "reddit.com", "www.reddit.com",
    "glassdoor.com", "www.glassdoor.com",
    "indeed.com", "www.indeed.com",
    "maps.google.com", "play.google.com", "apps.apple.com",
}

# URL path fragments that indicate non-job pages (share dialogs, auth, etc.)
_BLOCKED_PATH_PATTERNS = (
    "/sharer", "/share", "/intent/", "/signOn", "/signin", "/login",
    "/oauth", "/auth/", "/_linkedinApi", "/feed", "/hashtag",
)

# Patterns that strongly suggest a URL is a single job posting, not a search page
_SINGLE_POSTING_INDICATORS = (
    "/job/", "/jobs/", "/jobdetail/", "/JobDetail/",
    "/InviteToApply", "jobId=", "job_app?token=",
    "/R0", "/JR-",
)


def _looks_like_single_posting_url(url: str) -> bool:
    """
    Heuristic: return True if this URL looks like it points to one specific
    job listing rather than a careers search / listings page.
    """
    if not url or not url.startswith("http"):
        return False
    # Workday individual job paths
    if re.search(r'/job/[^/]+$', url):
        return True
    lower = url.lower()
    for indicator in _SINGLE_POSTING_INDICATORS:
        if indicator.lower() in lower:
            return True
    # LinkedIn/job board tracking params are a strong signal
    if 'source=linkedin' in lower or 'utm_source=linkedin' in lower:
        return True
    return False


def _normalize_text(value: str) -> str:
    lowered = value.lower().strip()
    collapsed = re.sub(r"\s+", " ", lowered)
    return collapsed


def _canonicalize_url(url: str) -> str:
    parsed = urlparse(url)
    scheme = parsed.scheme.lower() if parsed.scheme else "https"
    netloc = parsed.netloc.lower()
    path = parsed.path or "/"
    return f"{scheme}://{netloc}{path}".rstrip("/")


def _fingerprint(company_id: int, canonical_url: str, title: str, location: str) -> str:
    seed = f"{company_id}|{_normalize_text(canonical_url)}|{_normalize_text(title)}|{_normalize_text(location)}"
    return hashlib.sha256(seed.encode("utf-8")).hexdigest()


def _is_blocked_url(url: str) -> bool:
    """Return True if the URL points to a known non-job domain or path."""
    parsed = urlparse(url)
    netloc = parsed.netloc.lower().lstrip("www.") if parsed.netloc else ""
    full_netloc = parsed.netloc.lower() if parsed.netloc else ""
    if full_netloc in _BLOCKED_DOMAINS or netloc in _BLOCKED_DOMAINS:
        return True
    path_lower = (parsed.path or "").lower()
    return any(frag in path_lower for frag in _BLOCKED_PATH_PATTERNS)


def _is_same_domain(base_url: str, candidate_url: str) -> bool:
    """Check if candidate is on the same domain (or subdomain) as the base."""
    base_host = urlparse(base_url).netloc.lower().lstrip("www.")
    cand_host = urlparse(candidate_url).netloc.lower().lstrip("www.")
    if not base_host or not cand_host:
        return False
    return cand_host == base_host or cand_host.endswith("." + base_host) or base_host.endswith("." + cand_host)


def _looks_like_job_link(link_text: str, href: str) -> bool:
    if _is_blocked_url(href):
        return False
    value = f"{link_text} {href}".lower()
    return any(hint in value for hint in JOB_HINTS)


def _normalize_filter_terms(values: list[str] | None) -> list[str]:
    terms = [_normalize_text(value) for value in (values or [])]
    return [term for term in terms if term]


def _matches_role_filters(
    *,
    title: str,
    description_text: str,
    role_filter_enabled: bool,
    title_contains: list[str] | None,
    description_contains: list[str] | None,
    match_mode: str,
) -> bool:
    if not role_filter_enabled:
        return True

    title_terms = _normalize_filter_terms(title_contains)
    description_terms = _normalize_filter_terms(description_contains)
    all_terms = sorted(set(title_terms + description_terms))
    if not all_terms:
        return True

    normalized_title = _normalize_text(title)
    normalized_description = _normalize_text(description_text)
    matches = [term in normalized_title or term in normalized_description for term in all_terms]

    if (match_mode or "any").lower() == "all":
        return all(matches)
    return any(matches)


def _fetch_html(url: str, timeout_seconds: int, max_retries: int) -> str:
    attempt = 0
    last_error: Exception | None = None
    while attempt <= max_retries:
        try:
            request = Request(url, headers={"User-Agent": "JobSearchAssistant/0.1"})
            with urlopen(request, timeout=timeout_seconds) as response:
                content_type = response.headers.get("Content-Type", "")
                if "text/html" not in content_type.lower() and "application/xhtml+xml" not in content_type.lower():
                    return ""
                return response.read().decode("utf-8", errors="ignore")
        except Exception as exc:
            last_error = exc
            attempt += 1

    raise RuntimeError(f"Failed to fetch {url}: {last_error}")


def ingest_company_careers_page(
    conn: sqlite3.Connection,
    company_id: int,
    company_name: str,
    careers_url: str,
    timeout_seconds: int,
    max_retries: int,
    role_filter_enabled: bool = False,
    role_filter_title_contains: list[str] | None = None,
    role_filter_description_contains: list[str] | None = None,
    role_filter_match_mode: str = "any",
) -> tuple[int, int, int, int, list[str]]:
    postings_new = 0
    postings_updated = 0
    postings_skipped = 0
    postings_filtered_out = 0
    errors: list[str] = []

    # Pre-flight: reject single-posting URLs with a clear message
    if _looks_like_single_posting_url(careers_url):
        errors.append(
            f"{company_name}: careers_url appears to be a single job posting, not a careers search page. "
            f"Please update the company's Careers URL to point to their job listings/search page."
        )
        conn.execute(
            "UPDATE companies SET last_checked_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
            (company_id,),
        )
        return postings_new, postings_updated, postings_skipped, postings_filtered_out, errors

    if not careers_url or not careers_url.startswith("http"):
        errors.append(
            f"{company_name}: No valid careers URL configured. "
            f"Please set a careers search page URL for this company."
        )
        return postings_new, postings_updated, postings_skipped, postings_filtered_out, errors

    try:
        html = _fetch_html(careers_url, timeout_seconds=timeout_seconds, max_retries=max_retries)
    except Exception as exc:
        errors.append(f"{company_name}: {exc}")
        conn.execute(
            "UPDATE companies SET last_checked_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
            (company_id,),
        )
        return postings_new, postings_updated, postings_skipped, postings_filtered_out, errors

    parser = LinkExtractor()
    parser.feed(html)

    for link in parser.links:
        href = (link.get("href") or "").strip()
        text = (link.get("text") or "").strip()
        if not href:
            postings_skipped += 1
            continue

        absolute_url = urljoin(careers_url, href)
        if not absolute_url.startswith("http"):
            postings_skipped += 1
            continue

        if not _looks_like_job_link(text, absolute_url):
            postings_skipped += 1
            continue

        # Only keep links on the same domain as the careers page
        if not _is_same_domain(careers_url, absolute_url):
            postings_skipped += 1
            continue

        title = text if text else "Untitled role"
        location = "unknown"
        canonical_url = _canonicalize_url(absolute_url)
        description_text = text if text else f"Job link from {company_name} careers page"

        if not _matches_role_filters(
            title=title,
            description_text=description_text,
            role_filter_enabled=role_filter_enabled,
            title_contains=role_filter_title_contains,
            description_contains=role_filter_description_contains,
            match_mode=role_filter_match_mode,
        ):
            postings_filtered_out += 1
            continue

        fingerprint = _fingerprint(company_id, canonical_url, title, location)

        existing = conn.execute(
            "SELECT id FROM job_postings WHERE fingerprint = ?",
            (fingerprint,),
        ).fetchone()

        if existing:
            conn.execute(
                """
                UPDATE job_postings
                SET last_seen_at = datetime('now'), status = 'active', parser_confidence = 0.5,
                    parser_quality_flag = 'partial', description_text = ?
                WHERE id = ?
                """,
                (description_text, existing[0]),
            )
            postings_updated += 1
        else:
            conn.execute(
                """
                INSERT INTO job_postings (
                  company_id, title, location, posted_date, canonical_url, source_url,
                  description_text, fingerprint, parser_confidence, parser_quality_flag, status
                )
                VALUES (?, ?, ?, NULL, ?, ?, ?, ?, 0.5, 'partial', 'active')
                """,
                (
                    company_id,
                    title,
                    location,
                    canonical_url,
                    careers_url,
                    description_text,
                    fingerprint,
                ),
            )
            postings_new += 1

    conn.execute(
        "UPDATE companies SET last_checked_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
        (company_id,),
    )

    return postings_new, postings_updated, postings_skipped, postings_filtered_out, errors
