from pydantic import BaseModel


class OptimizationRunRequest(BaseModel):
    resume_version_id: int
    job_posting_id: int


class OptimizationRunResponse(BaseModel):
    source_resume_version_id: int
    output_resume_version_id: int
    output_file_path: str
    deterministic_name: str
    suggestion_summary: dict


class CoverLetterPromptRequest(BaseModel):
    resume_version_id: int
    job_posting_id: int
    tone: str = "professional"
    target_length_words: int = 300


class CoverLetterPromptResponse(BaseModel):
    prompt: str
    metadata: dict
