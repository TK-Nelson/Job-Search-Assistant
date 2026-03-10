from pydantic import BaseModel, Field


class FetchRoutineCreate(BaseModel):
    title_keywords: list[str] = Field(default_factory=list)
    description_keywords: list[str] = Field(default_factory=list)
    keyword_match_mode: str = "any"
    max_role_age_days: int = 14
    frequency_minutes: int = 720
    company_ids: list[int] = Field(default_factory=list)
    use_followed_companies: bool = True


class FetchRoutineUpdate(BaseModel):
    title_keywords: list[str] | None = None
    description_keywords: list[str] | None = None
    keyword_match_mode: str | None = None
    max_role_age_days: int | None = None
    frequency_minutes: int | None = None
    company_ids: list[int] | None = None
    use_followed_companies: bool | None = None
    enabled: bool | None = None


class FetchRoutineRead(BaseModel):
    id: int
    title_keywords: list[str]
    description_keywords: list[str]
    keyword_match_mode: str
    max_role_age_days: int
    frequency_minutes: int
    company_ids: list[int]
    use_followed_companies: bool
    enabled: bool
    last_run_at: str | None
    created_at: str
    updated_at: str


class FetchedRoleRead(BaseModel):
    id: int
    company_id: int
    company_name: str
    company_logo_url: str | None
    title: str
    location: str | None
    posted_date: str | None
    canonical_url: str
    first_seen_at: str
    last_seen_at: str
    status: str
    salary_range: str | None
    seniority_level: str | None
    workplace_type: str | None
    commitment_type: str | None
    archived_at: str | None = None


class FetchedRolesResponse(BaseModel):
    items: list[FetchedRoleRead]
    total: int
    new_count: int  # roles first seen in latest fetch run
