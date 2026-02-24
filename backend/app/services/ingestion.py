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


def _looks_like_job_link(link_text: str, href: str) -> bool:
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
