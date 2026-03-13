"""
Job portal adapters – base class and data model.

Each supported ATS / career-portal platform has a concrete adapter that
knows how to call the platform's API (or scrape its search page) and return
a uniform list of ``JobResult`` objects.
"""

from __future__ import annotations

import dataclasses
from abc import ABC, abstractmethod


@dataclasses.dataclass(frozen=True, slots=True)
class JobResult:
    """One job listing returned by a portal adapter."""

    title: str
    location: str
    url: str  # canonical / absolute URL to the posting
    posted_date: str | None  # ISO-ish string or None
    description_text: str  # short description or title echo


class BaseAdapter(ABC):
    """Interface every portal adapter must implement."""

    @staticmethod
    def _build_query(keywords: list[str]) -> str:
        """
        Build a single search string from *keywords*.

        Most job-portal APIs work best with a short, focused query.
        We pick the shortest unique keyword that is likely a broad
        role family (e.g. "UX" rather than "Senior UX Designer") to
        maximise recall.  The caller applies a second, stricter filter
        on the results.
        """
        if not keywords:
            return ""
        # De-dup; prefer the shortest term (broadest recall)
        unique = sorted(set(k.strip() for k in keywords if k.strip()), key=len)
        # Use at most the 3 shortest terms
        return " ".join(unique[:3])

    @abstractmethod
    def search(
        self,
        search_url: str,
        keywords: list[str],
        limit: int = 20,
    ) -> list[JobResult]:
        """
        Hit the portal and return up to *limit* jobs matching *keywords*.

        Parameters
        ----------
        search_url : str
            Platform-specific base URL (API endpoint, board slug, …).
        keywords : list[str]
            Search terms from the fetch routine.
        limit : int
            Maximum results to request.
        """
        ...
