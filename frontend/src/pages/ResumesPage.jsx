import { Fragment, useEffect, useState } from "react";
import { Pencil, Save, Trash2, X } from "lucide-react";

import {
  deleteResume,
  getResumeDiagnostics,
  getResumes,
  pasteResume,
  updateResumeNotes,
  uploadResume,
} from "../api";

function getStatusTone(message) {
  const text = String(message || "").toLowerCase();
  if (!text) return "info";
  if (text.includes("failed") || text.includes("error")) return "error";
  if (
    text.includes("loaded") ||
    text.includes("uploaded") ||
    text.includes("saved") ||
    text.includes("completed") ||
    text.includes("deleted")
  ) {
    return "success";
  }
  if (text.includes("confirm") || text.includes("same title") || text.includes("canceled")) return "warning";
  return "info";
}

function getFileStem(filename) {
  const parts = String(filename || "").split(".");
  if (parts.length <= 1) return String(filename || "").trim();
  return parts.slice(0, -1).join(".").trim();
}

function parseVersionTag(value) {
  const match = /^v(\d+)$/i.exec(String(value || "").trim());
  return match ? Number(match[1]) : -1;
}

function groupResumes(resumes) {
  const bySource = new Map();
  for (const resume of resumes) {
    const key = resume.source_name;
    if (!bySource.has(key)) bySource.set(key, []);
    bySource.get(key).push(resume);
  }

  return Array.from(bySource.entries())
    .map(([sourceName, versions]) => {
      const sorted = [...versions].sort((a, b) => {
        const va = parseVersionTag(a.version_tag);
        const vb = parseVersionTag(b.version_tag);
        if (va !== vb) return vb - va;
        return Number(b.id) - Number(a.id);
      });
      return {
        sourceName,
        latest: sorted[0],
        versions: sorted,
      };
    })
    .sort((a, b) => Number(b.latest.id) - Number(a.latest.id));
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function renderHighlightedText(text, terms) {
  if (!text) return null;
  const activeTerms = (terms || []).filter(Boolean);
  if (activeTerms.length === 0) {
    return text;
  }

  const pattern = new RegExp(`(${activeTerms.map((term) => escapeRegex(term)).join("|")})`, "gi");
  const parts = String(text).split(pattern);
  return parts.map((part, index) => {
    const isMatch = activeTerms.some((term) => term.toLowerCase() === String(part).toLowerCase());
    return isMatch ? <mark key={`${part}-${index}`}>{part}</mark> : <span key={`${part}-${index}`}>{part}</span>;
  });
}

function severityChipClass(severity) {
  const value = String(severity || "").toLowerCase();
  if (value === "warning") return "chip chip--warning";
  if (value === "error") return "chip chip--error";
  return "chip chip--info";
}

export default function ResumesPage() {
  const [resumes, setResumes] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [showPasteForm, setShowPasteForm] = useState(false);
  const [pasteTitle, setPasteTitle] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [pasteNotes, setPasteNotes] = useState("");
  const [statusText, setStatusText] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [isPasting, setIsPasting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [deletingId, setDeletingId] = useState(null);
  const [expandedSources, setExpandedSources] = useState({});
  const [expandedVersionId, setExpandedVersionId] = useState(null);
  const [diagnosticsById, setDiagnosticsById] = useState({});
  const [loadingDiagnosticsId, setLoadingDiagnosticsId] = useState(null);
  const [notesDraftById, setNotesDraftById] = useState({});
  const [savingNotesId, setSavingNotesId] = useState(null);
  const [editingNotesId, setEditingNotesId] = useState(null);

  async function loadResumes() {
    setIsLoading(true);
    try {
      const response = await getResumes();
      setResumes(response.items || []);
      const grouped = groupResumes(response.items || []);
      setExpandedSources((current) => {
        const next = { ...current };
        for (const group of grouped) {
          if (typeof next[group.sourceName] === "undefined") next[group.sourceName] = true;
        }
        return next;
      });
      setNotesDraftById((current) => {
        const next = { ...current };
        for (const resume of response.items || []) {
          if (typeof next[resume.id] === "undefined") {
            next[resume.id] = resume.notes || "";
          }
        }
        return next;
      });
      setStatusText(`Loaded ${response.items?.length || 0} resume version(s).`);
    } catch (err) {
      setStatusText(`Failed to load resumes: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadResumes();
  }, []);

  async function onUpload(event) {
    event.preventDefault();
    if (!selectedFile) {
      setStatusText("Select a DOCX file first.");
      return;
    }

    const sourceName = getFileStem(selectedFile.name);
    const duplicateExists = resumes.some((resume) => resume.source_name.toLowerCase() === sourceName.toLowerCase());
    if (duplicateExists) {
      const proceed = window.confirm(
        `A resume titled "${sourceName}" already exists. Uploading will create a new version. Continue?`
      );
      if (!proceed) {
        setStatusText("Upload canceled: same title detected.");
        return;
      }
    }

    setIsUploading(true);
    setStatusText("Uploading resume...");
    try {
      await uploadResume(selectedFile);
      setSelectedFile(null);
      setStatusText("Resume uploaded.");
      await loadResumes();
    } catch (err) {
      setStatusText(`Upload failed: ${err.message}`);
    } finally {
      setIsUploading(false);
    }
  }

  async function onPasteSubmit(event) {
    event.preventDefault();

    const title = (pasteTitle || "").trim();
    const text = (pasteText || "").trim();

    if (!title) {
      setStatusText("Enter a title for pasted resume content.");
      return;
    }
    if (text.length < 40) {
      setStatusText("Paste at least 40 characters of resume content.");
      return;
    }

    const duplicateExists = resumes.some((resume) => resume.source_name.toLowerCase() === title.toLowerCase());
    if (duplicateExists) {
      const proceed = window.confirm(
        `A resume titled "${title}" already exists. Pasting will create a new version. Continue?`
      );
      if (!proceed) {
        setStatusText("Paste canceled: same title detected.");
        return;
      }
    }

    setIsPasting(true);
    setStatusText("Saving pasted resume...");
    try {
      await pasteResume({
        title,
        text,
        notes: (pasteNotes || "").trim() || null,
      });
      setPasteTitle("");
      setPasteText("");
      setPasteNotes("");
      setShowPasteForm(false);
      setStatusText("Pasted resume saved.");
      await loadResumes();
    } catch (err) {
      setStatusText(`Paste failed: ${err.message}`);
    } finally {
      setIsPasting(false);
    }
  }

  async function onDelete(resume) {
    const proceed = window.confirm(
      `Delete ${resume.source_name} ${resume.version_tag}? This cannot be undone.`
    );
    if (!proceed) return;

    setDeletingId(resume.id);
    setStatusText("Deleting resume version...");
    try {
      await deleteResume(resume.id);
      setStatusText("Resume version deleted.");
      await loadResumes();
    } catch (err) {
      setStatusText(`Delete failed: ${err.message}`);
    } finally {
      setDeletingId(null);
    }
  }

  async function onSaveNotes(resumeId) {
    setSavingNotesId(resumeId);
    setStatusText("Saving notes...");
    try {
      await updateResumeNotes(resumeId, notesDraftById[resumeId] || "");
      setStatusText("Notes saved.");
      await loadResumes();
    } catch (err) {
      setStatusText(`Save failed: ${err.message}`);
    } finally {
      setSavingNotesId(null);
      setEditingNotesId((current) => (current === resumeId ? null : current));
    }
  }

  function onCancelNotesEdit(resumeId, fallbackValue) {
    setNotesDraftById((current) => ({
      ...current,
      [resumeId]: fallbackValue || "",
    }));
    setEditingNotesId((current) => (current === resumeId ? null : current));
  }

  async function onToggleVersionDiagnostics(resumeId) {
    if (expandedVersionId === resumeId) {
      setExpandedVersionId(null);
      return;
    }

    setExpandedVersionId(resumeId);
    if (diagnosticsById[resumeId]) return;

    setLoadingDiagnosticsId(resumeId);
    try {
      const result = await getResumeDiagnostics(resumeId);
      setDiagnosticsById((current) => ({ ...current, [resumeId]: result }));
    } catch (err) {
      setStatusText(`Diagnostics failed: ${err.message}`);
    } finally {
      setLoadingDiagnosticsId(null);
    }
  }

  const grouped = groupResumes(resumes);

  const statusTone = getStatusTone(statusText);

  return (
    <div className="panel">
      <h2>Resumes</h2>
      <p className="muted">Upload DOCX resumes and manage version history for analysis.</p>

      <form onSubmit={onUpload} className="actions">
        <input
          type="file"
          accept=".docx"
          disabled={isUploading}
          onChange={(event) => setSelectedFile(event.target.files?.[0] || null)}
        />
        <button type="submit" disabled={isUploading || !selectedFile}>
          {isUploading ? "Uploading..." : "Upload"}
        </button>
        <button
          type="button"
          onClick={() => setShowPasteForm((current) => !current)}
          disabled={isPasting || isUploading}
        >
          {showPasteForm ? "Close paste form" : "Paste resume instead"}
        </button>
      </form>

      {showPasteForm && (
        <form className="panel nested" onSubmit={onPasteSubmit}>
          <h3>Paste Resume</h3>
          <div className="grid">
            <label>
              Title
              <input value={pasteTitle} onChange={(event) => setPasteTitle(event.target.value)} disabled={isPasting} />
            </label>
            <label>
              Initial notes (optional)
              <input value={pasteNotes} onChange={(event) => setPasteNotes(event.target.value)} disabled={isPasting} />
            </label>
            <label>
              Resume text
              <textarea
                className="prompt-box"
                rows={10}
                value={pasteText}
                onChange={(event) => setPasteText(event.target.value)}
                disabled={isPasting}
                placeholder="Paste your resume content here"
              />
            </label>
          </div>
          <div className="actions">
            <button type="submit" disabled={isPasting}>
              {isPasting ? "Saving..." : "Save pasted resume"}
            </button>
          </div>
        </form>
      )}

      {statusText && <p className={`status status--${statusTone}`}>{statusText}</p>}

      <section className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Resume</th>
              <th>Latest Version</th>
              <th>
                <span
                  className="term-help"
                  title="Parser confidence is the system's estimate (0.00-1.00) of how reliably text and sections were extracted from this DOCX."
                >
                  Parser Confidence
                </span>
              </th>
              <th>Uploaded/Created</th>
              <th>Notes</th>
              <th className="actions-col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {grouped.map((group) => {
              const isExpanded = Boolean(expandedSources[group.sourceName]);
              return (
                <Fragment key={`group-${group.sourceName}`}>
                  <tr className="parent-row" onClick={() => setExpandedSources((current) => ({ ...current, [group.sourceName]: !isExpanded }))}>
                    <td>
                      <span className="accordion-caret">{isExpanded ? "▾" : "▸"}</span> {group.sourceName}
                    </td>
                    <td>{group.latest.version_tag}</td>
                    <td>{Number(group.latest.parser_confidence).toFixed(2)}</td>
                    <td>{group.latest.created_at}</td>
                    <td>{group.latest.notes || "-"}</td>
                    <td className="actions-col">{group.versions.length} version(s)</td>
                  </tr>

                  {isExpanded &&
                    group.versions.map((version) => (
                      <Fragment key={`version-${version.id}`}>
                        <tr
                          className="child-row"
                          onClick={() => onToggleVersionDiagnostics(version.id)}
                        >
                          <td className="child-indent">↳ {version.source_name}</td>
                          <td>{version.version_tag}</td>
                          <td>{Number(version.parser_confidence).toFixed(2)}</td>
                          <td>{version.created_at}</td>
                          <td onClick={(event) => event.stopPropagation()}>
                            <div className="notes-cell">
                              {editingNotesId === version.id ? (
                                <>
                                  <input
                                    value={notesDraftById[version.id] ?? ""}
                                    onChange={(event) =>
                                      setNotesDraftById((current) => ({
                                        ...current,
                                        [version.id]: event.target.value,
                                      }))
                                    }
                                    placeholder="Version notes"
                                    disabled={savingNotesId === version.id || deletingId === version.id}
                                  />
                                  <button
                                    type="button"
                                    className="icon-action"
                                    title="Save notes"
                                    aria-label="Save notes"
                                    onClick={() => onSaveNotes(version.id)}
                                    disabled={savingNotesId === version.id || deletingId === version.id}
                                  >
                                    <Save size={16} />
                                  </button>
                                  <button
                                    type="button"
                                    className="icon-action"
                                    title="Cancel editing"
                                    aria-label="Cancel editing"
                                    onClick={() => onCancelNotesEdit(version.id, version.notes)}
                                    disabled={savingNotesId === version.id || deletingId === version.id}
                                  >
                                    <X size={16} />
                                  </button>
                                </>
                              ) : (
                                <>
                                  <span className="notes-preview">{version.notes || "-"}</span>
                                  <button
                                    type="button"
                                    className="icon-action"
                                    title="Edit notes"
                                    aria-label="Edit notes"
                                    onClick={() => {
                                      setEditingNotesId(version.id);
                                      setNotesDraftById((current) => ({
                                        ...current,
                                        [version.id]: version.notes || "",
                                      }));
                                    }}
                                    disabled={deletingId === version.id}
                                  >
                                    <Pencil size={16} />
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                          <td className="actions-col" onClick={(event) => event.stopPropagation()}>
                            <button
                              type="button"
                              className="icon-danger"
                              title="Remove version"
                              aria-label="Remove version"
                              disabled={Boolean(deletingId)}
                              onClick={() => onDelete(version)}
                            >
                              {deletingId === version.id ? <X size={16} /> : <Trash2 size={16} />}
                            </button>
                          </td>
                        </tr>

                        {expandedVersionId === version.id && (
                          <tr className="diagnostics-row">
                            <td colSpan={6}>
                              {loadingDiagnosticsId === version.id && <p>Loading parser diagnostics...</p>}
                              {loadingDiagnosticsId !== version.id && diagnosticsById[version.id] && (
                                <div className="diagnostics-panel">
                                  <h4>Parser Concern Review</h4>
                                  <p className="muted small-text">
                                    Parser confidence: {Number(diagnosticsById[version.id].parser_confidence || 0).toFixed(2)} ·
                                    Gap to 1.00: {Number(1 - Number(diagnosticsById[version.id].parser_confidence || 0)).toFixed(2)}
                                  </p>
                                  {diagnosticsById[version.id].concerns.length > 0 ? (
                                    <ul>
                                      {diagnosticsById[version.id].concerns.map((concern) => (
                                        <li key={concern.code}>
                                          <span className={severityChipClass(concern.severity)}>{concern.severity}</span>{" "}
                                          {concern.message}
                                          {typeof concern.delta_value === "number" && concern.delta_label && (
                                            <span className="concern-delta">
                                              {` ${concern.delta_label}: ${concern.delta_value}`}
                                            </span>
                                          )}
                                        </li>
                                      ))}
                                    </ul>
                                  ) : (
                                    <p>No parser concerns detected.</p>
                                  )}

                                  <div className="markup-preview">
                                    {renderHighlightedText(
                                      diagnosticsById[version.id].extracted_text,
                                      diagnosticsById[version.id].highlight_terms
                                    )}
                                  </div>
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                </Fragment>
              );
            })}

            {isLoading && (
              <tr>
                <td colSpan={6}>Loading resumes...</td>
              </tr>
            )}
            {grouped.length === 0 && !isLoading && (
              <tr>
                <td colSpan={6}>No resume versions yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
