import json
import re
import sqlite3

from fastapi import HTTPException

from app.core.settings_store import get_settings
from app.db.database import get_connection
from app.services.audit import write_audit_event
from app.schemas.analysis import (
    AnalysisEvidenceItem,
    AnalysisKeywords,
    AnalysisRunHistoryItem,
    AnalysisRunResponse,
    AnalysisSubScores,
)

HARD_SKILL_TERMS = {
    "python",
    "sql",
    "java",
    "javascript",
    "typescript",
    "react",
    "fastapi",
    "node",
    "aws",
    "docker",
    "kubernetes",
    "git",
    "linux",
    "api",
    "rest",
}

SOFT_SKILL_TERMS = {
    "communication",
    "leadership",
    "collaboration",
    "mentorship",
    "stakeholder",
    "ownership",
    "adaptability",
    "problem-solving",
    "teamwork",
    "planning",
}

STOPWORDS = {
    "the",
    "and",
    "for",
    "with",
    "that",
    "this",
    "from",
    "you",
    "your",
    "our",
    "are",
    "was",
    "will",
    "have",
    "has",
    "job",
    "role",
    "position",
}


def _tokens(text: str) -> set[str]:
    parts = re.findall(r"[a-zA-Z][a-zA-Z0-9\-\+\.]{1,}", (text or "").lower())
    return {part for part in parts if part not in STOPWORDS and len(part) > 2}


def _safe_ratio(numerator: int, denominator: int, fallback: float = 50.0) -> float:
    if denominator <= 0:
        return fallback
    return max(0.0, min(100.0, (numerator / denominator) * 100.0))


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


def run_analysis(resume_version_id: int, job_posting_id: int) -> AnalysisRunResponse:
    resume, posting = _get_resume_and_posting(resume_version_id, job_posting_id)
    settings = get_settings()

    resume_text = resume[1] or ""
    resume_conf = float(resume[2] or 0.0)
    posting_text = f"{posting[1] or ''}\n{posting[2] or ''}"
    posting_conf = float(posting[3] or 0.0)

    resume_tokens = _tokens(resume_text)
    posting_tokens = _tokens(posting_text)

    posting_hard_required = posting_tokens & HARD_SKILL_TERMS
    posting_soft_required = posting_tokens & SOFT_SKILL_TERMS

    matched_hard = sorted(list(posting_hard_required & resume_tokens))
    matched_soft = sorted(list(posting_soft_required & resume_tokens))
    missing_hard = sorted(list(posting_hard_required - resume_tokens))
    missing_soft = sorted(list(posting_soft_required - resume_tokens))

    keyword_overlap = len(posting_tokens & resume_tokens)
    ats_score = round(_safe_ratio(keyword_overlap, max(len(posting_tokens), 1), fallback=0.0), 2)
    hard_score = round(_safe_ratio(len(matched_hard), len(posting_hard_required), fallback=50.0), 2)
    soft_score = round(_safe_ratio(len(matched_soft), len(posting_soft_required), fallback=50.0), 2)

    weights = settings.scoring.weights.model_dump()
    overall_score = round(
        (ats_score * weights["ats_searchability"])
        + (hard_score * weights["hard_skills"])
        + (soft_score * weights["soft_skills"]),
        2,
    )

    confidence = round(max(0.0, min(1.0, (resume_conf + posting_conf) / 2)), 2)
    parser_quality_flag = "ok" if confidence >= 0.7 else "low_confidence"

    evidence_terms = matched_hard[:3] + matched_soft[:2]
    evidence = [
        AnalysisEvidenceItem(
            category="hard_skills" if term in matched_hard else "soft_skills",
            keyword=term,
            resume_snippet=f"Resume references '{term}'.",
            job_snippet=f"Job posting references '{term}'.",
        )
        for term in evidence_terms
    ]

    matched = AnalysisKeywords(hard=matched_hard, soft=matched_soft)
    missing = AnalysisKeywords(hard=missing_hard, soft=missing_soft)

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
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    resume_version_id,
                    job_posting_id,
                    overall_score,
                    ats_score,
                    hard_score,
                    soft_score,
                    json.dumps(weights),
                    json.dumps({"hard": matched_hard, "soft": matched_soft}),
                    json.dumps({"hard": missing_hard, "soft": missing_soft}),
                    json.dumps([item.model_dump() for item in evidence]),
                    parser_quality_flag,
                    confidence,
                ),
            )
            analysis_run_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
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

    write_audit_event(
        event_type="analysis.run",
        entity_type="analysis_run",
        entity_id=str(analysis_run_id),
        payload={
            "resume_version_id": resume_version_id,
            "job_posting_id": job_posting_id,
            "overall_score": overall_score,
            "confidence": confidence,
        },
    )

    return AnalysisRunResponse(
        analysis_run_id=analysis_run_id,
        overall_score=overall_score,
        sub_scores=AnalysisSubScores(
            ats_searchability=ats_score,
            hard_skills=hard_score,
            soft_skills=soft_score,
        ),
        weights=weights,
        matched_keywords=matched,
        missing_keywords=missing,
        evidence=evidence,
        confidence=confidence,
        parser_quality_flag=parser_quality_flag,
    )


def list_analysis_runs(
    resume_version_id: int | None = None,
    job_posting_id: int | None = None,
    limit: int = 50,
) -> list[AnalysisRunHistoryItem]:
    clauses: list[str] = []
    params: list = []

    if resume_version_id is not None:
        clauses.append("resume_version_id = ?")
        params.append(resume_version_id)
    if job_posting_id is not None:
        clauses.append("job_posting_id = ?")
        params.append(job_posting_id)

    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    params.append(max(1, min(limit, 200)))

    query = f"""
      SELECT id, resume_version_id, job_posting_id, overall_score, ats_score,
             hard_skills_score, soft_skills_score, parser_quality_flag, confidence, created_at
      FROM analysis_runs
      {where}
      ORDER BY id DESC
      LIMIT ?
    """

    try:
        with get_connection() as conn:
            rows = conn.execute(query, tuple(params)).fetchall()
    except sqlite3.OperationalError as exc:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "VALIDATION_ERROR",
                "message": "Database is not initialized. Run /api/v1/db/init first.",
                "details": {"reason": str(exc)},
            },
        )

    return [
        AnalysisRunHistoryItem(
            id=row[0],
            resume_version_id=row[1],
            job_posting_id=row[2],
            overall_score=float(row[3]),
            ats_score=float(row[4]),
            hard_skills_score=float(row[5]),
            soft_skills_score=float(row[6]),
            parser_quality_flag=row[7],
            confidence=float(row[8]),
            created_at=row[9],
        )
        for row in rows
    ]
