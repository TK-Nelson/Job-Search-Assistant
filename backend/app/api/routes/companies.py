from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, Query

from app.db.database import get_connection
from app.schemas.company import CompanyCreate, CompanyListResponse, CompanyRead, CompanyUpdate, map_company_row

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
    _validate_url(payload.careers_url)

    try:
        with get_connection() as conn:
            conn.execute(
                """
                INSERT INTO companies (name, careers_url, followed, notes)
                VALUES (?, ?, ?, ?)
                """,
                (payload.name.strip(), payload.careers_url.strip(), int(payload.followed), payload.notes),
            )
            conn.commit()
            row = conn.execute(
                """
                SELECT id, name, careers_url, followed, notes, last_checked_at, created_at, updated_at
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
    SELECT id, name, careers_url, followed, notes, last_checked_at, created_at, updated_at
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
    _validate_url(payload.careers_url)

    with get_connection() as conn:
        current = conn.execute("SELECT id FROM companies WHERE id = ?", (company_id,)).fetchone()
        if not current:
            raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Company not found."})

        try:
            conn.execute(
                """
                UPDATE companies
                SET name = ?, careers_url = ?, followed = ?, notes = ?, updated_at = datetime('now')
                WHERE id = ?
                """,
                (
                    payload.name.strip(),
                    payload.careers_url.strip(),
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
            SELECT id, name, careers_url, followed, notes, last_checked_at, created_at, updated_at
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
