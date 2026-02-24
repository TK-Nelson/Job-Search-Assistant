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
    conn.execute("CREATE INDEX IF NOT EXISTS idx_comparison_reports_created ON comparison_reports(created_at DESC)")


def initialize_database() -> None:
    schema_path = Path(__file__).parent / "schema.sql"
    schema_sql = schema_path.read_text(encoding="utf-8")

    with get_connection() as conn:
        conn.executescript(schema_sql)
        _apply_runtime_migrations(conn)
        conn.commit()
