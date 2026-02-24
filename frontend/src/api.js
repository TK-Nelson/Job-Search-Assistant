const API_BASE = "http://localhost:8000/api/v1";

async function handleResponse(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.detail?.message || body?.detail?.code || "Request failed");
  }
  return body;
}

export function getSettings() {
  return fetch(`${API_BASE}/settings`).then(handleResponse);
}

export function saveSettings(payload) {
  return fetch(`${API_BASE}/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then(handleResponse);
}

export function validatePaths(payload) {
  return fetch(`${API_BASE}/settings/validate-paths`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then(handleResponse);
}

export function initDb() {
  return fetch(`${API_BASE}/db/init`, { method: "POST" }).then(handleResponse);
}

export function getCompanies(followed) {
  const query = typeof followed === "boolean" ? `?followed=${followed}` : "";
  return fetch(`${API_BASE}/companies${query}`).then(handleResponse);
}

export function createCompany(payload) {
  return fetch(`${API_BASE}/companies`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then(handleResponse);
}

export function updateCompany(companyId, payload) {
  return fetch(`${API_BASE}/companies/${companyId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then(handleResponse);
}

export function deleteCompany(companyId) {
  return fetch(`${API_BASE}/companies/${companyId}`, {
    method: "DELETE",
  }).then(handleResponse);
}

export function runFetchNow() {
  return fetch(`${API_BASE}/fetch/run-now`, {
    method: "POST",
  }).then(handleResponse);
}

export function getFetchRuns(limit = 20) {
  return fetch(`${API_BASE}/fetch/runs?limit=${limit}`).then(handleResponse);
}

export function getDashboardSummary() {
  return fetch(`${API_BASE}/dashboard/summary`).then(handleResponse);
}

export function getJobPostings({ companyId, status = "active", sort = "freshness", resumeVersionId, limit = 100 } = {}) {
  const params = new URLSearchParams();
  if (typeof companyId === "number") params.set("companyId", String(companyId));
  if (status) params.set("status", status);
  if (sort) params.set("sort", sort);
  if (typeof resumeVersionId === "number") params.set("resumeVersionId", String(resumeVersionId));
  if (limit) params.set("limit", String(limit));
  return fetch(`${API_BASE}/job-postings?${params.toString()}`).then(handleResponse);
}

export function getJobPosting(postingId) {
  return fetch(`${API_BASE}/job-postings/${postingId}`).then(handleResponse);
}

export function getResumes() {
  return fetch(`${API_BASE}/resumes`).then(handleResponse);
}

export function uploadResume(file) {
  const form = new FormData();
  form.append("file", file);
  return fetch(`${API_BASE}/resumes/upload`, {
    method: "POST",
    body: form,
  }).then(handleResponse);
}

export function pasteResume(payload) {
  return fetch(`${API_BASE}/resumes/paste`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then(handleResponse);
}

export function deleteResume(resumeVersionId) {
  return fetch(`${API_BASE}/resumes/${resumeVersionId}`, {
    method: "DELETE",
  }).then(handleResponse);
}

export function updateResumeNotes(resumeVersionId, notes) {
  return fetch(`${API_BASE}/resumes/${resumeVersionId}/notes`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notes }),
  }).then(handleResponse);
}

export function getResumeDiagnostics(resumeVersionId) {
  return fetch(`${API_BASE}/resumes/${resumeVersionId}/diagnostics`).then(handleResponse);
}

export function runAnalysis(payload) {
  return fetch(`${API_BASE}/analysis/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then(handleResponse);
}

export function getAnalysisRuns({ resumeVersionId, jobPostingId, limit = 50 } = {}) {
  const params = new URLSearchParams();
  if (typeof resumeVersionId === "number") params.set("resumeVersionId", String(resumeVersionId));
  if (typeof jobPostingId === "number") params.set("jobPostingId", String(jobPostingId));
  params.set("limit", String(limit));
  return fetch(`${API_BASE}/analysis/runs?${params.toString()}`).then(handleResponse);
}

export function runOptimization(payload) {
  return fetch(`${API_BASE}/optimization/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then(handleResponse);
}

export function generateCoverLetterPrompt(payload) {
  return fetch(`${API_BASE}/cover-letter/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then(handleResponse);
}

export function getApplications({ stage, companyId } = {}) {
  const params = new URLSearchParams();
  if (stage) params.set("stage", stage);
  if (typeof companyId === "number") params.set("companyId", String(companyId));
  const query = params.toString();
  return fetch(`${API_BASE}/applications${query ? `?${query}` : ""}`).then(handleResponse);
}

export function createApplication(payload) {
  return fetch(`${API_BASE}/applications`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then(handleResponse);
}

export function updateApplication(applicationId, payload) {
  return fetch(`${API_BASE}/applications/${applicationId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then(handleResponse);
}

export function updateApplicationStage(applicationId, payload) {
  return fetch(`${API_BASE}/applications/${applicationId}/stage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then(handleResponse);
}

export function getApplicationHistory(applicationId) {
  return fetch(`${API_BASE}/applications/${applicationId}/history`).then(handleResponse);
}

export function getBackups() {
  return fetch(`${API_BASE}/maintenance/backups`).then(handleResponse);
}

export function createBackup() {
  return fetch(`${API_BASE}/maintenance/backup`, { method: "POST" }).then(handleResponse);
}

export function restoreBackup(backup_name) {
  return fetch(`${API_BASE}/maintenance/restore`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ backup_name }),
  }).then(handleResponse);
}

export function runRetentionCleanup() {
  return fetch(`${API_BASE}/maintenance/cleanup`, { method: "POST" }).then(handleResponse);
}

export function runComparison(payload) {
  return fetch(`${API_BASE}/comparisons/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then(handleResponse);
}

export function getComparisons(limit = 50) {
  return fetch(`${API_BASE}/comparisons?limit=${limit}`).then(handleResponse);
}

export function getComparisonReport(comparisonReportId) {
  return fetch(`${API_BASE}/comparisons/${comparisonReportId}`).then(handleResponse);
}

export function setComparisonApplicationDecision(comparisonReportId, applied) {
  return fetch(`${API_BASE}/comparisons/${comparisonReportId}/application-decision`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ applied }),
  }).then(handleResponse);
}
