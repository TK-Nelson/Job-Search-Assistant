"""
Adapter-based ingestion – fetches job listings from company career portals
using platform-specific adapters (Amazon, Workday, Greenhouse, etc.).

Replaces the old HTML link-scraper approach that couldn't extract jobs
from JavaScript SPA career sites.
"""

import hashlib
import re
import sqlite3

from app.services.adapters import JobResult, get_adapter


# ── Helpers (carried over from old ingestion.py) ──────────────────

def _normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value.lower().strip())


def _canonicalize_url(url: str) -> str:
    from urllib.parse import urlparse

    parsed = urlparse(url)
    scheme = parsed.scheme.lower() if parsed.scheme else "https"
    netloc = parsed.netloc.lower()
    path = parsed.path or "/"
    return f"{scheme}://{netloc}{path}".rstrip("/")


def _fingerprint(company_id: int, canonical_url: str, title: str, location: str) -> str:
    seed = f"{company_id}|{_normalize_text(canonical_url)}|{_normalize_text(title)}|{_normalize_text(location)}"
    return hashlib.sha256(seed.encode("utf-8")).hexdigest()


def _normalize_filter_terms(values: list[str] | None) -> list[str]:
    terms = [_normalize_text(v) for v in (values or [])]
    return [t for t in terms if t]


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


# ── Main ingestion function ──────────────────────────────────────

def ingest_company_via_adapter(
    conn: sqlite3.Connection,
    company_id: int,
    company_name: str,
    portal_type: str,
    search_url: str,
    keywords: list[str],
    limit: int = 50,
    role_filter_enabled: bool = False,
    role_filter_title_contains: list[str] | None = None,
    role_filter_description_contains: list[str] | None = None,
    role_filter_match_mode: str = "any",
) -> tuple[int, int, int, int, list[str], list[int]]:
    """
    Fetch job listings for one company using its portal adapter.

    Returns ``(new, updated, skipped, filtered_out, errors, new_posting_ids)``.
    """
    postings_new = 0
    postings_updated = 0
    postings_skipped = 0
    postings_filtered_out = 0
    errors: list[str] = []
    new_posting_ids: list[int] = []

    adapter = get_adapter(portal_type)
    if adapter is None:
        errors.append(
            f"{company_name}: Unsupported portal type '{portal_type}'. "
            f"Configure a search URL or skip this company."
        )
        return postings_new, postings_updated, postings_skipped, postings_filtered_out, errors, new_posting_ids

    if not search_url:
        errors.append(
            f"{company_name}: No search URL configured. "
            f"Please set a search URL for this company."
        )
        return postings_new, postings_updated, postings_skipped, postings_filtered_out, errors, new_posting_ids

    try:
        results: list[JobResult] = adapter.search(search_url, keywords, limit)
    except Exception as exc:
        errors.append(f"{company_name}: Adapter error – {exc}")
        conn.execute(
            "UPDATE companies SET last_checked_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
            (company_id,),
        )
        return postings_new, postings_updated, postings_skipped, postings_filtered_out, errors, new_posting_ids

    for job in results:
        if not job.url:
            postings_skipped += 1
            continue

        # Keyword filter (double-filter: adapter already searched, but
        # we re-check here to catch false positives from broad API matches)
        if not _matches_role_filters(
            title=job.title,
            description_text=job.description_text,
            role_filter_enabled=role_filter_enabled,
            title_contains=role_filter_title_contains,
            description_contains=role_filter_description_contains,
            match_mode=role_filter_match_mode,
        ):
            postings_filtered_out += 1
            continue

        canonical_url = _canonicalize_url(job.url)
        fingerprint = _fingerprint(company_id, canonical_url, job.title, job.location)

        existing = conn.execute(
            "SELECT id FROM job_postings WHERE fingerprint = ?",
            (fingerprint,),
        ).fetchone()

        if existing:
            conn.execute(
                """
                UPDATE job_postings
                SET last_seen_at = datetime('now'), status = 'active',
                    parser_confidence = 0.8, parser_quality_flag = 'ok',
                    description_text = ?, location = ?
                WHERE id = ?
                """,
                (job.description_text, job.location, existing[0]),
            )
            postings_updated += 1
        else:
            conn.execute(
                """
                INSERT INTO job_postings (
                  company_id, title, location, posted_date, canonical_url, source_url,
                  description_text, fingerprint, parser_confidence, parser_quality_flag,
                  status, source_kind
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0.8, 'ok', 'active', 'fetched')
                """,
                (
                    company_id,
                    job.title,
                    job.location,
                    job.posted_date,
                    canonical_url,
                    search_url,
                    job.description_text,
                    fingerprint,
                ),
            )
            new_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
            new_posting_ids.append(int(new_id))
            postings_new += 1

    conn.execute(
        "UPDATE companies SET last_checked_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
        (company_id,),
    )

    return postings_new, postings_updated, postings_skipped, postings_filtered_out, errors, new_posting_ids
