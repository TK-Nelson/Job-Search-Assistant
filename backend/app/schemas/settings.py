from pydantic import BaseModel, Field, model_validator


class DatabaseConfig(BaseModel):
    path: str


class StorageConfig(BaseModel):
    artifacts_dir: str
    backups_dir: str
    encrypt_artifacts: bool = True


class ResumeConfig(BaseModel):
    allowed_extensions: list[str] = Field(default_factory=lambda: [".docx"])
    max_size_mb: int = 2


class FetchRoleFiltersConfig(BaseModel):
    enabled: bool = False
    title_contains: list[str] = Field(default_factory=list)
    description_contains: list[str] = Field(default_factory=list)
    match_mode: str = "any"


class FetchConfig(BaseModel):
    interval_minutes: int = 120
    max_workers: int = 2
    timeout_seconds: int = 20
    max_retries: int = 3
    backoff_seconds: list[int] = Field(default_factory=lambda: [1, 3, 8])
    role_filters: FetchRoleFiltersConfig = Field(default_factory=FetchRoleFiltersConfig)


class ScoringWeights(BaseModel):
    """Legacy — retained for backward compatibility with existing settings files."""
    ats_searchability: float = 0.35
    hard_skills: float = 0.45
    soft_skills: float = 0.20


class ScoringConfig(BaseModel):
    """Legacy — retained for backward compatibility with existing settings files."""
    weights: ScoringWeights = Field(default_factory=ScoringWeights)
    minimum_confidence_for_strong_recommendation: float = 0.7


class RetentionConfig(BaseModel):
    job_postings_days: int = 180
    logs_days: int = 30


class AppConfig(BaseModel):
    environment: str = "local"
    runtime_data_root: str
    database: DatabaseConfig
    storage: StorageConfig
    resume: ResumeConfig
    fetch: FetchConfig
    scoring: ScoringConfig = Field(default_factory=ScoringConfig)
    retention: RetentionConfig

    @model_validator(mode="after")
    def validate_rules(self) -> "AppConfig":
        allowed = [ext.lower() for ext in self.resume.allowed_extensions]
        if allowed != [".docx"]:
            raise ValueError("resume.allowed_extensions must be ['.docx'] in v1")

        if self.fetch.max_workers < 1 or self.fetch.max_workers > 3:
            raise ValueError("fetch.max_workers must be between 1 and 3")

        if self.fetch.role_filters.match_mode not in {"any", "all"}:
            raise ValueError("fetch.role_filters.match_mode must be one of 'any' or 'all'")

        self.fetch.role_filters.title_contains = [
            item.strip() for item in self.fetch.role_filters.title_contains if item and item.strip()
        ]
        self.fetch.role_filters.description_contains = [
            item.strip() for item in self.fetch.role_filters.description_contains if item and item.strip()
        ]

        return self


class PathValidationRequest(BaseModel):
    runtime_data_root: str
    database_path: str
    artifacts_dir: str
    backups_dir: str


class PathValidationResult(BaseModel):
    valid: bool
    warnings: list[str]
    errors: list[str]
