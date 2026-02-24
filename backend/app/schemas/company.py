from datetime import datetime

from pydantic import BaseModel, Field


class CompanyBase(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    careers_url: str = Field(min_length=5, max_length=1000)
    notes: str | None = None
    followed: bool = True


class CompanyCreate(CompanyBase):
    pass


class CompanyUpdate(CompanyBase):
    pass


class CompanyRead(CompanyBase):
    id: int
    last_checked_at: str | None = None
    created_at: str
    updated_at: str


class CompanyListResponse(BaseModel):
    items: list[CompanyRead]
    count: int


def map_company_row(row: tuple) -> CompanyRead:
    return CompanyRead(
        id=row[0],
        name=row[1],
        careers_url=row[2],
        followed=bool(row[3]),
        notes=row[4],
        last_checked_at=row[5],
        created_at=row[6],
        updated_at=row[7],
    )
