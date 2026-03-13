import sqlite3
from pathlib import Path

from app.core.settings_store import get_settings


def _db_path() -> Path:
    settings = get_settings()
    path = Path(settings.database.path)
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def get_db_path() -> Path:
    return _db_path()


def db_file_exists() -> bool:
    return _db_path().exists()


def get_connection() -> sqlite3.Connection:
    return sqlite3.connect(_db_path())


def _column_exists(conn: sqlite3.Connection, table_name: str, column_name: str) -> bool:
    rows = conn.execute(f"PRAGMA table_info({table_name})").fetchall()
    return any(row[1] == column_name for row in rows)


def _apply_runtime_migrations(conn: sqlite3.Connection) -> None:
    if not _column_exists(conn, "companies", "industry"):
        conn.execute("ALTER TABLE companies ADD COLUMN industry TEXT")

    if not _column_exists(conn, "companies", "logo_url"):
        conn.execute("ALTER TABLE companies ADD COLUMN logo_url TEXT")

    if not _column_exists(conn, "resume_versions", "notes"):
        conn.execute("ALTER TABLE resume_versions ADD COLUMN notes TEXT")

    if not _column_exists(conn, "job_postings", "source_kind"):
        conn.execute(
            """
            ALTER TABLE job_postings
            ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'fetched'
            CHECK (source_kind IN ('fetched','manual_paste'))
            """
        )
        conn.execute("UPDATE job_postings SET source_kind = 'fetched' WHERE source_kind IS NULL OR source_kind = ''")

    if not _column_exists(conn, "job_postings", "created_via"):
        conn.execute(
            """
            ALTER TABLE job_postings
            ADD COLUMN created_via TEXT NOT NULL DEFAULT 'ingestion'
            CHECK (created_via IN ('ingestion','comparison_input'))
            """
        )
        conn.execute("UPDATE job_postings SET created_via = 'ingestion' WHERE created_via IS NULL OR created_via = ''")

    for col in ("salary_range", "seniority_level", "workplace_type", "years_experience", "commitment_type"):
        if not _column_exists(conn, "job_postings", col):
            conn.execute(f"ALTER TABLE job_postings ADD COLUMN {col} TEXT")

    if not _column_exists(conn, "fetch_runs", "postings_filtered_out"):
        conn.execute("ALTER TABLE fetch_runs ADD COLUMN postings_filtered_out INTEGER NOT NULL DEFAULT 0")

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS comparison_reports (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          job_posting_id INTEGER NOT NULL,
          resume_version_id INTEGER NOT NULL,
          analysis_run_id INTEGER NOT NULL,
          source_company_input TEXT,
          source_url_input TEXT,
          evaluation_source TEXT NOT NULL DEFAULT 'local_engine' CHECK (evaluation_source IN ('chatgpt_api','local_engine')),
          chatgpt_response_json TEXT,
          applied_decision TEXT NOT NULL DEFAULT 'unknown' CHECK (applied_decision IN ('unknown','yes','no')),
          linked_application_id INTEGER,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY(job_posting_id) REFERENCES job_postings(id) ON DELETE CASCADE,
          FOREIGN KEY(resume_version_id) REFERENCES resume_versions(id) ON DELETE CASCADE,
          FOREIGN KEY(analysis_run_id) REFERENCES analysis_runs(id) ON DELETE CASCADE,
          FOREIGN KEY(linked_application_id) REFERENCES applications(id) ON DELETE SET NULL
        )
        """
    )
    if not _column_exists(conn, "comparison_reports", "evaluation_source"):
        conn.execute("ALTER TABLE comparison_reports ADD COLUMN evaluation_source TEXT NOT NULL DEFAULT 'local_engine'")
        conn.execute(
            """
            UPDATE comparison_reports
            SET evaluation_source = 'local_engine'
            WHERE evaluation_source IS NULL OR evaluation_source NOT IN ('chatgpt_api','local_engine')
            """
        )
    if not _column_exists(conn, "comparison_reports", "chatgpt_response_json"):
        conn.execute("ALTER TABLE comparison_reports ADD COLUMN chatgpt_response_json TEXT")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_comparison_reports_created ON comparison_reports(created_at DESC)")

    # --- fetch_routines table ---
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS fetch_routines (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title_keywords_json TEXT NOT NULL DEFAULT '[]',
          description_keywords_json TEXT NOT NULL DEFAULT '[]',
          keyword_match_mode TEXT NOT NULL DEFAULT 'any',
          max_role_age_days INTEGER NOT NULL DEFAULT 14,
          frequency_minutes INTEGER NOT NULL DEFAULT 720,
          company_ids_json TEXT NOT NULL DEFAULT '[]',
          use_followed_companies INTEGER NOT NULL DEFAULT 1,
          enabled INTEGER NOT NULL DEFAULT 1,
          last_run_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
        """
    )

    # --- archival / lifecycle columns on job_postings ---
    if not _column_exists(conn, "job_postings", "archived_at"):
        conn.execute("ALTER TABLE job_postings ADD COLUMN archived_at TEXT")

    if not _column_exists(conn, "job_postings", "last_viewed_at"):
        conn.execute("ALTER TABLE job_postings ADD COLUMN last_viewed_at TEXT")

    # --- team column on job_postings ---
    if not _column_exists(conn, "job_postings", "team"):
        conn.execute("ALTER TABLE job_postings ADD COLUMN team TEXT")

    # --- portal_type + portal_config on companies ---
    if not _column_exists(conn, "companies", "portal_type"):
        conn.execute("ALTER TABLE companies ADD COLUMN portal_type TEXT")

    if not _column_exists(conn, "companies", "portal_config_json"):
        conn.execute("ALTER TABLE companies ADD COLUMN portal_config_json TEXT")

    if not _column_exists(conn, "companies", "search_url"):
        conn.execute("ALTER TABLE companies ADD COLUMN search_url TEXT")

    # Fix: remove NOT NULL constraint on portal_type if present (legacy migration)
    info = conn.execute("PRAGMA table_info(companies)").fetchall()
    pt_col = next((r for r in info if r[1] == "portal_type"), None)
    if pt_col and pt_col[3] == 1:  # notnull flag is 1
        col_names = [r[1] for r in info]
        cols_csv = ", ".join(col_names)
        conn.executescript(f"""
            PRAGMA foreign_keys = OFF;
            CREATE TABLE companies_rebuild (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              name TEXT NOT NULL,
              careers_url TEXT,
              industry TEXT,
              logo_url TEXT,
              followed INTEGER NOT NULL DEFAULT 1 CHECK (followed IN (0,1)),
              notes TEXT,
              last_checked_at TEXT,
              created_at TEXT NOT NULL DEFAULT (datetime('now')),
              updated_at TEXT NOT NULL DEFAULT (datetime('now')),
              portal_type TEXT,
              portal_config_json TEXT,
              search_url TEXT,
              UNIQUE(name, careers_url)
            );
            INSERT INTO companies_rebuild ({cols_csv})
              SELECT {cols_csv} FROM companies;
            DROP TABLE companies;
            ALTER TABLE companies_rebuild RENAME TO companies;
            PRAGMA foreign_keys = ON;
        """)

    # Migrate default 'html' portal_type → NULL (unsupported)
    conn.execute("UPDATE companies SET portal_type = NULL WHERE portal_type = 'html'")

    # --- archived_at column on applications ---
    if not _column_exists(conn, "applications", "archived_at"):
        conn.execute("ALTER TABLE applications ADD COLUMN archived_at TEXT")

    # Auto-detect portal_type and search_url from careers_url
    from app.services.adapters.registry import derive_search_url, detect_portal_type  # noqa: E402

    companies = conn.execute(
        "SELECT id, careers_url, portal_type, search_url FROM companies"
    ).fetchall()
    for cid, careers_url, portal_type, search_url in companies:
        if not careers_url:
            continue
        if not portal_type:
            detected = detect_portal_type(careers_url)
            if detected:
                conn.execute("UPDATE companies SET portal_type = ? WHERE id = ?", (detected, cid))
                portal_type = detected
        if portal_type and not search_url:
            derived = derive_search_url(portal_type, careers_url)
            if derived:
                conn.execute("UPDATE companies SET search_url = ? WHERE id = ?", (derived, cid))
    # Known Greenhouse boards that can't be auto-detected from careers_url
    _GREENHOUSE_BOARDS = {"Twitch": "twitch"}
    for company_name, board_slug in _GREENHOUSE_BOARDS.items():
        row = conn.execute(
            "SELECT id, portal_type, search_url FROM companies WHERE name = ?", (company_name,)
        ).fetchone()
        if row and not row[1]:
            gh_url = f"https://boards-api.greenhouse.io/v1/boards/{board_slug}/jobs"
            conn.execute(
                "UPDATE companies SET portal_type = 'greenhouse', search_url = ? WHERE id = ?",
                (gh_url, row[0]),
            )

    # --- notifications table ---
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS notifications (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          level TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info','warning','error')),
          title TEXT NOT NULL,
          message TEXT NOT NULL,
          is_read INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0,1)),
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(is_read, created_at DESC)")

    # --- Add gemini_api to evaluation_source CHECK constraint ---
    # SQLite cannot ALTER CHECK constraints, so we recreate comparison_reports
    # if the existing check does not include 'gemini_api'.
    # Detect by checking if a gemini_api row would be rejected:
    _table_exists = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='comparison_reports'"
    ).fetchone()
    if _table_exists:
        # Check if gemini_api is already allowed
        try:
            conn.execute(
                "INSERT INTO comparison_reports (job_posting_id, resume_version_id, analysis_run_id, evaluation_source) VALUES (0, 0, 0, 'gemini_api')"
            )
            # Clean up probe row
            conn.execute("DELETE FROM comparison_reports WHERE job_posting_id = 0 AND resume_version_id = 0 AND analysis_run_id = 0")
        except Exception:
            # Need to rebuild with expanded CHECK
            _cr_info = conn.execute("PRAGMA table_info(comparison_reports)").fetchall()
            _cr_cols = [r[1] for r in _cr_info]
            _cr_csv = ", ".join(_cr_cols)
            # Add llm_response_json if missing
            _has_llm_col = "llm_response_json" in _cr_cols
            _extra_col = "" if _has_llm_col else ", llm_response_json TEXT"
            conn.executescript(f"""
                PRAGMA foreign_keys = OFF;
                CREATE TABLE comparison_reports_v2 (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  job_posting_id INTEGER NOT NULL,
                  resume_version_id INTEGER NOT NULL,
                  analysis_run_id INTEGER NOT NULL,
                  source_company_input TEXT,
                  source_url_input TEXT,
                  evaluation_source TEXT NOT NULL DEFAULT 'gemini_api' CHECK (evaluation_source IN ('chatgpt_api','local_engine','gemini_api')),
                  chatgpt_response_json TEXT,
                  applied_decision TEXT NOT NULL DEFAULT 'unknown' CHECK (applied_decision IN ('unknown','yes','no')),
                  linked_application_id INTEGER,
                  created_at TEXT NOT NULL DEFAULT (datetime('now'))
                  {_extra_col}
                );
                INSERT INTO comparison_reports_v2 ({_cr_csv})
                  SELECT {_cr_csv} FROM comparison_reports;
                DROP TABLE comparison_reports;
                ALTER TABLE comparison_reports_v2 RENAME TO comparison_reports;
                CREATE INDEX IF NOT EXISTS idx_comparison_reports_created ON comparison_reports(created_at DESC);
                PRAGMA foreign_keys = ON;
            """)

    # Add llm_response_json column to comparison_reports if missing
    if not _column_exists(conn, "comparison_reports", "llm_response_json"):
        conn.execute("ALTER TABLE comparison_reports ADD COLUMN llm_response_json TEXT")

def initialize_database() -> None:
    schema_path = Path(__file__).parent / "schema.sql"
    schema_sql = schema_path.read_text(encoding="utf-8")

    with get_connection() as conn:
        conn.executescript(schema_sql)
        _apply_runtime_migrations(conn)
        conn.commit()
