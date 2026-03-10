PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS companies (
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
  UNIQUE(name, careers_url)
);

CREATE TABLE IF NOT EXISTS job_postings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  location TEXT,
  posted_date TEXT,
  canonical_url TEXT NOT NULL,
  source_url TEXT NOT NULL,
  description_text TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  parser_confidence REAL NOT NULL DEFAULT 0.0 CHECK (parser_confidence >= 0 AND parser_confidence <= 1),
  parser_quality_flag TEXT NOT NULL DEFAULT 'ok' CHECK (parser_quality_flag IN ('ok','low_confidence','partial')),
  source_kind TEXT NOT NULL DEFAULT 'fetched' CHECK (source_kind IN ('fetched','manual_paste')),
  created_via TEXT NOT NULL DEFAULT 'ingestion' CHECK (created_via IN ('ingestion','comparison_input')),
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','stale','removed')),
  salary_range TEXT,
  seniority_level TEXT,
  workplace_type TEXT,
  years_experience TEXT,
  commitment_type TEXT,
  FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE,
  UNIQUE(fingerprint)
);

CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_posting_id INTEGER NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('saved','applied','phone_screen','interview','offer','rejected','withdrawn')),
  applied_at TEXT,
  target_salary TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(job_posting_id) REFERENCES job_postings(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS application_stage_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL,
  from_stage TEXT,
  to_stage TEXT NOT NULL,
  changed_at TEXT NOT NULL DEFAULT (datetime('now')),
  reason TEXT,
  FOREIGN KEY(application_id) REFERENCES applications(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS resume_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_name TEXT NOT NULL,
  version_tag TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK (mime_type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
  file_ext TEXT NOT NULL CHECK (file_ext = '.docx'),
  file_path TEXT NOT NULL,
  checksum_sha256 TEXT NOT NULL,
  extracted_text TEXT,
  sections_json TEXT,
  notes TEXT,
  parser_confidence REAL NOT NULL DEFAULT 0.0 CHECK (parser_confidence >= 0 AND parser_confidence <= 1),
  parent_resume_version_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(parent_resume_version_id) REFERENCES resume_versions(id),
  UNIQUE(source_name, version_tag)
);

CREATE TABLE IF NOT EXISTS analysis_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  resume_version_id INTEGER NOT NULL,
  job_posting_id INTEGER NOT NULL,
  overall_score REAL NOT NULL CHECK (overall_score >= 0 AND overall_score <= 100),
  ats_score REAL NOT NULL CHECK (ats_score >= 0 AND ats_score <= 100),
  hard_skills_score REAL NOT NULL CHECK (hard_skills_score >= 0 AND hard_skills_score <= 100),
  soft_skills_score REAL NOT NULL CHECK (soft_skills_score >= 0 AND soft_skills_score <= 100),
  weights_json TEXT NOT NULL,
  matched_keywords_json TEXT NOT NULL,
  missing_keywords_json TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  parser_quality_flag TEXT NOT NULL CHECK (parser_quality_flag IN ('ok','low_confidence','partial')),
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(resume_version_id) REFERENCES resume_versions(id) ON DELETE CASCADE,
  FOREIGN KEY(job_posting_id) REFERENCES job_postings(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS optimized_artifacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_resume_version_id INTEGER NOT NULL,
  output_resume_version_id INTEGER NOT NULL,
  output_file_path TEXT NOT NULL,
  suggestion_summary_json TEXT NOT NULL,
  deterministic_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(source_resume_version_id) REFERENCES resume_versions(id) ON DELETE CASCADE,
  FOREIGN KEY(output_resume_version_id) REFERENCES resume_versions(id) ON DELETE CASCADE,
  UNIQUE(deterministic_name)
);

CREATE TABLE IF NOT EXISTS fetch_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('running','success','partial_failure','failure')),
  companies_checked INTEGER NOT NULL DEFAULT 0,
  postings_new INTEGER NOT NULL DEFAULT 0,
  postings_updated INTEGER NOT NULL DEFAULT 0,
  postings_skipped INTEGER NOT NULL DEFAULT 0,
  postings_filtered_out INTEGER NOT NULL DEFAULT 0,
  errors_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS fetch_routines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title_keywords_json TEXT NOT NULL DEFAULT '[]',
  description_keywords_json TEXT NOT NULL DEFAULT '[]',
  keyword_match_mode TEXT NOT NULL DEFAULT 'any' CHECK (keyword_match_mode IN ('any','all')),
  max_role_age_days INTEGER NOT NULL DEFAULT 14,
  frequency_minutes INTEGER NOT NULL DEFAULT 720,
  company_ids_json TEXT NOT NULL DEFAULT '[]',
  use_followed_companies INTEGER NOT NULL DEFAULT 1 CHECK (use_followed_companies IN (0,1)),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  last_run_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

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
);

CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  correlation_id TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_job_postings_company_last_seen ON job_postings(company_id, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_postings_status ON job_postings(status);
CREATE INDEX IF NOT EXISTS idx_applications_stage ON applications(stage);
CREATE INDEX IF NOT EXISTS idx_analysis_runs_resume_job ON analysis_runs(resume_version_id, job_posting_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fetch_runs_started ON fetch_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_corr ON audit_events(correlation_id);
CREATE INDEX IF NOT EXISTS idx_comparison_reports_created ON comparison_reports(created_at DESC);
