from pydantic import BaseModel


class FetchRunRead(BaseModel):
    id: int
    started_at: str
    completed_at: str | None
    status: str
    companies_checked: int
    postings_new: int
    postings_updated: int
    postings_skipped: int
    postings_filtered_out: int
    errors_json: str


class FetchRunListResponse(BaseModel):
    items: list[FetchRunRead]
    count: int


def map_fetch_run_row(row: tuple) -> FetchRunRead:
    return FetchRunRead(
        id=row[0],
        started_at=row[1],
        completed_at=row[2],
        status=row[3],
        companies_checked=row[4],
        postings_new=row[5],
        postings_updated=row[6],
        postings_skipped=row[7],
        postings_filtered_out=row[8],
        errors_json=row[9],
    )
