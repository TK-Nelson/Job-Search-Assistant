import hashlib
from io import BytesIO
from pathlib import Path
import sqlite3
from datetime import datetime
import re

from fastapi import APIRouter, File, HTTPException, UploadFile
from docx import Document

from app.core.artifact_crypto import write_artifact_bytes
from app.core.settings_store import get_settings
from app.db.database import get_connection
from app.schemas.resume import (
    ResumeConcernRead,
    ResumeDiagnosticsRead,
    ResumeNotesUpdate,
    ResumePasteRequest,
    ResumeVersionListResponse,
    ResumeVersionRead,
    map_resume_row,
    normalize_parser_confidence,
)
from app.services.resume_parser import extract_docx_text_from_bytes

router = APIRouter()


SECTION_KEYWORDS = {
    "experience": ["experience", "work history", "employment"],
    "skills": ["skills", "technical skills", "technologies"],
    "education": ["education", "academic", "degree"],
}

PLACEHOLDER_TERMS = ["lorem", "ipsum", "todo", "tbd", "xxx", "[insert", "placeholder"]


def _build_resume_concerns(extracted_text: str, parser_confidence: float) -> tuple[list[ResumeConcernRead], list[str]]:
    concerns: list[ResumeConcernRead] = []
    highlight_terms: set[str] = set()

    lower_text = (extracted_text or "").lower()
    compact_text = re.sub(r"\s+", " ", lower_text).strip()
    parser_gap = round(max(0.0, 1.0 - parser_confidence), 2)

    if parser_confidence < 0.7:
        concerns.append(
            ResumeConcernRead(
                code="low_parser_confidence",
                severity="warning",
                message="Parser confidence is below 0.70. The extracted text may be incomplete.",
                delta_label="gap_to_target",
                delta_value=parser_gap,
            )
        )

    if len(compact_text) < 300:
        char_gap = float(300 - len(compact_text))
        concerns.append(
            ResumeConcernRead(
                code="short_extracted_text",
                severity="info",
                message="Extracted text appears short; include fuller resume content for stronger analysis.",
                delta_label="chars_below_min",
                delta_value=char_gap,
            )
        )

    missing_sections = 0
    for section_name, section_terms in SECTION_KEYWORDS.items():
        if not any(term in lower_text for term in section_terms):
            missing_sections += 1
            concerns.append(
                ResumeConcernRead(
                    code=f"missing_section_{section_name}",
                    severity="info",
                    message=f"Could not confidently identify a '{section_name}' section heading.",
                    delta_label="missing_sections",
                    delta_value=1.0,
                )
            )

    for term in PLACEHOLDER_TERMS:
        count = lower_text.count(term)
        if count > 0:
            highlight_terms.add(term)
            concerns.append(
                ResumeConcernRead(
                    code="placeholder_content",
                    severity="warning",
                    message=f"Placeholder-like content detected: '{term}'.",
                    delta_label="occurrences",
                    delta_value=float(count),
                )
            )

    if missing_sections >= 2 and parser_gap > 0:
        concerns.append(
            ResumeConcernRead(
                code="section_structure_risk",
                severity="info",
                message="Multiple standard section headings are missing, which can reduce section extraction reliability.",
                delta_label="gap_to_target",
                delta_value=parser_gap,
            )
        )

    if len(concerns) == 0 and parser_gap > 0:
        concerns.append(
            ResumeConcernRead(
                code="confidence_not_max",
                severity="info",
                message="No rule-based concerns were detected, but confidence remains probabilistic and below a perfect 1.00.",
                delta_label="gap_to_target",
                delta_value=parser_gap,
            )
        )

    return concerns, sorted(highlight_terms)


def _store_resume_version(
    *,
    base_name: str,
    body: bytes,
    extracted_text: str,
    parser_confidence: float,
    notes: str | None,
) -> dict:
    settings = get_settings()
    target_dir = Path(settings.storage.artifacts_dir) / "resumes"
    target_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
    target_path = target_dir / f"{base_name}__{timestamp}.docx"
    stored_path = write_artifact_bytes(target_path, body, encrypt=settings.storage.encrypt_artifacts)

    checksum = hashlib.sha256(body).hexdigest()

    normalized_confidence = normalize_parser_confidence(parser_confidence)

    with get_connection() as conn:
        row = conn.execute(
            "SELECT COUNT(*) FROM resume_versions WHERE source_name = ?",
            (base_name,),
        ).fetchone()
        next_version = (int(row[0]) if row else 0) + 1
        version_tag = f"v{next_version}"

        conn.execute(
            """
            INSERT INTO resume_versions (
              source_name,
              version_tag,
              mime_type,
              file_ext,
              file_path,
              checksum_sha256,
              extracted_text,
              sections_json,
              notes,
              parser_confidence,
              parent_resume_version_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
            """,
            (
                base_name,
                version_tag,
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                ".docx",
                str(stored_path),
                checksum,
                extracted_text,
                "{}",
                (notes or "").strip() or None,
                normalized_confidence,
            ),
        )
        resume_version_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        conn.commit()

    return {
        "status": "uploaded",
        "bytes": len(body),
        "path": str(stored_path),
        "resume_version_id": int(resume_version_id),
        "source_name": base_name,
    }


@router.post("/resumes/upload")
async def upload_resume(file: UploadFile = File(...)) -> dict:
    settings = get_settings()

    ext = Path(file.filename or "").suffix.lower()
    if ext not in settings.resume.allowed_extensions:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "VALIDATION_ERROR",
                "message": "Only DOCX files are supported.",
                "details": {"field": "file"},
            },
        )

    body = await file.read()
    size_mb = len(body) / (1024 * 1024)
    if size_mb > settings.resume.max_size_mb:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "VALIDATION_ERROR",
                "message": f"File exceeds max size of {settings.resume.max_size_mb} MB",
                "details": {"field": "file"},
            },
        )

    base_name = Path(file.filename).stem
    extracted_text, parser_confidence = extract_docx_text_from_bytes(body)

    try:
        result = _store_resume_version(
            base_name=base_name,
            body=body,
            extracted_text=extracted_text,
            parser_confidence=parser_confidence,
            notes=None,
        )
    except sqlite3.OperationalError as exc:
        if "no such table" in str(exc).lower():
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "VALIDATION_ERROR",
                    "message": "Database is not initialized. Run /api/v1/db/init first.",
                    "details": {"reason": str(exc)},
                },
            )
        raise

    result["filename"] = file.filename
    return result


@router.post("/resumes/paste")
def paste_resume(payload: ResumePasteRequest) -> dict:
    settings = get_settings()

    title = (payload.title or "").strip()
    text = (payload.text or "").strip()
    if not title:
        raise HTTPException(
            status_code=400,
            detail={"code": "VALIDATION_ERROR", "message": "Title is required for pasted resume text."},
        )
    if len(text) < 40:
        raise HTTPException(
            status_code=400,
            detail={"code": "VALIDATION_ERROR", "message": "Resume text must be at least 40 characters."},
        )

    doc = Document()
    for line in text.splitlines():
        doc.add_paragraph(line)

    buffer = BytesIO()
    doc.save(buffer)
    body = buffer.getvalue()
    size_mb = len(body) / (1024 * 1024)
    if size_mb > settings.resume.max_size_mb:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "VALIDATION_ERROR",
                "message": f"Generated DOCX exceeds max size of {settings.resume.max_size_mb} MB",
            },
        )

    extracted_text, parser_confidence = extract_docx_text_from_bytes(body)

    safe_name = re.sub(r"[^a-zA-Z0-9_\-. ]+", "", title).strip() or "Pasted Resume"

    try:
        result = _store_resume_version(
            base_name=safe_name,
            body=body,
            extracted_text=extracted_text,
            parser_confidence=parser_confidence,
            notes=payload.notes,
        )
    except sqlite3.OperationalError as exc:
        if "no such table" in str(exc).lower():
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "VALIDATION_ERROR",
                    "message": "Database is not initialized. Run /api/v1/db/init first.",
                    "details": {"reason": str(exc)},
                },
            )
        raise

    result["filename"] = f"{safe_name}.docx"
    result["source"] = "pasted"
    return result


@router.get("/resumes", response_model=ResumeVersionListResponse)
def list_resumes() -> ResumeVersionListResponse:
    try:
        with get_connection() as conn:
            rows = conn.execute(
                """
                SELECT id, source_name, version_tag, mime_type, file_ext, file_path,
                      checksum_sha256, notes, parser_confidence, created_at
                FROM resume_versions
                ORDER BY id DESC
                """
            ).fetchall()
    except sqlite3.OperationalError as exc:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "VALIDATION_ERROR",
                "message": "Database is not initialized. Run /api/v1/db/init first.",
                "details": {"reason": str(exc)},
            },
        )

    items = [map_resume_row(row) for row in rows]
    return ResumeVersionListResponse(items=items, count=len(items))


@router.get("/resumes/{resume_version_id}", response_model=ResumeVersionRead)
def get_resume(resume_version_id: int) -> ResumeVersionRead:
    try:
        with get_connection() as conn:
            row = conn.execute(
                """
                SELECT id, source_name, version_tag, mime_type, file_ext, file_path,
                      checksum_sha256, notes, parser_confidence, created_at
                FROM resume_versions
                WHERE id = ?
                """,
                (resume_version_id,),
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

    if not row:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Resume version not found."})

    return map_resume_row(row)


@router.put("/resumes/{resume_version_id}/notes", response_model=ResumeVersionRead)
def update_resume_notes(resume_version_id: int, payload: ResumeNotesUpdate) -> ResumeVersionRead:
    try:
        with get_connection() as conn:
            existing = conn.execute("SELECT id FROM resume_versions WHERE id = ?", (resume_version_id,)).fetchone()
            if not existing:
                raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Resume version not found."})

            conn.execute(
                "UPDATE resume_versions SET notes = ? WHERE id = ?",
                ((payload.notes or "").strip() or None, resume_version_id),
            )
            conn.commit()

            row = conn.execute(
                """
                SELECT id, source_name, version_tag, mime_type, file_ext, file_path,
                       checksum_sha256, notes, parser_confidence, created_at
                FROM resume_versions
                WHERE id = ?
                """,
                (resume_version_id,),
            ).fetchone()
    except sqlite3.OperationalError as exc:
        if "no such table" in str(exc).lower():
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "VALIDATION_ERROR",
                    "message": "Database is not initialized. Run /api/v1/db/init first.",
                    "details": {"reason": str(exc)},
                },
            )
        raise

    return map_resume_row(row)


@router.get("/resumes/{resume_version_id}/diagnostics", response_model=ResumeDiagnosticsRead)
def get_resume_diagnostics(resume_version_id: int) -> ResumeDiagnosticsRead:
    try:
        with get_connection() as conn:
            row = conn.execute(
                """
                SELECT id, extracted_text, parser_confidence
                FROM resume_versions
                WHERE id = ?
                """,
                (resume_version_id,),
            ).fetchone()
    except sqlite3.OperationalError as exc:
        if "no such table" in str(exc).lower():
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "VALIDATION_ERROR",
                    "message": "Database is not initialized. Run /api/v1/db/init first.",
                    "details": {"reason": str(exc)},
                },
            )
        raise

    if not row:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Resume version not found."})

    extracted_text = row[1] or ""
    parser_confidence = float(row[2] or 0.0)
    parser_confidence = normalize_parser_confidence(parser_confidence)
    concerns, highlight_terms = _build_resume_concerns(extracted_text, parser_confidence)

    return ResumeDiagnosticsRead(
        resume_version_id=int(row[0]),
        parser_confidence=parser_confidence,
        concerns=concerns,
        highlight_terms=highlight_terms,
        extracted_text=extracted_text,
    )


@router.delete("/resumes/{resume_version_id}")
def delete_resume(resume_version_id: int) -> dict:
    file_path_to_delete: Path | None = None

    try:
        with get_connection() as conn:
            row = conn.execute(
                "SELECT id, file_path FROM resume_versions WHERE id = ?",
                (resume_version_id,),
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Resume version not found."})

            file_path_to_delete = Path(row[1]) if row[1] else None

            conn.execute(
                "UPDATE resume_versions SET parent_resume_version_id = NULL WHERE parent_resume_version_id = ?",
                (resume_version_id,),
            )
            conn.execute("DELETE FROM resume_versions WHERE id = ?", (resume_version_id,))
            conn.commit()
    except sqlite3.OperationalError as exc:
        if "no such table" in str(exc).lower():
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "VALIDATION_ERROR",
                    "message": "Database is not initialized. Run /api/v1/db/init first.",
                    "details": {"reason": str(exc)},
                },
            )
        raise

    if file_path_to_delete and file_path_to_delete.exists() and file_path_to_delete.is_file():
        try:
            file_path_to_delete.unlink(missing_ok=True)
        except Exception:
            pass

    return {"status": "deleted", "resume_version_id": resume_version_id}
