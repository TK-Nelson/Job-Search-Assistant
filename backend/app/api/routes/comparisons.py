import hashlib
import sqlite3
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, Query

from app.db.database import get_connection
from app.schemas.analysis import (
    AnalysisEvidenceItem,
    AnalysisKeywords,
    AnalysisRunResponse,
    AnalysisSubScores,
)
from app.schemas.comparison import (
    ComparisonDecisionRequest,
    ComparisonDecisionResponse,
    ComparisonReportListResponse,
    ComparisonReportRead,
    ComparisonRunRequest,
    ComparisonRunResponse,
    map_comparison_list_item,
    parse_json,
)
from app.services.analysis import run_analysis
from app.services.audit import write_audit_event

router = APIRouter()


def _db_uninitialized(exc: Exception) -> HTTPException:
    return HTTPException(
        status_code=400,
        detail={
            "code": "VALIDATION_ERROR",
            "message": "Database is not initialized. Run /api/v1/db/init first.",
            "details": {"reason": str(exc)},
        },
    )


def _normalize_text(value: str) -> str:
    return " ".join((value or "").lower().strip().split())


def _looks_like_http_url(value: str | None) -> bool:
    if not value:
        return False
    parsed = urlparse(value.strip())
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def _company_placeholder_url(company_name: str) -> str:
    slug = "-".join(part for part in _normalize_text(company_name).replace("/", " ").split(" ") if part)
    slug = slug or "manual-company"
    return f"https://manual.local/company/{slug}"


def _resolve_company(conn: sqlite3.Connection, payload: ComparisonRunRequest) -> tuple[int, str]:
    if payload.source_company_id is not None:
        row = conn.execute("SELECT id, name FROM companies WHERE id = ?", (payload.source_company_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Company not found."})
        return int(row[0]), str(row[1])

    source_company_name = (payload.source_company_name or "").strip()
    existing = conn.execute(
        "SELECT id, name FROM companies WHERE lower(name) = lower(?) ORDER BY id ASC LIMIT 1",
        (source_company_name,),
    ).fetchone()
    if existing:
        return int(existing[0]), str(existing[1])

    careers_url = payload.source_url.strip() if _looks_like_http_url(payload.source_url) else _company_placeholder_url(source_company_name)
    conn.execute(
        """
        INSERT INTO companies (name, careers_url, followed, notes)
        VALUES (?, ?, 0, 'Created from manual comparison input')
        """,
        (source_company_name, careers_url),
    )
    company_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    return int(company_id), source_company_name


def _fingerprint(company_id: int, canonical_url: str, title: str, location: str) -> str:
    seed = f"{company_id}|{_normalize_text(canonical_url)}|{_normalize_text(title)}|{_normalize_text(location)}"
    return hashlib.sha256(seed.encode("utf-8")).hexdigest()


def _manual_canonical_url(company_id: int, title: str, description_text: str, source_url: str | None) -> str:
    if _looks_like_http_url(source_url):
        return source_url.strip()
    digest = hashlib.sha1(f"{title}|{description_text}".encode("utf-8")).hexdigest()[:16]
    return f"manual://comparison/{company_id}/{digest}"


def _create_or_update_manual_posting(
    conn: sqlite3.Connection,
    company_id: int,
    title: str,
    source_url: str | None,
    description_text: str,
) -> int:
    safe_title = (title or "Untitled role").strip() or "Untitled role"
    safe_description = description_text.strip()
    location = "unknown"
    canonical_url = _manual_canonical_url(company_id, safe_title, safe_description, source_url)
    source_url_value = source_url.strip() if source_url and source_url.strip() else canonical_url
    fingerprint = _fingerprint(company_id, canonical_url, safe_title, location)

    existing = conn.execute("SELECT id FROM job_postings WHERE fingerprint = ?", (fingerprint,)).fetchone()
    if existing:
        conn.execute(
            """
            UPDATE job_postings
            SET
              title = ?,
              canonical_url = ?,
              source_url = ?,
              description_text = ?,
              parser_confidence = 1.0,
              parser_quality_flag = 'ok',
              source_kind = 'manual_paste',
              created_via = 'comparison_input',
              status = 'active',
              last_seen_at = datetime('now')
            WHERE id = ?
            """,
            (safe_title, canonical_url, source_url_value, safe_description, int(existing[0])),
        )
        return int(existing[0])

    conn.execute(
        """
        INSERT INTO job_postings (
          company_id,
          title,
          location,
          posted_date,
          canonical_url,
          source_url,
          description_text,
          fingerprint,
          parser_confidence,
          parser_quality_flag,
          source_kind,
          created_via,
          status
        ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, 1.0, 'ok', 'manual_paste', 'comparison_input', 'active')
        """,
        (company_id, safe_title, location, canonical_url, source_url_value, safe_description, fingerprint),
    )
    return int(conn.execute("SELECT last_insert_rowid()").fetchone()[0])


def _load_analysis_response(conn: sqlite3.Connection, analysis_run_id: int) -> AnalysisRunResponse:
    row = conn.execute(
        """
        SELECT id, overall_score, ats_score, hard_skills_score, soft_skills_score,
               weights_json, matched_keywords_json, missing_keywords_json, evidence_json,
               confidence, parser_quality_flag
        FROM analysis_runs
        WHERE id = ?
        """,
        (analysis_run_id,),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Analysis run not found."})

    weights = parse_json(row[5], {})
    matched = parse_json(row[6], {"hard": [], "soft": []})
    missing = parse_json(row[7], {"hard": [], "soft": []})
    evidence_raw = parse_json(row[8], [])

    evidence = [
        AnalysisEvidenceItem(
            category=str(item.get("category", "")),
            keyword=str(item.get("keyword", "")),
            resume_snippet=str(item.get("resume_snippet", "")),
            job_snippet=str(item.get("job_snippet", "")),
        )
        for item in evidence_raw
        if isinstance(item, dict)
    ]

    return AnalysisRunResponse(
        analysis_run_id=int(row[0]),
        overall_score=float(row[1]),
        sub_scores=AnalysisSubScores(
            ats_searchability=float(row[2]),
            hard_skills=float(row[3]),
            soft_skills=float(row[4]),
        ),
        weights={
            "ats_searchability": float(weights.get("ats_searchability", 0.35)),
            "hard_skills": float(weights.get("hard_skills", 0.45)),
            "soft_skills": float(weights.get("soft_skills", 0.20)),
        },
        matched_keywords=AnalysisKeywords(
            hard=[str(value) for value in matched.get("hard", [])],
            soft=[str(value) for value in matched.get("soft", [])],
        ),
        missing_keywords=AnalysisKeywords(
            hard=[str(value) for value in missing.get("hard", [])],
            soft=[str(value) for value in missing.get("soft", [])],
        ),
        evidence=evidence,
        confidence=float(row[9]),
        parser_quality_flag=str(row[10]),
    )


@router.post("/comparisons/run", response_model=ComparisonRunResponse)
def run_comparison(payload: ComparisonRunRequest) -> ComparisonRunResponse:
    try:
        with get_connection() as conn:
            company_id, company_name = _resolve_company(conn, payload)
            posting_id = _create_or_update_manual_posting(
                conn=conn,
                company_id=company_id,
                title=payload.title or "Untitled role",
                source_url=payload.source_url,
                description_text=payload.description_text,
            )
            conn.commit()
    except sqlite3.OperationalError as exc:
        raise _db_uninitialized(exc)

    analysis = run_analysis(payload.resume_version_id, posting_id)

    try:
        with get_connection() as conn:
            conn.execute(
                """
                INSERT INTO comparison_reports (
                  job_posting_id,
                  resume_version_id,
                  analysis_run_id,
                  source_company_input,
                  source_url_input,
                  applied_decision,
                  linked_application_id
                ) VALUES (?, ?, ?, ?, ?, 'unknown', NULL)
                """,
                (
                    posting_id,
                    payload.resume_version_id,
                    analysis.analysis_run_id,
                    company_name,
                    payload.source_url.strip() if payload.source_url else None,
                ),
            )
            comparison_report_id = int(conn.execute("SELECT last_insert_rowid()").fetchone()[0])
            created_at = conn.execute("SELECT created_at FROM comparison_reports WHERE id = ?", (comparison_report_id,)).fetchone()[0]
            conn.commit()
    except sqlite3.OperationalError as exc:
        raise _db_uninitialized(exc)

    write_audit_event(
        event_type="comparison.run",
        entity_type="comparison_report",
        entity_id=str(comparison_report_id),
        payload={
            "job_posting_id": posting_id,
            "resume_version_id": payload.resume_version_id,
            "analysis_run_id": analysis.analysis_run_id,
        },
    )

    return ComparisonRunResponse(
        comparison_report_id=comparison_report_id,
        job_posting_id=posting_id,
        analysis=analysis,
        created_at=created_at,
    )


@router.get("/comparisons", response_model=ComparisonReportListResponse)
def list_comparisons(limit: int = Query(default=50, ge=1, le=200)) -> ComparisonReportListResponse:
    try:
        with get_connection() as conn:
            rows = conn.execute(
                """
                SELECT
                  cr.id,
                  cr.job_posting_id,
                  c.name,
                  jp.title,
                  COALESCE(cr.source_url_input, jp.canonical_url),
                  ar.overall_score,
                  cr.applied_decision,
                  cr.linked_application_id,
                  cr.created_at
                FROM comparison_reports cr
                JOIN job_postings jp ON jp.id = cr.job_posting_id
                JOIN companies c ON c.id = jp.company_id
                JOIN analysis_runs ar ON ar.id = cr.analysis_run_id
                ORDER BY cr.id DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
    except sqlite3.OperationalError as exc:
        raise _db_uninitialized(exc)

    items = [map_comparison_list_item(row) for row in rows]
    return ComparisonReportListResponse(items=items, count=len(items))


@router.get("/comparisons/{comparison_report_id}", response_model=ComparisonReportRead)
def get_comparison(comparison_report_id: int) -> ComparisonReportRead:
    try:
        with get_connection() as conn:
            row = conn.execute(
                """
                SELECT
                  cr.id,
                  cr.job_posting_id,
                  cr.resume_version_id,
                  cr.analysis_run_id,
                  cr.source_company_input,
                  cr.source_url_input,
                  c.name,
                  jp.title,
                  jp.canonical_url,
                  cr.applied_decision,
                  cr.linked_application_id,
                  cr.created_at
                FROM comparison_reports cr
                JOIN job_postings jp ON jp.id = cr.job_posting_id
                JOIN companies c ON c.id = jp.company_id
                WHERE cr.id = ?
                """,
                (comparison_report_id,),
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Comparison report not found."})

            analysis = _load_analysis_response(conn, int(row[3]))
    except sqlite3.OperationalError as exc:
        raise _db_uninitialized(exc)

    return ComparisonReportRead(
        id=int(row[0]),
        job_posting_id=int(row[1]),
        resume_version_id=int(row[2]),
        analysis_run_id=int(row[3]),
        source_company_input=row[4],
        source_url_input=row[5],
        company_name=str(row[6]),
        title=str(row[7]),
        canonical_url=str(row[8]),
        applied_decision=str(row[9]),
        linked_application_id=row[10],
        created_at=str(row[11]),
        analysis=analysis,
    )


@router.post("/comparisons/{comparison_report_id}/application-decision", response_model=ComparisonDecisionResponse)
def set_comparison_application_decision(
    comparison_report_id: int,
    payload: ComparisonDecisionRequest,
) -> ComparisonDecisionResponse:
    try:
        with get_connection() as conn:
            report_row = conn.execute(
                "SELECT id, job_posting_id, linked_application_id FROM comparison_reports WHERE id = ?",
                (comparison_report_id,),
            ).fetchone()
            if not report_row:
                raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Comparison report not found."})

            job_posting_id = int(report_row[1])
            current_application_id = report_row[2]

            if payload.applied:
                if current_application_id is None:
                    existing = conn.execute(
                        "SELECT id FROM applications WHERE job_posting_id = ? ORDER BY id DESC LIMIT 1",
                        (job_posting_id,),
                    ).fetchone()
                    if existing:
                        application_id = int(existing[0])
                    else:
                        conn.execute(
                            """
                            INSERT INTO applications (job_posting_id, stage, applied_at, notes)
                            VALUES (?, 'applied', date('now'), ?)
                            """,
                            (job_posting_id, f"Created from comparison report #{comparison_report_id}"),
                        )
                        application_id = int(conn.execute("SELECT last_insert_rowid()").fetchone()[0])
                        conn.execute(
                            """
                            INSERT INTO application_stage_history (application_id, from_stage, to_stage, reason)
                            VALUES (?, NULL, 'applied', 'comparison decision yes')
                            """,
                            (application_id,),
                        )

                    conn.execute(
                        """
                        UPDATE comparison_reports
                        SET applied_decision = 'yes', linked_application_id = ?
                        WHERE id = ?
                        """,
                        (application_id, comparison_report_id),
                    )
                else:
                    application_id = int(current_application_id)
                    conn.execute(
                        "UPDATE comparison_reports SET applied_decision = 'yes' WHERE id = ?",
                        (comparison_report_id,),
                    )
                applied_decision = "yes"
            else:
                conn.execute(
                    "UPDATE comparison_reports SET applied_decision = 'no' WHERE id = ?",
                    (comparison_report_id,),
                )
                application_id = current_application_id
                applied_decision = "no"

            conn.commit()
    except sqlite3.OperationalError as exc:
        raise _db_uninitialized(exc)

    write_audit_event(
        event_type="comparison.application_decision",
        entity_type="comparison_report",
        entity_id=str(comparison_report_id),
        payload={"applied": payload.applied, "application_id": application_id},
    )

    return ComparisonDecisionResponse(
        comparison_report_id=comparison_report_id,
        applied_decision=applied_decision,
        application_id=application_id,
    )
