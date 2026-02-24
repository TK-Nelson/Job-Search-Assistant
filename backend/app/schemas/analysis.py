from pydantic import BaseModel


class AnalysisRunRequest(BaseModel):
    resume_version_id: int
    job_posting_id: int


class AnalysisSubScores(BaseModel):
    ats_searchability: float
    hard_skills: float
    soft_skills: float


class AnalysisKeywords(BaseModel):
    hard: list[str]
    soft: list[str]


class AnalysisEvidenceItem(BaseModel):
    category: str
    keyword: str
    resume_snippet: str
    job_snippet: str


class AnalysisRunResponse(BaseModel):
    analysis_run_id: int
    overall_score: float
    sub_scores: AnalysisSubScores
    weights: dict[str, float]
    matched_keywords: AnalysisKeywords
    missing_keywords: AnalysisKeywords
    evidence: list[AnalysisEvidenceItem]
    confidence: float
    parser_quality_flag: str


class AnalysisRunHistoryItem(BaseModel):
    id: int
    resume_version_id: int
    job_posting_id: int
    overall_score: float
    ats_score: float
    hard_skills_score: float
    soft_skills_score: float
    parser_quality_flag: str
    confidence: float
    created_at: str


class AnalysisRunHistoryResponse(BaseModel):
    items: list[AnalysisRunHistoryItem]
    count: int
