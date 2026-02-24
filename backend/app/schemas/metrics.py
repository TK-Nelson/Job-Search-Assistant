from pydantic import BaseModel


class EndpointMetric(BaseModel):
    endpoint: str
    samples: int
    p50_ms: float
    p95_ms: float
    budget_ms: float | None = None
    over_budget: bool


class MetricsSummaryResponse(BaseModel):
    endpoints: list[EndpointMetric]
    warnings: list[str]
    tracked_budgets: dict[str, float]
