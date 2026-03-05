# Job Search Assistant (v1 scaffold)

## What is included
- FastAPI backend with:
  - `GET /api/v1/health`
  - `GET /api/v1/settings`
  - `PUT /api/v1/settings`
  - `POST /api/v1/settings/validate-paths`
  - `POST /api/v1/companies`
  - `GET /api/v1/companies`
  - `PUT /api/v1/companies/{companyId}`
  - `DELETE /api/v1/companies/{companyId}`
  - `POST /api/v1/fetch/run-now`
  - `GET /api/v1/fetch/runs`
  - `GET /api/v1/fetch/runs/{runId}`
  - `GET /api/v1/dashboard/summary`
  - `GET /api/v1/job-postings`
  - `GET /api/v1/job-postings/{postingId}`
  - `GET /api/v1/resumes`
  - `GET /api/v1/resumes/{resumeVersionId}`
  - `POST /api/v1/db/init`
  - `POST /api/v1/resumes/upload` (DOCX-only)
  - `POST /api/v1/analysis/run`
  - `GET /api/v1/analysis/runs`
  - `POST /api/v1/optimization/run`
  - `POST /api/v1/cover-letter/prompt`
  - `POST /api/v1/applications`
  - `GET /api/v1/applications`
  - `PUT /api/v1/applications/{applicationId}`
  - `POST /api/v1/applications/{applicationId}/stage`
  - `GET /api/v1/applications/{applicationId}/history`
  - `GET /api/v1/maintenance/backups`
  - `POST /api/v1/maintenance/backup`
  - `POST /api/v1/maintenance/restore`
  - `POST /api/v1/maintenance/cleanup`
  - `GET /api/v1/metrics/summary`
  - `GET /api/v1/audit-events`
- SQLite schema initialization from `backend/app/db/schema.sql`
- React frontend with a Settings page (`/settings`) to edit and validate runtime settings
- Initial ingestion pass: fetches followed company career pages and upserts likely job links into `job_postings`

## Defaults (non-OneDrive)
- Runtime data root defaults to `%LOCALAPPDATA%/JobSearchAssistant`
- Database and artifact paths default under that root

## Repo-local runtime mode (recommended for local portability)
- Running `scripts/start-backend.ps1` sets `JOB_SEARCH_ASSISTANT_RUNTIME_ROOT` to `job-search-assistant/.runtime`.
- Logs, DB, backups, and local config are then stored under `.runtime/` inside this repo folder.
- On first run, if `.runtime/data/job_assistant.db` is missing and `%LOCALAPPDATA%/JobSearchAssistant/data/job_assistant.db` exists, the script copies runtime data into `.runtime` automatically.
- `.runtime/` is gitignored to keep sensitive/local artifacts out of GitHub.

## Backend run
1. `cd job-search-assistant/backend`
2. `python -m venv .venv`
3. `.venv\Scripts\activate`
4. `pip install -r requirements.txt`
5. `python -m app.db.migrate`
6. `uvicorn app.main:app --reload --port 8000`

## Frontend run
1. `cd job-search-assistant/frontend`
2. `npm install`
3. `npm run dev`

Frontend expects backend at `http://localhost:8000`.

The `Postings` page supports company/status filtering, resume-aware match sorting, analysis-backed "why matched" snippets, and one-click analysis against the selected resume version.

Automatic maintenance is enabled on backend startup:
- Daily backup job (every 24 hours)
- Daily retention cleanup job (every 24 hours)

Offline behavior:
- A global offline banner is shown when network connectivity is unavailable.
- Local dashboard/history/analysis views remain usable.
- `Run fetch now` is queued while offline and retried automatically when the browser goes back online.

Performance instrumentation:
- Request latency metrics are collected in-memory and exposed at `GET /api/v1/metrics/summary`.
- Budget warnings are generated for dashboard, analysis, and fetch endpoints when p95 exceeds target.
- Run benchmark script: `python backend/scripts/benchmark.py --base-url http://localhost:8000 --iterations 5`

## Audits and Logs

### Structured logs
- Log file path: `%LOCALAPPDATA%\JobSearchAssistant\logs\app.log`
- Log format: JSON lines with `timestamp`, `level`, `message`, `module`, `correlation_id`, `entity_type`, `entity_id`
- Every HTTP response includes `X-Correlation-ID` so you can trace request-to-log entries.

PowerShell examples:
- `Get-Content "$env:LOCALAPPDATA\JobSearchAssistant\logs\app.log" -Tail 50`
- `Get-Content "$env:LOCALAPPDATA\JobSearchAssistant\logs\app.log" | Select-String "optimization.run|analysis.run|fetch.run"`

### Audit events
- API endpoint: `GET /api/v1/audit-events`
- Filters: `eventType` and `limit`

Examples:
- `http://localhost:8000/api/v1/audit-events?limit=100`
- `http://localhost:8000/api/v1/audit-events?eventType=optimization.run&limit=50`

Audit events currently recorded for:
- `analysis.run`
- `optimization.run`
- `fetch.run`

Security defaults:
- Resume and optimized resume artifacts are encrypted at rest when `encrypt_artifacts=true`.
- Encryption keys are provisioned via OS credential storage through `keyring` (Windows Credential Manager on Windows).
- Health endpoint reports `secret_store_ready`.

## One-click launcher (Windows)
From `job-search-assistant/scripts` run:

`powershell -ExecutionPolicy Bypass -File .\create-desktop-shortcut.ps1`

This creates a Desktop shortcut named **Job Search Assistant** that launches backend and frontend in separate terminals.

Launcher hardening notes:
- The launcher now checks for existing backend/frontend processes and skips duplicate starts.
- Backend startup checks port `8000` before launch and exits with a clear conflict error if the port is occupied.
- Frontend startup checks port `5173` and skips duplicate dev server starts.
- Backend `--reload` is disabled by default in launcher mode to reduce orphan child processes.
- To enable backend auto-reload explicitly, set environment variable `JSA_BACKEND_RELOAD=1` before starting.
