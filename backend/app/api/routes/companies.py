import os
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, Query

from app.core.logo import build_logo_url, extract_domain, resolve_logo_domain
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
    effective_url = (payload.careers_url or "").strip() if "careers_url" in payload.model_fields_set else None
    if effective_url:
        _validate_url(effective_url)

    with get_connection() as conn:
        current = conn.execute(
            "SELECT id, name, careers_url, industry, logo_url, followed, notes FROM companies WHERE id = ?",
            (company_id,),
        ).fetchone()
        if not current:
            raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Company not found."})

        # Build SET clause dynamically – only update fields the caller actually sent.
        # This prevents accidental nulling of logo_url, careers_url, etc.
        sent = payload.model_fields_set
        set_clauses: list[str] = []
        params: list = []

        if "name" in sent:
            set_clauses.append("name = ?")
            params.append(payload.name.strip())
        if "careers_url" in sent:
            set_clauses.append("careers_url = ?")
            params.append(effective_url)
        if "industry" in sent:
            set_clauses.append("industry = ?")
            params.append(payload.industry)
        if "logo_url" in sent:
            set_clauses.append("logo_url = ?")
            params.append(payload.logo_url)
        if "followed" in sent:
            set_clauses.append("followed = ?")
            params.append(int(payload.followed))
        if "notes" in sent:
            set_clauses.append("notes = ?")
            params.append(payload.notes)

        if not set_clauses:
            # Nothing to change – just return current state
            row = conn.execute(
                "SELECT id, name, careers_url, industry, logo_url, followed, notes, last_checked_at, created_at, updated_at FROM companies WHERE id = ?",
                (company_id,),
            ).fetchone()
            return map_company_row(row)

        set_clauses.append("updated_at = datetime('now')")
        params.append(company_id)

        try:
            conn.execute(
                f"UPDATE companies SET {', '.join(set_clauses)} WHERE id = ?",
                tuple(params),
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
        logo_url = build_logo_url(company.name, company.careers_url or "")
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
            logo_url = build_logo_url(company.name, company.careers_url or "")
            conn.execute(
                "UPDATE companies SET logo_url = ?, updated_at = datetime('now') WHERE id = ?",
                (logo_url, company.id),
            )
            count += 1
        conn.commit()
    return {"status": "ok", "updated": count}
