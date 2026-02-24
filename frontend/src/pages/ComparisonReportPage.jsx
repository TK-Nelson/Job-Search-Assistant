import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { getComparisonReport, setComparisonApplicationDecision } from "../api";

function getStatusTone(message) {
  const text = String(message || "").toLowerCase();
  if (!text) return "info";
  if (text.includes("failed") || text.includes("error")) return "error";
  if (text.includes("saved") || text.includes("applied") || text.includes("loaded") || text.includes("updated")) {
    return "success";
  }
  return "info";
}

export default function ComparisonReportPage() {
  const { comparisonReportId } = useParams();
  const navigate = useNavigate();
  const [report, setReport] = useState(null);
  const [statusText, setStatusText] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingDecision, setIsSavingDecision] = useState(false);

  async function loadReport() {
    setIsLoading(true);
    try {
      const result = await getComparisonReport(comparisonReportId);
      setReport(result);
      setStatusText("Comparison report loaded.");
    } catch (err) {
      setStatusText(`Failed to load comparison report: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadReport();
  }, [comparisonReportId]);

  async function onDecision(applied) {
    setIsSavingDecision(true);
    setStatusText(applied ? "Saving application decision..." : "Recording decision...");
    try {
      const result = await setComparisonApplicationDecision(comparisonReportId, applied);
      setStatusText(applied ? "Application decision saved. Role linked to applications log." : "Marked as not applied.");
      await loadReport();
      if (applied && result.application_id) {
        setStatusText(`Application logged (ID ${result.application_id}).`);
      }
    } catch (err) {
      setStatusText(`Failed to save decision: ${err.message}`);
    } finally {
      setIsSavingDecision(false);
    }
  }

  const statusTone = getStatusTone(statusText);

  return (
    <div className="panel">
      <div className="actions">
        <button type="button" onClick={() => navigate("/dashboard")}>Back to dashboard</button>
      </div>

      <h2>Comparison Report</h2>
      <p className="muted">Review the evaluation and log whether you applied to this job.</p>

      {statusText && <p className={`status status--${statusTone}`}>{statusText}</p>}

      {isLoading && <p>Loading comparison report...</p>}

      {!isLoading && report && (
        <>
          <section className="panel nested">
            <div className="comparison-toolbar">
              <strong>Did you apply to this job?</strong>
              <div className="actions">
                <button type="button" disabled={isSavingDecision} onClick={() => onDecision(true)}>
                  {isSavingDecision ? "Saving..." : "Yes"}
                </button>
                <button type="button" disabled={isSavingDecision} onClick={() => onDecision(false)}>
                  No
                </button>
              </div>
            </div>
            <div className="kv-grid">
              <div>
                <strong>Company:</strong> {report.company_name}
              </div>
              <div>
                <strong>Role:</strong> {report.title}
              </div>
              <div>
                <strong>Applied decision:</strong> {report.applied_decision}
              </div>
              <div>
                <strong>Application link:</strong> {report.linked_application_id || "-"}
              </div>
              <div>
                <strong>Report created:</strong> {report.created_at}
              </div>
              <div>
                <strong>Role URL:</strong>{" "}
                <a href={report.source_url_input || report.canonical_url} target="_blank" rel="noreferrer">
                  Open role
                </a>
              </div>
            </div>
          </section>

          <section className="panel nested">
            <h3>Scores</h3>
            <div className="kv-grid">
              <div>
                <strong>Overall:</strong> {report.analysis.overall_score}%
              </div>
              <div>
                <strong>ATS/Searchability:</strong> {report.analysis.sub_scores.ats_searchability}%
              </div>
              <div>
                <strong>Hard Skills:</strong> {report.analysis.sub_scores.hard_skills}%
              </div>
              <div>
                <strong>Soft Skills:</strong> {report.analysis.sub_scores.soft_skills}%
              </div>
              <div>
                <strong>Confidence:</strong> {report.analysis.confidence}
              </div>
              <div>
                <strong>Parser quality:</strong> {report.analysis.parser_quality_flag}
              </div>
            </div>
          </section>

          <section className="panel nested">
            <h3>Matched Keywords</h3>
            <p>
              <strong>Hard:</strong> {report.analysis.matched_keywords.hard.join(", ") || "-"}
            </p>
            <p>
              <strong>Soft:</strong> {report.analysis.matched_keywords.soft.join(", ") || "-"}
            </p>
          </section>

          <section className="panel nested">
            <h3>Missing Keywords</h3>
            <p>
              <strong>Hard:</strong> {report.analysis.missing_keywords.hard.join(", ") || "-"}
            </p>
            <p>
              <strong>Soft:</strong> {report.analysis.missing_keywords.soft.join(", ") || "-"}
            </p>
          </section>

          <section className="panel nested">
            <h3>Evidence</h3>
            {report.analysis.evidence.length > 0 ? (
              <div className="history-box">
                {report.analysis.evidence.map((item, idx) => (
                  <div key={`${item.keyword}-${idx}`}>
                    <strong>{item.category}</strong> · <strong>{item.keyword}</strong>
                    <div>{item.resume_snippet}</div>
                    <div>{item.job_snippet}</div>
                  </div>
                ))}
              </div>
            ) : (
              <p>No evidence items available.</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
