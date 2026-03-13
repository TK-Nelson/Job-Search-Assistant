import json
import logging
import os
import re
import sqlite3
from pathlib import Path

from fastapi import HTTPException

from app.db.database import get_connection
from app.core.config import app_settings
from app.schemas.analysis import (
    AnalysisEvidenceItem,
    AnalysisKeywords,
    AnalysisRunResponse,
    AnalysisSubScores,
)
from app.services.analysis import _safe_ratio, _tokens

logger = logging.getLogger(__name__)


LLM_OUTPUT_JSON_SCHEMA: dict = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "overall_fit_score",
        "overall_fit_justification",
        "strategic_evaluation",
        "gap_analysis",
        "hard_skill_evaluation",
        "soft_skill_evaluation",
        "positioning_risk_assessment",
        "suggested_updates",
    ],
    "properties": {
        "overall_fit_score": {"type": "number", "minimum": 1, "maximum": 100},
        "overall_fit_justification": {"type": "string"},
        "strategic_evaluation": {
            "type": "object",
            "additionalProperties": False,
            "required": ["seniority_fit", "positioning_fit", "domain_fit"],
            "properties": {
                "seniority_fit": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["rating", "reasoning"],
                    "properties": {
                        "rating": {"type": "string", "enum": ["Strong Fit", "Partial Fit", "No Fit"]},
                        "reasoning": {"type": "string"},
                    },
                },
                "positioning_fit": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["rating", "reasoning"],
                    "properties": {
                        "rating": {"type": "string", "enum": ["Strong Fit", "Partial Fit", "No Fit"]},
                        "reasoning": {"type": "string"},
                    },
                },
                "domain_fit": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["rating", "reasoning"],
                    "properties": {
                        "rating": {"type": "string", "enum": ["Strong Fit", "Partial Fit", "No Fit"]},
                        "reasoning": {"type": "string"},
                    },
                },
            },
        },
        "gap_analysis": {
            "type": "object",
            "additionalProperties": False,
            "required": ["summary", "requirements"],
            "properties": {
                "summary": {"type": "string"},
                "requirements": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "required": ["job_requirement", "present_in_resume", "strength_level", "notes"],
                        "properties": {
                            "job_requirement": {"type": "string"},
                            "present_in_resume": {"type": "boolean"},
                            "strength_level": {"type": "string", "enum": ["Strong", "Moderate", "Weak", "Missing"]},
                            "notes": {"type": "string"},
                        },
                    },
                },
            },
        },
        "hard_skill_evaluation": {
            "type": "object",
            "additionalProperties": False,
            "required": ["score", "explanation", "strongest_matches", "missing_or_underrepresented"],
            "properties": {
                "score": {"type": "number", "minimum": 1, "maximum": 100},
                "explanation": {"type": "string"},
                "strongest_matches": {"type": "array", "items": {"type": "string"}},
                "missing_or_underrepresented": {"type": "array", "items": {"type": "string"}},
            },
        },
        "soft_skill_evaluation": {
            "type": "object",
            "additionalProperties": False,
            "required": ["score", "explanation", "strongest_indicators", "missing_or_unclear"],
            "properties": {
                "score": {"type": "number", "minimum": 1, "maximum": 100},
                "explanation": {"type": "string"},
                "strongest_indicators": {"type": "array", "items": {"type": "string"}},
                "missing_or_unclear": {"type": "array", "items": {"type": "string"}},
            },
        },
        "positioning_risk_assessment": {"type": "string"},
        "suggested_updates": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["section", "suggestion", "rationale"],
                "properties": {
                    "section": {"type": "string"},
                    "suggestion": {"type": "string"},
                    "rationale": {"type": "string"},
                },
            },
        },
    },
}


def _llm_local_config_dir() -> Path:
    path = Path(app_settings.runtime_data_root) / "config"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _load_output_schema() -> dict:
    schema_override = os.environ.get("OPENAI_OUTPUT_SCHEMA_FILE", "").strip()
    candidate_path = Path(schema_override) if schema_override else _llm_local_config_dir() / "llm_output_schema.local.json"
    if candidate_path.exists():
        return json.loads(candidate_path.read_text(encoding="utf-8"))
    return LLM_OUTPUT_JSON_SCHEMA


def _load_prompt_template() -> str | None:
    prompt_override = os.environ.get("OPENAI_PROMPT_FILE", "").strip()
    candidate_path = Path(prompt_override) if prompt_override else _llm_local_config_dir() / "llm_prompt.local.txt"
    if candidate_path.exists():
        return candidate_path.read_text(encoding="utf-8")
    return None


def _build_analysis_prompt(resume_text: str, posting_text: str) -> str:
    active_schema = _load_output_schema()
    schema_text = json.dumps(active_schema, indent=2)
    template = _load_prompt_template()
    if template:
        return template.format(
            schema_json=schema_text,
            resume_text=resume_text,
            posting_text=posting_text,
        ).strip()

    return f"""
Evaluate the resume against the job description.

Return JSON only.
Your output MUST validate against this JSON Schema exactly:
{schema_text}

Scoring rules:
- overall_fit_score must be 1-100.
- Use these strategic ratings exactly: Strong Fit, Partial Fit, No Fit.
- Use these requirement strengths exactly: Strong, Moderate, Weak, Missing.
- overall_fit_score weighting guidance: Seniority 25%, Domain 25%, Hard Skills 25%, Positioning 15%, Soft Skills 10%.
- Do not include markdown, code fences, comments, or keys not in schema.
- suggested_updates must contain 3-7 specific, actionable resume changes. Each item must specify the resume section to update, the concrete suggestion, and a rationale explaining how it improves alignment with this specific role.

Resume:
{resume_text}

Job Description:
{posting_text}
""".strip()


def _get_resume_and_posting(resume_version_id: int, job_posting_id: int) -> tuple[tuple, tuple]:
    try:
        with get_connection() as conn:
            resume = conn.execute(
                """
                SELECT id, extracted_text, parser_confidence
                FROM resume_versions
                WHERE id = ?
                """,
                (resume_version_id,),
            ).fetchone()

            posting = conn.execute(
                """
                SELECT id, title, description_text, parser_confidence
                FROM job_postings
                WHERE id = ?
                """,
                (job_posting_id,),
            ).fetchone()
    except sqlite3.OperationalError as exc:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "VALIDATION_ERROR",
                "message": "Database is not initialized. Run /api/v1/db/init first.",
                "details": {"reason": str(exc)},
            },
        )

    if not resume:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Resume version not found."})
    if not posting:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Job posting not found."})
    return resume, posting


def _extract_json_object(text: str) -> dict:
    candidate = str(text or "").strip()
    if candidate.startswith("```"):
        candidate = re.sub(r"^```(?:json)?", "", candidate).strip()
        candidate = re.sub(r"```$", "", candidate).strip()

    try:
        return json.loads(candidate)
    except Exception:
        pass

    match = re.search(r"\{[\s\S]*\}", candidate)
    if not match:
        raise ValueError("No JSON object found in model response")
    return json.loads(match.group(0))


def build_chatgpt_prompt_for_comparison(resume_version_id: int, job_posting_id: int) -> str:
    resume, posting = _get_resume_and_posting(resume_version_id, job_posting_id)
    resume_text = str(resume[1] or "")
    posting_text = f"{posting[1] or ''}\n{posting[2] or ''}"
    return _build_analysis_prompt(resume_text=resume_text, posting_text=posting_text)


def create_placeholder_analysis_run(resume_version_id: int, job_posting_id: int) -> AnalysisRunResponse:
    resume, posting = _get_resume_and_posting(resume_version_id, job_posting_id)
    if not str((resume[1] or "")).strip():
        raise HTTPException(
            status_code=400,
            detail={
                "code": "VALIDATION_ERROR",
                "message": "Selected resume has no extracted content. Choose a different resume or upload/paste one with text.",
                "details": {"field": "resume_version_id"},
            },
        )

    if not str((posting[2] or "")).strip():
        raise HTTPException(
            status_code=400,
            detail={
                "code": "VALIDATION_ERROR",
                "message": "Job listing description is empty. Update the posting before running comparison.",
                "details": {"field": "job_posting_id"},
            },
        )

    weights = {
        "ats_searchability": 0.0,
        "hard_skills": 0.5,
        "soft_skills": 0.5,
    }
    try:
        with get_connection() as conn:
            conn.execute(
                """
                INSERT INTO analysis_runs (
                  resume_version_id,
                  job_posting_id,
                  overall_score,
                  ats_score,
                  hard_skills_score,
                  soft_skills_score,
                  weights_json,
                  matched_keywords_json,
                  missing_keywords_json,
                  evidence_json,
                  parser_quality_flag,
                  confidence
                ) VALUES (?, ?, 0, 0, 0, 0, ?, '{"hard":[],"soft":[]}', '{"hard":[],"soft":[]}', '[]', 'partial', 0.5)
                """,
                (resume_version_id, job_posting_id, json.dumps(weights)),
            )
            analysis_run_id = int(conn.execute("SELECT last_insert_rowid()").fetchone()[0])
            conn.commit()
    except sqlite3.OperationalError as exc:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "VALIDATION_ERROR",
                "message": "Database is not initialized. Run /api/v1/db/init first.",
                "details": {"reason": str(exc)},
            },
        )

    return AnalysisRunResponse(
        analysis_run_id=analysis_run_id,
        overall_score=0.0,
        sub_scores=AnalysisSubScores(ats_searchability=0.0, hard_skills=0.0, soft_skills=0.0),
        weights=weights,
        matched_keywords=AnalysisKeywords(hard=[], soft=[]),
        missing_keywords=AnalysisKeywords(hard=[], soft=[]),
        evidence=[],
        confidence=0.5,
        parser_quality_flag="partial",
    )


def import_chatgpt_response_to_analysis(
    resume_version_id: int,
    job_posting_id: int,
    analysis_run_id: int,
    response_text: str,
) -> AnalysisRunResponse:
    resume, posting = _get_resume_and_posting(resume_version_id, job_posting_id)
    resume_text = str(resume[1] or "")
    posting_text = f"{posting[1] or ''}\n{posting[2] or ''}"

    parsed = _extract_json_object(response_text)
    hard_eval = parsed.get("hard_skill_evaluation") or {}
    soft_eval = parsed.get("soft_skill_evaluation") or {}

    hard_score = float(hard_eval.get("score", 0) or 0)
    soft_score = float(soft_eval.get("score", 0) or 0)
    overall_score = float(parsed.get("overall_fit_score", 0) or 0)

    resume_tokens = _tokens(resume_text)
    posting_tokens = _tokens(posting_text)
    keyword_overlap = len(posting_tokens & resume_tokens)
    ats_score = round(_safe_ratio(keyword_overlap, max(len(posting_tokens), 1), fallback=0.0), 2)

    hard_matched = [str(value) for value in (hard_eval.get("strongest_matches") or []) if str(value).strip()]
    hard_missing = [str(value) for value in (hard_eval.get("missing_or_underrepresented") or []) if str(value).strip()]
    soft_matched = [str(value) for value in (soft_eval.get("strongest_indicators") or []) if str(value).strip()]
    soft_missing = [str(value) for value in (soft_eval.get("missing_or_unclear") or []) if str(value).strip()]

    requirements = (parsed.get("gap_analysis") or {}).get("requirements") or []
    evidence_items: list[AnalysisEvidenceItem] = []
    for row in requirements[:10]:
        if not isinstance(row, dict):
            continue
        requirement = str(row.get("job_requirement", "")).strip()
        notes = str(row.get("notes", "")).strip()
        if not requirement:
            continue
        evidence_items.append(
            AnalysisEvidenceItem(
                category="hard_skills",
                keyword=requirement,
                resume_snippet=notes,
                job_snippet=requirement,
            )
        )

    weights = {
        "ats_searchability": 0.0,
        "hard_skills": 0.5,
        "soft_skills": 0.5,
    }

    try:
        with get_connection() as conn:
            conn.execute(
                """
                UPDATE analysis_runs
                SET
                  overall_score = ?,
                  ats_score = ?,
                  hard_skills_score = ?,
                  soft_skills_score = ?,
                  weights_json = ?,
                  matched_keywords_json = ?,
                  missing_keywords_json = ?,
                  evidence_json = ?,
                  parser_quality_flag = 'ok',
                  confidence = 0.9
                WHERE id = ?
                """,
                (
                    round(overall_score, 2),
                    round(ats_score, 2),
                    round(hard_score, 2),
                    round(soft_score, 2),
                    json.dumps(weights),
                    json.dumps({"hard": hard_matched, "soft": soft_matched}),
                    json.dumps({"hard": hard_missing, "soft": soft_missing}),
                    json.dumps([item.model_dump() for item in evidence_items]),
                    analysis_run_id,
                ),
            )
            conn.commit()
    except sqlite3.OperationalError as exc:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "VALIDATION_ERROR",
                "message": "Database is not initialized. Run /api/v1/db/init first.",
                "details": {"reason": str(exc)},
            },
        )

    return AnalysisRunResponse(
        analysis_run_id=int(analysis_run_id),
        overall_score=round(overall_score, 2),
        sub_scores=AnalysisSubScores(
            ats_searchability=round(ats_score, 2),
            hard_skills=round(hard_score, 2),
            soft_skills=round(soft_score, 2),
        ),
        weights=weights,
        matched_keywords=AnalysisKeywords(hard=hard_matched, soft=soft_matched),
        missing_keywords=AnalysisKeywords(hard=hard_missing, soft=soft_missing),
        evidence=evidence_items,
        confidence=0.9,
        parser_quality_flag="ok",
    )


# ---------------------------------------------------------------------------
# Gemini-powered analysis
# ---------------------------------------------------------------------------

def run_gemini_analysis(
    resume_version_id: int,
    job_posting_id: int,
) -> tuple[AnalysisRunResponse, str]:
    """
    Call Google Gemini to evaluate a resume against a job posting.

    Returns (analysis_response, raw_json_text) so callers can store the raw
    LLM output alongside the structured analysis run.
    """
    from app.services.gemini import call_gemini, gemini_available, RateLimitExceeded
    from app.services.notifications import create_notification

    if not gemini_available():
        raise HTTPException(
            status_code=400,
            detail={
                "code": "GEMINI_NOT_CONFIGURED",
                "message": "Gemini API key not configured. Go to Settings to set it up.",
            },
        )

    resume, posting = _get_resume_and_posting(resume_version_id, job_posting_id)
    resume_text = str(resume[1] or "")
    posting_text = f"{posting[1] or ''}\n{posting[2] or ''}"

    if not resume_text.strip():
        raise HTTPException(
            status_code=400,
            detail={
                "code": "VALIDATION_ERROR",
                "message": "Selected resume has no extracted content.",
                "details": {"field": "resume_version_id"},
            },
        )
    if not posting_text.strip():
        raise HTTPException(
            status_code=400,
            detail={
                "code": "VALIDATION_ERROR",
                "message": "Job listing description is empty.",
                "details": {"field": "job_posting_id"},
            },
        )

    prompt = _build_analysis_prompt(resume_text, posting_text)

    try:
        parsed = call_gemini(prompt)
    except RateLimitExceeded as exc:
        create_notification(
            level="warning",
            title="Gemini rate limit",
            message=str(exc),
        )
        raise HTTPException(
            status_code=429,
            detail={"code": "RATE_LIMITED", "message": str(exc)},
        )
    except RuntimeError as exc:
        create_notification(
            level="error",
            title="Gemini API error",
            message=str(exc),
        )
        raise HTTPException(
            status_code=502,
            detail={"code": "LLM_ERROR", "message": str(exc)},
        )

    raw_json_text = json.dumps(parsed)

    # Check rate warnings after successful call
    from app.services.gemini import get_rate_state

    warning = get_rate_state().should_warn()
    if warning:
        create_notification(level="warning", title="Gemini usage warning", message=warning)

    # --- Parse the Gemini response (same logic as ChatGPT import) ---
    hard_eval = parsed.get("hard_skill_evaluation") or {}
    soft_eval = parsed.get("soft_skill_evaluation") or {}

    hard_score = float(hard_eval.get("score", 0) or 0)
    soft_score = float(soft_eval.get("score", 0) or 0)
    overall_score = float(parsed.get("overall_fit_score", 0) or 0)

    resume_tokens = _tokens(resume_text)
    posting_tokens = _tokens(posting_text)
    keyword_overlap = len(posting_tokens & resume_tokens)
    ats_score = round(_safe_ratio(keyword_overlap, max(len(posting_tokens), 1), fallback=0.0), 2)

    hard_matched = [str(v) for v in (hard_eval.get("strongest_matches") or []) if str(v).strip()]
    hard_missing = [str(v) for v in (hard_eval.get("missing_or_underrepresented") or []) if str(v).strip()]
    soft_matched = [str(v) for v in (soft_eval.get("strongest_indicators") or []) if str(v).strip()]
    soft_missing = [str(v) for v in (soft_eval.get("missing_or_unclear") or []) if str(v).strip()]

    requirements = (parsed.get("gap_analysis") or {}).get("requirements") or []
    evidence_items: list[AnalysisEvidenceItem] = []
    for row in requirements[:10]:
        if not isinstance(row, dict):
            continue
        requirement = str(row.get("job_requirement", "")).strip()
        notes = str(row.get("notes", "")).strip()
        if not requirement:
            continue
        evidence_items.append(
            AnalysisEvidenceItem(
                category="hard_skills",
                keyword=requirement,
                resume_snippet=notes,
                job_snippet=requirement,
            )
        )

    weights = {
        "ats_searchability": 0.0,
        "hard_skills": 0.5,
        "soft_skills": 0.5,
    }

    try:
        with get_connection() as conn:
            conn.execute(
                """
                INSERT INTO analysis_runs (
                  resume_version_id,
                  job_posting_id,
                  overall_score,
                  ats_score,
                  hard_skills_score,
                  soft_skills_score,
                  weights_json,
                  matched_keywords_json,
                  missing_keywords_json,
                  evidence_json,
                  parser_quality_flag,
                  confidence
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ok', 0.9)
                """,
                (
                    resume_version_id,
                    job_posting_id,
                    round(overall_score, 2),
                    round(ats_score, 2),
                    round(hard_score, 2),
                    round(soft_score, 2),
                    json.dumps(weights),
                    json.dumps({"hard": hard_matched, "soft": soft_matched}),
                    json.dumps({"hard": hard_missing, "soft": soft_missing}),
                    json.dumps([item.model_dump() for item in evidence_items]),
                ),
            )
            analysis_run_id = int(conn.execute("SELECT last_insert_rowid()").fetchone()[0])
            conn.commit()
    except sqlite3.OperationalError as exc:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "VALIDATION_ERROR",
                "message": "Database is not initialized.",
                "details": {"reason": str(exc)},
            },
        )

    response = AnalysisRunResponse(
        analysis_run_id=analysis_run_id,
        overall_score=round(overall_score, 2),
        sub_scores=AnalysisSubScores(
            ats_searchability=round(ats_score, 2),
            hard_skills=round(hard_score, 2),
            soft_skills=round(soft_score, 2),
        ),
        weights=weights,
        matched_keywords=AnalysisKeywords(hard=hard_matched, soft=soft_matched),
        missing_keywords=AnalysisKeywords(hard=hard_missing, soft=soft_missing),
        evidence=evidence_items,
        confidence=0.9,
        parser_quality_flag="ok",
    )

    return response, raw_json_text
