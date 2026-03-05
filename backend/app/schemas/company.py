from datetime import datetime

from pydantic import BaseModel, Field


class CompanyBase(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    careers_url: str | None = Field(default=None, max_length=1000)
    industry: str | None = Field(default=None, max_length=200)
    logo_url: str | None = Field(default=None, max_length=2000)
    notes: str | None = None
    followed: bool = True


class CompanyCreate(CompanyBase):
    pass


class CompanyUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    careers_url: str | None = Field(default=None, max_length=1000)
    industry: str | None = Field(default=None, max_length=200)
    logo_url: str | None = Field(default=None, max_length=2000)
    notes: str | None = None
    followed: bool = True


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
        industry=row[3],
        logo_url=row[4],
        followed=bool(row[5]),
        notes=row[6],
        last_checked_at=row[7],
        created_at=row[8],
        updated_at=row[9],
    )
