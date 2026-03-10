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

    # --- portal_type + portal_config on companies ---
    if not _column_exists(conn, "companies", "portal_type"):
        conn.execute("ALTER TABLE companies ADD COLUMN portal_type TEXT NOT NULL DEFAULT 'html'")

    if not _column_exists(conn, "companies", "portal_config_json"):
        conn.execute("ALTER TABLE companies ADD COLUMN portal_config_json TEXT")

    # --- Make careers_url nullable (was NOT NULL) ---
    info = conn.execute("PRAGMA table_info(companies)").fetchall()
    careers_col = next((r for r in info if r[1] == "careers_url"), None)
    if careers_col and careers_col[3] == 1:  # notnull flag is 1
        # Collect current column names so we INSERT the right set
        col_names = [r[1] for r in info]
        cols_csv = ", ".join(col_names)
        conn.executescript(f"""
            PRAGMA foreign_keys = OFF;
            CREATE TABLE companies_new (
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
              portal_type TEXT NOT NULL DEFAULT 'html',
              portal_config_json TEXT,
              UNIQUE(name, careers_url)
            );
            INSERT INTO companies_new ({cols_csv})
              SELECT {cols_csv} FROM companies;
            DROP TABLE companies;
            ALTER TABLE companies_new RENAME TO companies;
            PRAGMA foreign_keys = ON;
        """)


def initialize_database() -> None:
    schema_path = Path(__file__).parent / "schema.sql"
    schema_sql = schema_path.read_text(encoding="utf-8")

    with get_connection() as conn:
        conn.executescript(schema_sql)
        _apply_runtime_migrations(conn)
        conn.commit()
