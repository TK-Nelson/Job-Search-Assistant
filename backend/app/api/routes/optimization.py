from fastapi import APIRouter

from app.schemas.optimization import (
    CoverLetterPromptRequest,
    CoverLetterPromptResponse,
    OptimizationRunRequest,
    OptimizationRunResponse,
)
from app.services.optimization import build_cover_letter_prompt, run_optimization

router = APIRouter()


@router.post("/optimization/run", response_model=OptimizationRunResponse)
def run_optimization_endpoint(payload: OptimizationRunRequest) -> OptimizationRunResponse:
    result = run_optimization(payload.resume_version_id, payload.job_posting_id)
    return OptimizationRunResponse(**result)


@router.post("/cover-letter/prompt", response_model=CoverLetterPromptResponse)
def build_cover_letter_prompt_endpoint(payload: CoverLetterPromptRequest) -> CoverLetterPromptResponse:
    result = build_cover_letter_prompt(
        payload.resume_version_id,
        payload.job_posting_id,
        payload.tone,
        payload.target_length_words,
    )
    return CoverLetterPromptResponse(**result)
