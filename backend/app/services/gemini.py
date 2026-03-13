"""Google Gemini API client with built-in rate limiting and token tracking."""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Gemini free-tier limits (as of 2025)
# ---------------------------------------------------------------------------
FREE_TIER_RPM = 15          # requests per minute
FREE_TIER_RPD = 1500        # requests per day
FREE_TIER_TPD = 1_000_000   # tokens per day (input + output combined)

WARN_RPD_RATIO = 0.80       # notify at 80 % of daily request budget
HARD_STOP_RPD_RATIO = 0.90  # stop at 90 %
WARN_TPD_RATIO = 0.80
HARD_STOP_TPD_RATIO = 0.90

MODEL_NAME = "gemini-2.0-flash"


# ---------------------------------------------------------------------------
# Rate-limiter
# ---------------------------------------------------------------------------
@dataclass
class _RateState:
    """Tracks daily and per-minute request / token counters."""

    day_key: str = ""
    requests_today: int = 0
    tokens_today: int = 0
    minute_timestamps: list[float] = field(default_factory=list)

    def _ensure_day(self) -> None:
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        if self.day_key != today:
            self.day_key = today
            self.requests_today = 0
            self.tokens_today = 0

    def _prune_minute(self) -> None:
        cutoff = time.time() - 60.0
        self.minute_timestamps = [t for t in self.minute_timestamps if t > cutoff]

    # -- queries --
    def can_send(self) -> tuple[bool, str | None]:
        """Return (allowed, reason_if_blocked)."""
        self._ensure_day()
        self._prune_minute()

        if self.requests_today >= int(FREE_TIER_RPD * HARD_STOP_RPD_RATIO):
            return False, f"Daily request limit approaching ({self.requests_today}/{FREE_TIER_RPD}). Pausing Gemini calls until tomorrow."
        if self.tokens_today >= int(FREE_TIER_TPD * HARD_STOP_TPD_RATIO):
            return False, f"Daily token limit approaching ({self.tokens_today}/{FREE_TIER_TPD}). Pausing Gemini calls until tomorrow."
        if len(self.minute_timestamps) >= FREE_TIER_RPM:
            return False, "Per-minute rate limit reached. Will retry shortly."
        return True, None

    def should_warn(self) -> str | None:
        """Return a warning string if approaching limits, else None."""
        self._ensure_day()
        if self.requests_today >= int(FREE_TIER_RPD * WARN_RPD_RATIO):
            return f"Gemini daily request usage is at {self.requests_today}/{FREE_TIER_RPD} ({round(self.requests_today / FREE_TIER_RPD * 100)}%)."
        if self.tokens_today >= int(FREE_TIER_TPD * WARN_TPD_RATIO):
            return f"Gemini daily token usage is at {self.tokens_today}/{FREE_TIER_TPD} ({round(self.tokens_today / FREE_TIER_TPD * 100)}%)."
        return None

    # -- mutations --
    def record(self, token_count: int) -> None:
        self._ensure_day()
        self.requests_today += 1
        self.tokens_today += token_count
        self.minute_timestamps.append(time.time())

    def usage_summary(self) -> dict:
        self._ensure_day()
        self._prune_minute()
        return {
            "requests_today": self.requests_today,
            "requests_limit": FREE_TIER_RPD,
            "tokens_today": self.tokens_today,
            "tokens_limit": FREE_TIER_TPD,
            "requests_this_minute": len(self.minute_timestamps),
            "rpm_limit": FREE_TIER_RPM,
        }


_rate = _RateState()


def get_rate_state() -> _RateState:
    return _rate


# ---------------------------------------------------------------------------
# Gemini client
# ---------------------------------------------------------------------------
_client = None


def _get_client():
    """Lazy-init the Gemini GenerativeModel."""
    global _client
    if _client is not None:
        return _client

    from app.core.secret_store import get_secret

    api_key = get_secret("gemini_api_key")
    if not api_key:
        raise RuntimeError(
            "Gemini API key not configured. Go to Settings → Gemini API Key to set it."
        )

    import google.generativeai as genai

    genai.configure(api_key=api_key)
    _client = genai.GenerativeModel(
        MODEL_NAME,
        generation_config=genai.GenerationConfig(
            response_mime_type="application/json",
            temperature=0.2,
        ),
    )
    return _client


def reset_client() -> None:
    """Force re-init on next call (e.g. after API key change)."""
    global _client
    _client = None


def gemini_available() -> bool:
    """Check if a Gemini API key is configured."""
    from app.core.secret_store import get_secret

    return bool(get_secret("gemini_api_key"))


# ---------------------------------------------------------------------------
# Core call
# ---------------------------------------------------------------------------
MAX_RETRIES = 2
RETRY_BACKOFF = [2, 5]


def call_gemini(prompt: str) -> dict:
    """
    Send *prompt* to Gemini and return the parsed JSON dict.

    Raises RuntimeError if the API key is missing or the call fails after
    retries.  Automatically handles per-minute back-off.
    """
    state = get_rate_state()

    allowed, reason = state.can_send()
    if not allowed:
        raise RateLimitExceeded(reason or "Rate limit reached")

    model = _get_client()
    last_exc: Exception | None = None

    for attempt in range(1 + MAX_RETRIES):
        try:
            response = model.generate_content(prompt)

            # Estimate tokens (Gemini returns usage metadata when available)
            usage = getattr(response, "usage_metadata", None)
            if usage:
                total_tokens = (getattr(usage, "prompt_token_count", 0) or 0) + (
                    getattr(usage, "candidates_token_count", 0) or 0
                )
            else:
                # Rough fallback: ~4 chars per token
                total_tokens = (len(prompt) + len(response.text or "")) // 4

            state.record(total_tokens)

            text = response.text or ""
            return _extract_json(text)
        except RateLimitExceeded:
            raise
        except Exception as exc:
            # Detect 429 / quota-exceeded from the Gemini SDK and surface
            # immediately as RateLimitExceeded instead of burning retries.
            exc_str = str(exc)
            exc_code = getattr(exc, "code", None) or getattr(exc, "status_code", None)
            is_rate_limit = (
                exc_code == 429
                or "429" in exc_str[:80]
                or "quota" in exc_str.lower()[:200]
                or "rate" in exc_str.lower()[:120] and "limit" in exc_str.lower()[:200]
                or "RESOURCE_EXHAUSTED" in exc_str[:200]
            )
            if is_rate_limit:
                logger.warning("Gemini quota/rate-limit hit: %s", exc_str[:300])
                raise RateLimitExceeded(
                    f"Gemini API quota exceeded. Check your plan and billing at https://ai.google.dev/gemini-api/docs/rate-limits — {exc_str[:300]}"
                )

            last_exc = exc
            logger.warning("Gemini attempt %d failed: %s", attempt + 1, exc)
            if attempt < MAX_RETRIES:
                time.sleep(RETRY_BACKOFF[min(attempt, len(RETRY_BACKOFF) - 1)])

    raise RuntimeError(f"Gemini call failed after {1 + MAX_RETRIES} attempts: {last_exc}")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
class RateLimitExceeded(Exception):
    pass


def _extract_json(text: str) -> dict:
    """Parse JSON from Gemini response, handling markdown fences."""
    import re

    candidate = text.strip()
    if candidate.startswith("```"):
        candidate = re.sub(r"^```(?:json)?", "", candidate).strip()
        candidate = re.sub(r"```$", "", candidate).strip()

    try:
        return json.loads(candidate)
    except Exception:
        pass

    match = re.search(r"\{[\s\S]*\}", candidate)
    if not match:
        raise ValueError("No JSON object found in Gemini response")
    return json.loads(match.group(0))
