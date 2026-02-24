import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { getCompanies, getDashboardSummary, getFetchRuns, getResumes, runComparison, runFetchNow, uploadResume } from "../api";

const QUEUED_FETCH_KEY = "job_assistant.fetch_run_queued";

function getStatusTone(message) {
  const text = String(message || "").toLowerCase();
  if (!text) return "info";
  if (text.includes("failed") || text.includes("error")) return "error";
  if (text.includes("offline") || text.includes("queued")) return "warning";
  if (text.includes("completed") || text.includes("restored") || text.includes("loaded")) return "success";
  return "info";
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const [runs, setRuns] = useState([]);
  const [summary, setSummary] = useState(null);
  const [status, setStatus] = useState("");
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [companies, setCompanies] = useState([]);
  const [resumes, setResumes] = useState([]);
  const [comparisonForm, setComparisonForm] = useState({
    sourceText: "",
    sourceUrl: "",
    title: "",
    descriptionText: "",
    resumeVersionId: "",
  });
  const [uploadFile, setUploadFile] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isRunningNow, setIsRunningNow] = useState(false);
  const [isLoadingRuns, setIsLoadingRuns] = useState(true);
  const [isRunningComparison, setIsRunningComparison] = useState(false);
  const [isUploadingResume, setIsUploadingResume] = useState(false);

  async function loadSummary() {
    try {
      const result = await getDashboardSummary();
      setSummary(result);
    } catch (err) {
      setStatus(`Failed to load dashboard summary: ${err.message}`);
    }
  }

  async function loadRuns() {
    setIsLoadingRuns(true);
    try {
      const result = await getFetchRuns(20);
      setRuns(result.items || []);
      setStatus(`Loaded ${result.items?.length || 0} fetch run(s).`);
    } catch (err) {
      setStatus(`Failed to load fetch runs: ${err.message}`);
    } finally {
      setIsLoadingRuns(false);
    }
  }

  async function loadCompanies() {
    try {
      const result = await getCompanies();
      setCompanies(result.items || []);
    } catch (err) {
      setStatus(`Failed to load companies: ${err.message}`);
    }
  }

  async function loadResumes() {
    try {
      const result = await getResumes();
      const items = result.items || [];
      setResumes(items);
      setComparisonForm((current) => {
        if (current.resumeVersionId || items.length === 0) return current;
        return { ...current, resumeVersionId: String(items[0].id) };
      });
    } catch (err) {
      setStatus(`Failed to load resumes: ${err.message}`);
    }
  }

  useEffect(() => {
    const onOnline = async () => {
      setIsOnline(true);
      const queued = localStorage.getItem(QUEUED_FETCH_KEY) === "1";
      if (queued) {
        setStatus("Connection restored. Running queued fetch...");
        try {
          await runFetchNow();
          localStorage.removeItem(QUEUED_FETCH_KEY);
          setStatus("Queued fetch completed.");
          await loadSummary();
          await loadRuns();
        } catch (err) {
          setStatus(`Queued fetch failed: ${err.message}`);
        }
      }
    };
    const onOffline = () => {
      setIsOnline(false);
      setStatus("Offline: fetch operations will be queued and retried when online.");
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    loadSummary();
    loadRuns();
    loadCompanies();
    loadResumes();

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  async function onRunNow() {
    if (summary && Number(summary.followed_companies_count || 0) <= 0) {
      setStatus("Add at least one followed company before running fetch.");
      return;
    }

    if (!navigator.onLine) {
      localStorage.setItem(QUEUED_FETCH_KEY, "1");
      setStatus("Offline: fetch request queued. It will run automatically when connection is restored.");
      return;
    }

    setIsRunningNow(true);
    setStatus("Running fetch now...");
    try {
      await runFetchNow();
      localStorage.removeItem(QUEUED_FETCH_KEY);
      setStatus("Fetch run completed.");
      await loadSummary();
      await loadRuns();
    } catch (err) {
      setStatus(`Fetch failed: ${err.message}`);
    } finally {
      setIsRunningNow(false);
    }
  }

  async function onRefresh() {
    setIsRefreshing(true);
    setStatus("Refreshing dashboard...");
    try {
      await loadSummary();
      await loadRuns();
    } finally {
      setIsRefreshing(false);
    }
  }

  function updateComparisonField(key, value) {
    setComparisonForm((current) => ({ ...current, [key]: value }));
  }

  async function onUploadResumeInline(event) {
    event.preventDefault();
    if (!uploadFile) {
      setStatus("Select a DOCX file first.");
      return;
    }

    setIsUploadingResume(true);
    setStatus("Uploading resume...");
    try {
      const result = await uploadResume(uploadFile);
      setUploadFile(null);
      await loadResumes();
      if (result.resume_version_id) {
        updateComparisonField("resumeVersionId", String(result.resume_version_id));
      }
      setStatus("Resume uploaded and selected for comparison.");
    } catch (err) {
      setStatus(`Resume upload failed: ${err.message}`);
    } finally {
      setIsUploadingResume(false);
    }
  }

  async function onRunComparison(event) {
    event.preventDefault();

    if (!comparisonForm.resumeVersionId) {
      setStatus("Select or upload a resume before running comparison.");
      return;
    }

    if ((comparisonForm.descriptionText || "").trim().length < 40) {
      setStatus("Paste a fuller job description (at least 40 characters).");
      return;
    }

    const sourceText = (comparisonForm.sourceText || "").trim();
    const selectedCompany = companies.find((company) => company.name.toLowerCase() === sourceText.toLowerCase());

    if (!selectedCompany && !sourceText) {
      setStatus("Select a source company or type a company name.");
      return;
    }

    setIsRunningComparison(true);
    setStatus("Running job description comparison...");

    try {
      const payload = {
        source_company_id: selectedCompany ? selectedCompany.id : undefined,
        source_company_name: selectedCompany ? undefined : sourceText,
        source_url: (comparisonForm.sourceUrl || "").trim() || undefined,
        title: (comparisonForm.title || "").trim() || "Untitled role",
        description_text: comparisonForm.descriptionText,
        resume_version_id: Number(comparisonForm.resumeVersionId),
      };
      const result = await runComparison(payload);
      setStatus("Comparison complete. Opening report...");
      navigate(`/comparisons/${result.comparison_report_id}`);
    } catch (err) {
      setStatus(`Comparison failed: ${err.message}`);
    } finally {
      setIsRunningComparison(false);
    }
  }

  const latest = runs[0];
  const statusTone = getStatusTone(status);

  return (
    <div className="panel">
      <h2>Dashboard</h2>
      <p className="muted">Fetch pipeline status and direct job-description comparison workflow.</p>

      <div className="actions">
        <button onClick={onRunNow} disabled={isRunningNow}>
          {isRunningNow ? "Running..." : "Run fetch now"}
        </button>
        <button onClick={onRefresh} disabled={isRefreshing || isRunningNow}>
          {isRefreshing ? "Refreshing..." : "Refresh"}
        </button>
        {!isOnline && <span className="muted">Offline</span>}
      </div>

      {status && <p className={`status status--${statusTone}`}>{status}</p>}

      <div className="dashboard-grid">
        <section className="dashboard-main">
          <div className="card">
            <div className="card-label">New Roles From Followed</div>
            <div className="card-value">{summary?.new_roles_from_followed_last_run ?? 0}</div>
            <div className="muted small-text">
              {summary?.latest_fetch_run_id
                ? `From fetch run #${summary.latest_fetch_run_id}${summary.latest_fetch_completed_at ? ` (${summary.latest_fetch_completed_at})` : ""}`
                : "No completed fetch run yet."}
            </div>
          </div>

          {summary && (
            <section className="cards-grid">
              <div className="card">
                <div className="card-label">Applications</div>
                <div className="card-value">{summary.applications_total_count}</div>
              </div>
              <div className="card">
                <div className="card-label">Followed Companies</div>
                <div className="card-value">{summary.followed_companies_count}</div>
              </div>
              <div className="card">
                <div className="card-label">Active Postings</div>
                <div className="card-value">{summary.active_postings_count}</div>
              </div>
              <div className="card">
                <div className="card-label">New Postings (7d)</div>
                <div className="card-value">{summary.recent_postings_count_7d}</div>
              </div>
            </section>
          )}

          {summary && (
            <section className="panel nested">
              <h3>Applications by Stage</h3>
              {summary.applications_by_stage.length > 0 ? (
                <div className="kv-grid">
                  {summary.applications_by_stage.map((item) => (
                    <div key={item.stage}>
                      <strong>{item.stage}:</strong> {item.count}
                    </div>
                  ))}
                </div>
              ) : (
                <p>No applications yet.</p>
              )}
            </section>
          )}

          <section className="panel nested">
            <h3>Latest Fetch Run</h3>
            {latest ? (
              <div className="kv-grid">
                <div>
                  <strong>Run ID:</strong> {latest.id}
                </div>
                <div>
                  <strong>Status:</strong> {latest.status}
                </div>
                <div>
                  <strong>Started:</strong> {latest.started_at}
                </div>
                <div>
                  <strong>Completed:</strong> {latest.completed_at || "-"}
                </div>
                <div>
                  <strong>Companies Checked:</strong> {latest.companies_checked}
                </div>
                <div>
                  <strong>New/Updated/Skipped/Filtered:</strong> {latest.postings_new}/{latest.postings_updated}/{latest.postings_skipped}/{latest.postings_filtered_out || 0}
                </div>
              </div>
            ) : (
              <p>No fetch runs yet.</p>
            )}
          </section>

          <section className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Status</th>
                  <th>Started</th>
                  <th>Completed</th>
                  <th>Companies</th>
                  <th>New</th>
                  <th>Updated</th>
                  <th>Skipped</th>
                  <th>Filtered</th>
                  <th>Errors</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td>{run.id}</td>
                    <td>{run.status}</td>
                    <td>{run.started_at}</td>
                    <td>{run.completed_at || "-"}</td>
                    <td>{run.companies_checked}</td>
                    <td>{run.postings_new}</td>
                    <td>{run.postings_updated}</td>
                    <td>{run.postings_skipped}</td>
                    <td>{run.postings_filtered_out || 0}</td>
                    <td>{run.errors_json}</td>
                  </tr>
                ))}
                {isLoadingRuns && (
                  <tr>
                    <td colSpan={10}>Loading run history...</td>
                  </tr>
                )}
                {runs.length === 0 && !isLoadingRuns && (
                  <tr>
                    <td colSpan={10}>No run history yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        </section>

        <aside className="dashboard-rail panel nested">
          <h3>Job Description Comparison</h3>
          <p className="muted">Paste a role description and evaluate it against a selected resume version.</p>

          <form className="grid" onSubmit={onRunComparison}>
            <label>
              Source
              <input
                list="company-sources"
                value={comparisonForm.sourceText}
                onChange={(event) => updateComparisonField("sourceText", event.target.value)}
                placeholder="Type or select company"
                disabled={isRunningComparison}
              />
              <datalist id="company-sources">
                {companies.map((company) => (
                  <option key={company.id} value={company.name} />
                ))}
              </datalist>
            </label>

            <label>
              URL
              <input
                type="url"
                value={comparisonForm.sourceUrl}
                onChange={(event) => updateComparisonField("sourceUrl", event.target.value)}
                placeholder="https://..."
                disabled={isRunningComparison}
              />
            </label>

            <label>
              Role title
              <input
                value={comparisonForm.title}
                onChange={(event) => updateComparisonField("title", event.target.value)}
                placeholder="Backend Engineer"
                disabled={isRunningComparison}
              />
            </label>

            <label>
              Job description
              <textarea
                className="prompt-box"
                rows={10}
                value={comparisonForm.descriptionText}
                onChange={(event) => updateComparisonField("descriptionText", event.target.value)}
                placeholder="Paste full job description"
                disabled={isRunningComparison}
              />
            </label>

            <label>
              Compare against resume
              <select
                value={comparisonForm.resumeVersionId}
                onChange={(event) => updateComparisonField("resumeVersionId", event.target.value)}
                disabled={isRunningComparison || isUploadingResume}
              >
                <option value="">Select resume</option>
                {resumes.map((resume) => (
                  <option key={resume.id} value={resume.id}>
                    {resume.source_name} ({resume.version_tag})
                  </option>
                ))}
              </select>
            </label>

            <div className="upload-inline">
              <label>
                Or upload new DOCX
                <input
                  type="file"
                  accept=".docx"
                  onChange={(event) => setUploadFile(event.target.files?.[0] || null)}
                  disabled={isUploadingResume || isRunningComparison}
                />
              </label>
              <button type="button" onClick={onUploadResumeInline} disabled={isUploadingResume || isRunningComparison || !uploadFile}>
                {isUploadingResume ? "Uploading..." : "Upload & Select"}
              </button>
            </div>

            <div className="actions">
              <button type="submit" disabled={isRunningComparison || isUploadingResume}>
                {isRunningComparison ? "Evaluating..." : "Run Evaluation"}
              </button>
            </div>
          </form>
        </aside>
      </div>
    </div>
  );
}
