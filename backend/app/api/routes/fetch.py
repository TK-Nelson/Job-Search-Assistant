from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from app.db.database import get_connection
from app.schemas.fetch import FetchRunListResponse, FetchRunRead
from app.services.adapters.registry import SUPPORTED_PORTAL_TYPES
from app.services.fetch_runs import get_fetch_run, list_fetch_runs, start_and_complete_fetch_run

router = APIRouter()


# ── Preflight ─────────────────────────────────────────────────────

class PreflightCompany(BaseModel):
    id: int
    name: str
    careers_url: str | None
    portal_type: str | None
    search_url: str | None
    ready: bool  # True = adapter + search_url configured


class PreflightResponse(BaseModel):
    ready: list[PreflightCompany]
    needs_input: list[PreflightCompany]


@router.get("/fetch/preflight", response_model=PreflightResponse)
def fetch_preflight() -> PreflightResponse:
    """
    Return the list of companies that will be fetched, grouped into
    *ready* (adapter configured) and *needs_input* (user must provide
    search URL or skip).
    """
    import json

    with get_connection() as conn:
        # Load routine to know which companies are in scope
        routine_row = conn.execute(
            "SELECT company_ids_json, use_followed_companies FROM fetch_routines ORDER BY id LIMIT 1"
        ).fetchone()

        if routine_row:
            company_ids = set(json.loads(routine_row[0] or "[]"))
            use_followed = bool(routine_row[1])
        else:
            company_ids = set()
            use_followed = True

        # Build list of target companies
        if use_followed and company_ids:
            placeholders = ",".join("?" for _ in company_ids)
            rows = conn.execute(
                f"SELECT id, name, careers_url, portal_type, search_url FROM companies "
                f"WHERE followed = 1 OR id IN ({placeholders}) ORDER BY name ASC",
                list(company_ids),
            ).fetchall()
        elif use_followed:
            rows = conn.execute(
                "SELECT id, name, careers_url, portal_type, search_url FROM companies "
                "WHERE followed = 1 ORDER BY name ASC"
            ).fetchall()
        elif company_ids:
            placeholders = ",".join("?" for _ in company_ids)
            rows = conn.execute(
                f"SELECT id, name, careers_url, portal_type, search_url FROM companies "
                f"WHERE id IN ({placeholders}) ORDER BY name ASC",
                list(company_ids),
            ).fetchall()
        else:
            rows = []

    ready: list[PreflightCompany] = []
    needs_input: list[PreflightCompany] = []

    for cid, name, careers_url, portal_type, search_url in rows:
        is_ready = bool(portal_type and portal_type in SUPPORTED_PORTAL_TYPES and search_url)
        company = PreflightCompany(
            id=cid,
            name=name,
            careers_url=careers_url,
            portal_type=portal_type,
            search_url=search_url,
            ready=is_ready,
        )
        if is_ready:
            ready.append(company)
        else:
            needs_input.append(company)

    return PreflightResponse(ready=ready, needs_input=needs_input)


# ── Save search URLs from preflight modal ─────────────────────────

class SearchUrlUpdate(BaseModel):
    company_id: int
    search_url: str


class SaveSearchUrlsBody(BaseModel):
    updates: list[SearchUrlUpdate]


@router.post("/fetch/save-search-urls")
def save_search_urls(body: SaveSearchUrlsBody) -> dict:
    """
    Bulk-save search_url (and auto-detect portal_type) for companies
    configured via the preflight modal.
    """
    from app.services.adapters.registry import derive_search_url, detect_portal_type

    updated = 0
    with get_connection() as conn:
        for item in body.updates:
            url = item.search_url.strip()
            if not url:
                continue
            portal_type = detect_portal_type(url)
            # If auto-detect fails, try deriving from the company's existing portal_type
            if not portal_type:
                row = conn.execute(
                    "SELECT portal_type FROM companies WHERE id = ?", (item.company_id,)
                ).fetchone()
                portal_type = row[0] if row else None

            conn.execute(
                "UPDATE companies SET search_url = ?, portal_type = ?, updated_at = datetime('now') WHERE id = ?",
                (url, portal_type, item.company_id),
            )
            updated += 1
        conn.commit()
    return {"status": "ok", "updated": updated}


# ── Run fetch ─────────────────────────────────────────────────────


class RunFetchBody(BaseModel):
    exempt_company_ids: list[int] = Field(default_factory=list)


@router.post("/fetch/run-now", response_model=FetchRunRead)
def run_fetch_now(body: RunFetchBody | None = None) -> FetchRunRead:
    exempt_ids = set(body.exempt_company_ids) if body and body.exempt_company_ids else set()
    return start_and_complete_fetch_run(exempt_company_ids=exempt_ids)


@router.get("/fetch/runs", response_model=FetchRunListResponse)
def get_fetch_runs(limit: int = Query(default=20, ge=1, le=100)) -> FetchRunListResponse:
    items = list_fetch_runs(limit)
    return FetchRunListResponse(items=items, count=len(items))


@router.get("/fetch/runs/{run_id}", response_model=FetchRunRead)
def get_fetch_run_by_id(run_id: int) -> FetchRunRead:
    return get_fetch_run(run_id)


# ── Test fetch for a single company ──────────────────────────────

class TestFetchResult(BaseModel):
    company_id: int
    company_name: str
    portal_type: str | None
    search_url: str | None
    postings_found: int
    errors: list[str]


@router.post("/fetch/test-company/{company_id}", response_model=TestFetchResult)
def test_fetch_company(company_id: int) -> TestFetchResult:
    """Perform a quick test fetch for a single company without persisting results."""
    import json as _json
    from app.services.adapters.registry import get_adapter

    with get_connection() as conn:
        row = conn.execute(
            "SELECT id, name, careers_url, portal_type, search_url FROM companies WHERE id = ?",
            (company_id,),
        ).fetchone()
        if not row:
            from fastapi import HTTPException as _H
            raise _H(status_code=404, detail={"code": "NOT_FOUND", "message": "Company not found."})

        _cid, name, _careers_url, portal_type, search_url = row

        if not portal_type or not search_url:
            return TestFetchResult(
                company_id=company_id,
                company_name=name,
                portal_type=portal_type,
                search_url=search_url,
                postings_found=0,
                errors=[f"{name}: No supported portal configured. Set a portal type and search URL first."],
            )

        adapter = get_adapter(portal_type)
        if adapter is None:
            return TestFetchResult(
                company_id=company_id,
                company_name=name,
                portal_type=portal_type,
                search_url=search_url,
                postings_found=0,
                errors=[f"{name}: Unsupported portal type '{portal_type}'."],
            )

        try:
            results = adapter.search(search_url, keywords=[""], limit=10)
            return TestFetchResult(
                company_id=company_id,
                company_name=name,
                portal_type=portal_type,
                search_url=search_url,
                postings_found=len(results),
                errors=[],
            )
        except Exception as exc:
            return TestFetchResult(
                company_id=company_id,
                company_name=name,
                portal_type=portal_type,
                search_url=search_url,
                postings_found=0,
                errors=[f"{name}: {exc}"],
            )
