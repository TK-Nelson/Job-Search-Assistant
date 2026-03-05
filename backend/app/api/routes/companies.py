import os
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, Query

from app.db.database import get_connection
from app.schemas.company import CompanyCreate, CompanyListResponse, CompanyRead, CompanyUpdate, map_company_row

LOGO_DEV_TOKEN = os.environ.get("LOGO_DEV_TOKEN", "")

router = APIRouter()


def _validate_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "VALIDATION_ERROR",
                "message": "careers_url must be a valid http/https URL",
                "details": {"field": "careers_url"},
            },
        )


@router.post("/companies", response_model=CompanyRead)
def create_company(payload: CompanyCreate) -> CompanyRead:
    effective_url = (payload.careers_url or "").strip()
    if effective_url:
        _validate_url(effective_url)

    try:
        with get_connection() as conn:
            conn.execute(
                """
                INSERT INTO companies (name, careers_url, industry, logo_url, followed, notes)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (payload.name.strip(), effective_url, payload.industry, payload.logo_url, int(payload.followed), payload.notes),
            )
            conn.commit()
            row = conn.execute(
                """
                SELECT id, name, careers_url, industry, logo_url, followed, notes, last_checked_at, created_at, updated_at
                FROM companies
                WHERE id = last_insert_rowid()
                """
            ).fetchone()
    except Exception as exc:
        if "UNIQUE constraint failed" in str(exc):
            raise HTTPException(
                status_code=409,
                detail={"code": "CONFLICT", "message": "Company with this name and URL already exists."},
            )
        raise

    return map_company_row(row)


@router.get("/companies", response_model=CompanyListResponse)
def list_companies(followed: bool | None = Query(default=None)) -> CompanyListResponse:
    query = """
    SELECT id, name, careers_url, industry, logo_url, followed, notes, last_checked_at, created_at, updated_at
    FROM companies
    """
    params: tuple = ()

    if followed is not None:
        query += " WHERE followed = ?"
        params = (int(followed),)

    query += " ORDER BY name ASC"

    with get_connection() as conn:
        rows = conn.execute(query, params).fetchall()

    items = [map_company_row(row) for row in rows]
    return CompanyListResponse(items=items, count=len(items))


@router.put("/companies/{company_id}", response_model=CompanyRead)
def update_company(company_id: int, payload: CompanyUpdate) -> CompanyRead:
    effective_url = (payload.careers_url or "").strip()
    if effective_url:
        _validate_url(effective_url)

    with get_connection() as conn:
        current = conn.execute("SELECT id FROM companies WHERE id = ?", (company_id,)).fetchone()
        if not current:
            raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Company not found."})

        try:
            conn.execute(
                """
                UPDATE companies
                SET name = ?, careers_url = ?, industry = ?, logo_url = ?, followed = ?, notes = ?, updated_at = datetime('now')
                WHERE id = ?
                """,
                (
                    payload.name.strip(),
                    effective_url,
                    payload.industry,
                    payload.logo_url,
                    int(payload.followed),
                    payload.notes,
                    company_id,
                ),
            )
            conn.commit()
        except Exception as exc:
            if "UNIQUE constraint failed" in str(exc):
                raise HTTPException(
                    status_code=409,
                    detail={"code": "CONFLICT", "message": "Company with this name and URL already exists."},
                )
            raise

        row = conn.execute(
            """
            SELECT id, name, careers_url, industry, logo_url, followed, notes, last_checked_at, created_at, updated_at
            FROM companies
            WHERE id = ?
            """,
            (company_id,),
        ).fetchone()

    return map_company_row(row)


@router.delete("/companies/{company_id}")
def delete_company(company_id: int) -> dict[str, str]:
    with get_connection() as conn:
        deleted = conn.execute("DELETE FROM companies WHERE id = ?", (company_id,)).rowcount
        conn.commit()

    if not deleted:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Company not found."})

    return {"status": "deleted"}


def _extract_domain(url: str) -> str | None:
    """Extract the root domain from a URL (e.g. https://careers.nike.com/jobs -> nike.com)."""
    if not url:
        return None
    parsed = urlparse(url)
    host = parsed.netloc or parsed.path
    if not host:
        return None
    # Remove port
    host = host.split(":")[0]
    # Strip common subdomains
    parts = host.split(".")
    if len(parts) >= 2:
        domain = ".".join(parts[-2:])
    else:
        domain = host
    # If the domain is a third-party job board, it won't have the company's logo
    JOB_BOARD_DOMAINS = {
        "myworkdayjobs.com", "greenhouse.io", "lever.co", "smartrecruiters.com",
        "icims.com", "jobvite.com", "jazz.co", "bamboohr.com", "breezy.hr",
        "workable.com", "ashbyhq.com", "rippling.com", "paylocity.com",
        "dayforcehcm.com", "ultipro.com", "taleo.net", "successfactors.com",
    }
    if domain.lower() in JOB_BOARD_DOMAINS:
        return None
    return domain


def _resolve_logo_domain(company_name: str, careers_url: str) -> str:
    """Get the best domain for a company logo, falling back to name-based guess."""
    # Manual overrides for companies whose name doesn't match their domain
    DOMAIN_OVERRIDES = {
        "general motors": "gm.com",
        "capital one": "capitalone.com",
        "pnc bank": "pnc.com",
    }
    override = DOMAIN_OVERRIDES.get(company_name.strip().lower())
    if override:
        return override
    domain = _extract_domain(careers_url or "")
    if not domain:
        name_slug = company_name.strip().lower().replace(" ", "")
        domain = f"{name_slug}.com"
    return domain


def _build_logo_url(domain: str) -> str:
    return f"https://img.logo.dev/{domain}?token={LOGO_DEV_TOKEN}&size=64&format=png"


@router.post("/companies/{company_id}/refresh-logo", response_model=CompanyRead)
def refresh_company_logo(company_id: int) -> CompanyRead:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT id, name, careers_url, industry, logo_url, followed, notes, last_checked_at, created_at, updated_at FROM companies WHERE id = ?",
            (company_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Company not found."})

        company = map_company_row(row)
        domain = _resolve_logo_domain(company.name, company.careers_url or "")

        logo_url = _build_logo_url(domain)
        conn.execute(
            "UPDATE companies SET logo_url = ?, updated_at = datetime('now') WHERE id = ?",
            (logo_url, company_id),
        )
        conn.commit()
        updated_row = conn.execute(
            "SELECT id, name, careers_url, industry, logo_url, followed, notes, last_checked_at, created_at, updated_at FROM companies WHERE id = ?",
            (company_id,),
        ).fetchone()
    return map_company_row(updated_row)


@router.post("/companies/refresh-all-logos")
def refresh_all_logos() -> dict:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT id, name, careers_url, industry, logo_url, followed, notes, last_checked_at, created_at, updated_at FROM companies"
        ).fetchall()
        count = 0
        for row in rows:
            company = map_company_row(row)
            domain = _resolve_logo_domain(company.name, company.careers_url or "")
            logo_url = _build_logo_url(domain)
            conn.execute(
                "UPDATE companies SET logo_url = ?, updated_at = datetime('now') WHERE id = ?",
                (logo_url, company.id),
            )
            count += 1
        conn.commit()
    return {"status": "ok", "updated": count}
