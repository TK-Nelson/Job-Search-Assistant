import { useEffect, useState } from "react";

import {
  generateCoverLetterPrompt,
  getCompanies,
  getJobPostings,
  getResumes,
  runAnalysis,
  runOptimization,
} from "../api";

function getStatusTone(message) {
  const text = String(message || "").toLowerCase();
  if (!text) return "info";
  if (text.includes("failed") || text.includes("error")) return "error";
  if (text.includes("offline") || text.includes("queued")) return "warning";
  if (
    text.includes("loaded") ||
    text.includes("completed") ||
    text.includes("generated") ||
    text.includes("copied")
  ) {
    return "success";
  }
  return "info";
}

export default function PostingsPage() {
  const [companies, setCompanies] = useState([]);
  const [resumes, setResumes] = useState([]);
  const [selectedResumeId, setSelectedResumeId] = useState("");
  const [analysisByPosting, setAnalysisByPosting] = useState({});
  const [optimizationByPosting, setOptimizationByPosting] = useState({});
  const [promptByPosting, setPromptByPosting] = useState({});
  const [postings, setPostings] = useState([]);
  const [statusText, setStatusText] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [busyActionByPosting, setBusyActionByPosting] = useState({});
  const [isApplyingFilters, setIsApplyingFilters] = useState(false);
  const [filters, setFilters] = useState({
    companyId: "",
    status: "active",
    sort: "freshness",
  });

  async function loadCompanies() {
    try {
      const response = await getCompanies();
      setCompanies(response.items || []);
    } catch (err) {
      setStatusText(`Failed to load companies: ${err.message}`);
    }
  }

  async function loadResumes() {
    try {
      const response = await getResumes();
      const items = response.items || [];
      setResumes(items);
      if (!selectedResumeId && items.length > 0) {
        setSelectedResumeId(String(items[0].id));
      }
    } catch (err) {
      setStatusText(`Failed to load resumes: ${err.message}`);
    }
  }

  async function loadPostings(nextFilters = filters) {
    setIsLoading(true);
    setStatusText("Loading postings...");
    try {
      const response = await getJobPostings({
        companyId: nextFilters.companyId ? Number(nextFilters.companyId) : undefined,
        status: nextFilters.status,
        sort: nextFilters.sort,
        resumeVersionId: selectedResumeId ? Number(selectedResumeId) : undefined,
        limit: 200,
      });
      setPostings(response.items || []);
      setStatusText(`Loaded ${response.count || 0} posting(s).`);
    } catch (err) {
      setStatusText(`Failed to load postings: ${err.message}`);
    } finally {
      setIsLoading(false);
      setIsApplyingFilters(false);
    }
  }

  useEffect(() => {
    loadCompanies();
    loadResumes();
    loadPostings();
  }, []);

  function updateFilter(key, value) {
    const next = { ...filters, [key]: value };
    setFilters(next);
  }

  function applyFilters() {
    setIsApplyingFilters(true);
    loadPostings(filters);
  }

  function setPostingBusy(postingId, action, busy) {
    setBusyActionByPosting((current) => {
      if (!busy) {
        const next = { ...current };
        delete next[postingId];
        return next;
      }
      return { ...current, [postingId]: action };
    });
  }

  async function analyzePosting(postingId) {
    if (!selectedResumeId) {
      setStatusText("Select a resume version to run analysis.");
      return;
    }

    setStatusText(`Running analysis for posting ${postingId}...`);
    setPostingBusy(postingId, "analysis", true);
    try {
      const response = await runAnalysis({
        resume_version_id: Number(selectedResumeId),
        job_posting_id: postingId,
      });
      setAnalysisByPosting((current) => ({ ...current, [postingId]: response }));
      setStatusText(`Analysis completed for posting ${postingId}.`);
      await loadPostings();
    } catch (err) {
      setStatusText(`Analysis failed: ${err.message}`);
    } finally {
      setPostingBusy(postingId, "analysis", false);
    }
  }

  async function optimizePosting(postingId) {
    if (!selectedResumeId) {
      setStatusText("Select a resume version to run optimization.");
      return;
    }

    setStatusText(`Running optimization for posting ${postingId}...`);
    setPostingBusy(postingId, "optimization", true);
    try {
      const response = await runOptimization({
        resume_version_id: Number(selectedResumeId),
        job_posting_id: postingId,
      });
      setOptimizationByPosting((current) => ({ ...current, [postingId]: response }));
      setStatusText(`Optimization completed for posting ${postingId}.`);
      await loadResumes();
    } catch (err) {
      setStatusText(`Optimization failed: ${err.message}`);
    } finally {
      setPostingBusy(postingId, "optimization", false);
    }
  }

  async function generatePrompt(postingId) {
    if (!selectedResumeId) {
      setStatusText("Select a resume version to generate a prompt.");
      return;
    }

    setStatusText(`Generating cover-letter prompt for posting ${postingId}...`);
    setPostingBusy(postingId, "prompt", true);
    try {
      const response = await generateCoverLetterPrompt({
        resume_version_id: Number(selectedResumeId),
        job_posting_id: postingId,
        tone: "professional",
        target_length_words: 300,
      });
      setPromptByPosting((current) => ({ ...current, [postingId]: response }));
      setStatusText(`Prompt generated for posting ${postingId}.`);
    } catch (err) {
      setStatusText(`Prompt generation failed: ${err.message}`);
    } finally {
      setPostingBusy(postingId, "prompt", false);
    }
  }

  async function copyPrompt(postingId) {
    const prompt = promptByPosting[postingId]?.prompt;
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt);
      setStatusText("Prompt copied to clipboard.");
    } catch {
      setStatusText("Clipboard copy failed. Copy manually from prompt text.");
    }
  }

  const statusTone = getStatusTone(statusText);

  return (
    <div className="panel">
      <h2>Postings</h2>
      <p className="muted">Browse ingested job postings and review basic match rationale.</p>

      <div className="grid">
        <label>
          Resume version
          <select value={selectedResumeId} onChange={(e) => setSelectedResumeId(e.target.value)} disabled={isLoading}>
            <option value="">Select resume</option>
            {resumes.map((resume) => (
              <option key={resume.id} value={resume.id}>
                {resume.source_name} ({resume.version_tag})
              </option>
            ))}
          </select>
        </label>
        <label>
          Company
          <select value={filters.companyId} onChange={(e) => updateFilter("companyId", e.target.value)} disabled={isLoading}>
            <option value="">All companies</option>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select value={filters.status} onChange={(e) => updateFilter("status", e.target.value)} disabled={isLoading}>
            <option value="active">Active</option>
            <option value="stale">Stale</option>
            <option value="removed">Removed</option>
          </select>
        </label>
        <label>
          Sort
          <select value={filters.sort} onChange={(e) => updateFilter("sort", e.target.value)} disabled={isLoading}>
            <option value="freshness">Freshness</option>
            <option value="match">Match</option>
          </select>
        </label>
      </div>

      <div className="actions">
        <button onClick={applyFilters} disabled={isApplyingFilters || isLoading}>
          {isApplyingFilters ? "Applying..." : "Apply filters"}
        </button>
      </div>

      {statusText && <p className={`status status--${statusTone}`}>{statusText}</p>}

      <section className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Company</th>
              <th>Title</th>
              <th>Location</th>
              <th>Match</th>
              <th>Why matched</th>
              <th>Last seen</th>
              <th>Link</th>
              <th>Analysis</th>
              <th>Optimize & Prompt</th>
            </tr>
          </thead>
          <tbody>
            {postings.map((posting) => (
              <tr key={posting.id}>
                <td>{posting.company_name}</td>
                <td>{posting.title}</td>
                <td>{posting.location || "unknown"}</td>
                <td>{posting.match_score.toFixed(2)}%</td>
                <td>{posting.why_matched}</td>
                <td>{posting.last_seen_at}</td>
                <td>
                  <a href={posting.canonical_url} target="_blank" rel="noreferrer">
                    Open
                  </a>
                </td>
                <td>
                  <button
                    onClick={() => analyzePosting(posting.id)}
                    disabled={Boolean(busyActionByPosting[posting.id])}
                  >
                    {busyActionByPosting[posting.id] === "analysis" ? "Analyzing..." : "Analyze"}
                  </button>
                  {analysisByPosting[posting.id] && (
                    <div>
                      <div>Overall: {analysisByPosting[posting.id].overall_score}%</div>
                      <div>ATS: {analysisByPosting[posting.id].sub_scores.ats_searchability}%</div>
                      <div>Hard: {analysisByPosting[posting.id].sub_scores.hard_skills}%</div>
                      <div>Soft: {analysisByPosting[posting.id].sub_scores.soft_skills}%</div>
                    </div>
                  )}
                </td>
                <td>
                  <div className="actions">
                    <button
                      onClick={() => optimizePosting(posting.id)}
                      disabled={Boolean(busyActionByPosting[posting.id])}
                    >
                      {busyActionByPosting[posting.id] === "optimization" ? "Optimizing..." : "Optimize"}
                    </button>
                    <button
                      onClick={() => generatePrompt(posting.id)}
                      disabled={Boolean(busyActionByPosting[posting.id])}
                    >
                      {busyActionByPosting[posting.id] === "prompt" ? "Generating..." : "Prompt"}
                    </button>
                  </div>
                  {optimizationByPosting[posting.id] && (
                    <div>
                      <div>New resume version: {optimizationByPosting[posting.id].output_resume_version_id}</div>
                      <div>File: {optimizationByPosting[posting.id].deterministic_name}</div>
                    </div>
                  )}
                  {promptByPosting[posting.id] && (
                    <div>
                      <button onClick={() => copyPrompt(posting.id)} disabled={Boolean(busyActionByPosting[posting.id])}>
                        Copy prompt
                      </button>
                      <textarea
                        className="prompt-box"
                        value={promptByPosting[posting.id].prompt}
                        readOnly
                        rows={6}
                      />
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {isLoading && (
              <tr>
                <td colSpan={9}>Loading postings...</td>
              </tr>
            )}
            {postings.length === 0 && !isLoading && (
              <tr>
                <td colSpan={9}>No postings found for current filters.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
