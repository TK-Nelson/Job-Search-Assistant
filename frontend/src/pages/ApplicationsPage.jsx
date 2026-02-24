import { useEffect, useState } from "react";

import {
  createApplication,
  getApplicationHistory,
  getApplications,
  getJobPostings,
  updateApplicationStage,
} from "../api";

const STAGES = ["saved", "applied", "phone_screen", "interview", "offer", "rejected", "withdrawn"];

function getStatusTone(message) {
  const text = String(message || "").toLowerCase();
  if (!text) return "info";
  if (text.includes("failed") || text.includes("error")) return "error";
  if (text.includes("loaded") || text.includes("updated") || text.includes("created") || text.includes("completed")) {
    return "success";
  }
  return "info";
}

export default function ApplicationsPage() {
  const [applications, setApplications] = useState([]);
  const [postings, setPostings] = useState([]);
  const [historyByApp, setHistoryByApp] = useState({});
  const [statusText, setStatusText] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [busyStageAppId, setBusyStageAppId] = useState(null);
  const [filterStage, setFilterStage] = useState("");
  const [form, setForm] = useState({
    job_posting_id: "",
    stage: "saved",
    applied_at: "",
    target_salary: "",
    notes: "",
  });

  async function loadPostings() {
    try {
      const response = await getJobPostings({ limit: 300, status: "active" });
      setPostings(response.items || []);
    } catch (err) {
      setStatusText(`Failed to load postings: ${err.message}`);
    }
  }

  async function loadApplications(stage = filterStage) {
    setIsLoading(true);
    try {
      const response = await getApplications({ stage: stage || undefined });
      setApplications(response.items || []);
      setStatusText(`Loaded ${response.count || 0} application(s).`);
    } catch (err) {
      setStatusText(`Failed to load applications: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadPostings();
    loadApplications();
  }, []);

  async function onCreate(event) {
    event.preventDefault();
    if (!form.job_posting_id) {
      setStatusText("Choose a posting before creating an application.");
      return;
    }

    setIsCreating(true);
    setStatusText("Creating application...");
    try {
      await createApplication({
        job_posting_id: Number(form.job_posting_id),
        stage: form.stage,
        applied_at: form.applied_at || null,
        target_salary: form.target_salary || null,
        notes: form.notes || null,
      });
      setStatusText("Application created.");
      setForm({ job_posting_id: "", stage: "saved", applied_at: "", target_salary: "", notes: "" });
      await loadApplications();
    } catch (err) {
      setStatusText(`Create failed: ${err.message}`);
    } finally {
      setIsCreating(false);
    }
  }

  async function onQuickStageUpdate(applicationId, nextStage) {
    setBusyStageAppId(applicationId);
    setStatusText(`Updating stage to ${nextStage}...`);
    try {
      await updateApplicationStage(applicationId, { to_stage: nextStage, reason: "quick update" });
      setStatusText("Stage updated.");
      await loadApplications();
    } catch (err) {
      setStatusText(`Stage update failed: ${err.message}`);
    } finally {
      setBusyStageAppId(null);
    }
  }

  async function onViewHistory(applicationId) {
    try {
      const response = await getApplicationHistory(applicationId);
      setHistoryByApp((current) => ({ ...current, [applicationId]: response.items || [] }));
    } catch (err) {
      setStatusText(`History load failed: ${err.message}`);
    }
  }

  const statusTone = getStatusTone(statusText);

  return (
    <div className="panel">
      <h2>Applications</h2>
      <p className="muted">Track application stages and stage history by job posting.</p>

      <form className="grid" onSubmit={onCreate}>
        <label>
          Job posting
          <select
            value={form.job_posting_id}
            onChange={(e) => setForm((x) => ({ ...x, job_posting_id: e.target.value }))}
            disabled={isCreating}
          >
            <option value="">Select posting</option>
            {postings.map((posting) => (
              <option key={posting.id} value={posting.id}>
                {posting.company_name} - {posting.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Stage
          <select value={form.stage} onChange={(e) => setForm((x) => ({ ...x, stage: e.target.value }))} disabled={isCreating}>
            {STAGES.map((stage) => (
              <option key={stage} value={stage}>
                {stage}
              </option>
            ))}
          </select>
        </label>
        <label>
          Applied at
          <input
            type="date"
            value={form.applied_at}
            onChange={(e) => setForm((x) => ({ ...x, applied_at: e.target.value }))}
            disabled={isCreating}
          />
        </label>
        <label>
          Target salary
          <input
            value={form.target_salary}
            onChange={(e) => setForm((x) => ({ ...x, target_salary: e.target.value }))}
            disabled={isCreating}
          />
        </label>
        <label>
          Notes
          <input value={form.notes} onChange={(e) => setForm((x) => ({ ...x, notes: e.target.value }))} disabled={isCreating} />
        </label>
        <div className="actions">
          <button type="submit" disabled={isCreating}>
            {isCreating ? "Creating..." : "Create application"}
          </button>
        </div>
      </form>

      <div className="actions">
        <label>
          Filter by stage
          <select value={filterStage} onChange={(e) => setFilterStage(e.target.value)}>
            <option value="">All</option>
            {STAGES.map((stage) => (
              <option key={stage} value={stage}>
                {stage}
              </option>
            ))}
          </select>
        </label>
        <button onClick={() => loadApplications(filterStage)} disabled={isLoading || isCreating}>
          {isLoading ? "Loading..." : "Apply filter"}
        </button>
      </div>

      {statusText && <p className={`status status--${statusTone}`}>{statusText}</p>}

      <section className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Company</th>
              <th>Role</th>
              <th>Stage</th>
              <th>Applied</th>
              <th>Salary</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {applications.map((app) => (
              <tr key={app.id}>
                <td>{app.company_name}</td>
                <td>{app.posting_title}</td>
                <td>{app.stage}</td>
                <td>{app.applied_at || "-"}</td>
                <td>{app.target_salary || "-"}</td>
                <td>
                  <div className="actions">
                    {STAGES.filter((stage) => stage !== app.stage)
                      .slice(0, 3)
                      .map((stage) => (
                        <button key={stage} onClick={() => onQuickStageUpdate(app.id, stage)} disabled={busyStageAppId === app.id}>
                          → {stage}
                        </button>
                      ))}
                    <button onClick={() => onViewHistory(app.id)} disabled={busyStageAppId === app.id}>
                      {busyStageAppId === app.id ? "Updating..." : "History"}
                    </button>
                  </div>
                  {historyByApp[app.id] && historyByApp[app.id].length > 0 && (
                    <div className="history-box">
                      {historyByApp[app.id].slice(0, 5).map((item) => (
                        <div key={item.id}>
                          {item.changed_at}: {item.from_stage || "start"} → {item.to_stage}
                        </div>
                      ))}
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {isLoading && (
              <tr>
                <td colSpan={6}>Loading applications...</td>
              </tr>
            )}
            {applications.length === 0 && !isLoading && (
              <tr>
                <td colSpan={6}>No applications yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
