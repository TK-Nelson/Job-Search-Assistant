import json

from pydantic import BaseModel


class JobPostingRead(BaseModel):
    id: int
    company_id: int
    company_name: str
    title: str
    location: str | None
    posted_date: str | None
    canonical_url: str
    source_url: str
    description_text: str
    parser_confidence: float
    parser_quality_flag: str
    first_seen_at: str
    last_seen_at: str
    status: str
    match_score: float
    why_matched: str


class JobPostingListResponse(BaseModel):
    items: list[JobPostingRead]
    count: int


def map_job_posting_row(row: tuple) -> JobPostingRead:
    description_text = row[8] or ""
    parser_confidence = float(row[9])

    analysis_overall_score = row[14] if len(row) > 14 else None
    analysis_evidence_json = row[15] if len(row) > 15 else None
    analysis_matched_keywords_json = row[16] if len(row) > 16 else None

    match_score = round(float(analysis_overall_score), 2) if analysis_overall_score is not None else round(parser_confidence * 100, 2)

    why = "Heuristic match from careers-page parsing. Run analysis for evidence-backed rationale."
    if analysis_evidence_json:
        try:
            evidence_items = json.loads(analysis_evidence_json)
            if isinstance(evidence_items, list) and evidence_items:
                first = evidence_items[0] or {}
                keyword = first.get("keyword")
                category = first.get("category")
                if keyword and category:
                    why = f"Matched {category.replace('_', ' ')} keyword: {keyword}"
                elif keyword:
                    why = f"Matched keyword: {keyword}"
                else:
                    why = "Evidence-backed match from latest analysis run."
        except Exception:
            pass
    elif analysis_matched_keywords_json:
        try:
            matched = json.loads(analysis_matched_keywords_json)
            hard = matched.get("hard", []) if isinstance(matched, dict) else []
            soft = matched.get("soft", []) if isinstance(matched, dict) else []
            keywords = (hard[:2] + soft[:1])
            if keywords:
                why = f"Matched keywords: {', '.join(keywords)}"
            else:
                why = "Keyword overlap from latest analysis run."
        except Exception:
            pass

    return JobPostingRead(
        id=row[0],
        company_id=row[1],
        company_name=row[2],
        title=row[3],
        location=row[4],
        posted_date=row[5],
        canonical_url=row[6],
        source_url=row[7],
        description_text=description_text,
        parser_confidence=parser_confidence,
        parser_quality_flag=row[10],
        first_seen_at=row[11],
        last_seen_at=row[12],
        status=row[13],
        match_score=match_score,
        why_matched=why,
    )
