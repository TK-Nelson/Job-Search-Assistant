import { Fragment, useEffect, useState } from "react";
import { Pencil, Save, Trash2, X } from "lucide-react";
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Breadcrumbs,
  Button,
  FileInput,
  Group,
  Paper,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
} from "@mantine/core";
import { AlertCircle, Info } from "lucide-react";
import { Link } from "react-router-dom";

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
  const statusColor = statusTone === "error" ? "red" : statusTone === "warning" ? "yellow" : statusTone === "success" ? "teal" : "blue";

  return (
    <Stack gap="md">
      <Breadcrumbs>
        <Anchor component={Link} to="/dashboard">Dashboard</Anchor>
        <Text size="sm">Resumes</Text>
      </Breadcrumbs>

      <Paper withBorder p="lg" radius="md">
      <Title order={2}>Resumes</Title>
      <Text c="dimmed" size="sm">Upload DOCX resumes and manage version history for analysis.</Text>

      <form onSubmit={onUpload}>
        <Group mt="md" align="end">
          <FileInput
            label="Resume DOCX"
            placeholder="Select .docx file"
            accept=".docx"
            disabled={isUploading}
            value={selectedFile}
            onChange={setSelectedFile}
          />
          <Button type="submit" loading={isUploading} disabled={!selectedFile}>
            Upload
          </Button>
          <Button
          type="button"
          variant="subtle"
          onClick={() => setShowPasteForm((current) => !current)}
          disabled={isPasting || isUploading}
        >
          {showPasteForm ? "Close paste form" : "Paste resume instead"}
          </Button>
        </Group>
      </form>

      {showPasteForm && (
        <Paper withBorder p="md" radius="md" mt="md">
          <form onSubmit={onPasteSubmit}>
            <Text fw={600} mb="xs">Paste Resume</Text>
            <Stack>
              <TextInput label="Title" value={pasteTitle} onChange={(event) => setPasteTitle(event.target.value)} disabled={isPasting} />
              <TextInput label="Initial notes (optional)" value={pasteNotes} onChange={(event) => setPasteNotes(event.target.value)} disabled={isPasting} />
              <Textarea
                label="Resume text"
                rows={10}
                value={pasteText}
                onChange={(event) => setPasteText(event.target.value)}
                disabled={isPasting}
                placeholder="Paste your resume content here"
              />
              <Group>
                <Button type="submit" loading={isPasting}>Save pasted resume</Button>
              </Group>
            </Stack>
          </form>
        </Paper>
      )}

      {statusText && (
        <Alert mt="md" color={statusColor} icon={statusTone === "error" ? <AlertCircle size={16} /> : <Info size={16} />} variant="light">
          {statusText}
        </Alert>
      )}

      <Table.ScrollContainer minWidth={1100} mt="md">
        <Table striped highlightOnHover withTableBorder withColumnBorders>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Resume</Table.Th>
              <Table.Th>Latest Version</Table.Th>
              <Table.Th>
                <span
                  className="term-help"
                  title="Parser confidence is the system's estimate (0.00-1.00) of how reliably text and sections were extracted from this DOCX."
                >
                  Parser Confidence
                </span>
              </Table.Th>
              <Table.Th>Uploaded/Created</Table.Th>
              <Table.Th>Notes</Table.Th>
              <Table.Th className="actions-col">Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {grouped.map((group) => {
              const isExpanded = Boolean(expandedSources[group.sourceName]);
              return (
                <Fragment key={`group-${group.sourceName}`}>
                  <Table.Tr className="parent-row" onClick={() => setExpandedSources((current) => ({ ...current, [group.sourceName]: !isExpanded }))}>
                    <Table.Td>
                      <span className="accordion-caret">{isExpanded ? "▾" : "▸"}</span> {group.sourceName}
                    </Table.Td>
                    <Table.Td>{group.latest.version_tag}</Table.Td>
                    <Table.Td>{Number(group.latest.parser_confidence).toFixed(2)}</Table.Td>
                    <Table.Td>{group.latest.created_at}</Table.Td>
                    <Table.Td>{group.latest.notes || "-"}</Table.Td>
                    <Table.Td className="actions-col">{group.versions.length} version(s)</Table.Td>
                  </Table.Tr>

                  {isExpanded &&
                    group.versions.map((version) => (
                      <Fragment key={`version-${version.id}`}>
                        <Table.Tr
                          className="child-row"
                          onClick={() => onToggleVersionDiagnostics(version.id)}
                        >
                          <Table.Td className="child-indent">↳ {version.source_name}</Table.Td>
                          <Table.Td>{version.version_tag}</Table.Td>
                          <Table.Td>{Number(version.parser_confidence).toFixed(2)}</Table.Td>
                          <Table.Td>{version.created_at}</Table.Td>
                          <Table.Td onClick={(event) => event.stopPropagation()}>
                            <div className="notes-cell">
                              {editingNotesId === version.id ? (
                                <Group wrap="nowrap">
                                  <TextInput
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
                                  <ActionIcon
                                    variant="subtle"
                                    title="Save notes"
                                    aria-label="Save notes"
                                    onClick={() => onSaveNotes(version.id)}
                                    disabled={savingNotesId === version.id || deletingId === version.id}
                                  >
                                    <Save size={16} />
                                  </ActionIcon>
                                  <ActionIcon
                                    variant="subtle"
                                    title="Cancel editing"
                                    aria-label="Cancel editing"
                                    onClick={() => onCancelNotesEdit(version.id, version.notes)}
                                    disabled={savingNotesId === version.id || deletingId === version.id}
                                  >
                                    <X size={16} />
                                  </ActionIcon>
                                </Group>
                              ) : (
                                <Group wrap="nowrap">
                                  <span className="notes-preview">{version.notes || "-"}</span>
                                  <ActionIcon
                                    variant="subtle"
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
                                  </ActionIcon>
                                </Group>
                              )}
                            </div>
                          </Table.Td>
                          <Table.Td className="actions-col" onClick={(event) => event.stopPropagation()}>
                            <ActionIcon
                              variant="light"
                              color="red"
                              title="Remove version"
                              aria-label="Remove version"
                              disabled={Boolean(deletingId)}
                              onClick={() => onDelete(version)}
                            >
                              {deletingId === version.id ? <X size={16} /> : <Trash2 size={16} />}
                            </ActionIcon>
                          </Table.Td>
                        </Table.Tr>

                        {expandedVersionId === version.id && (
                          <Table.Tr className="diagnostics-row">
                            <Table.Td colSpan={6}>
                              {loadingDiagnosticsId === version.id && <Text>Loading parser diagnostics...</Text>}
                              {loadingDiagnosticsId !== version.id && diagnosticsById[version.id] && (
                                <div className="diagnostics-panel">
                                  <Text fw={600}>Parser Concern Review</Text>
                                  <Text className="muted small-text">
                                    Parser confidence: {Number(diagnosticsById[version.id].parser_confidence || 0).toFixed(2)} ·
                                    Gap to 1.00: {Number(1 - Number(diagnosticsById[version.id].parser_confidence || 0)).toFixed(2)}
                                  </Text>
                                  {diagnosticsById[version.id].concerns.length > 0 ? (
                                    <ul>
                                      {diagnosticsById[version.id].concerns.map((concern) => (
                                        <li key={concern.code}>
                                          <Badge
                                            color={
                                              concern.severity === "error"
                                                ? "red"
                                                : concern.severity === "warning"
                                                  ? "yellow"
                                                  : "blue"
                                            }
                                            variant="light"
                                            mr={6}
                                          >
                                            {concern.severity}
                                          </Badge>
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
                                    <Text>No parser concerns detected.</Text>
                                  )}

                                  <div className="markup-preview">
                                    {renderHighlightedText(
                                      diagnosticsById[version.id].extracted_text,
                                      diagnosticsById[version.id].highlight_terms
                                    )}
                                  </div>
                                </div>
                              )}
                            </Table.Td>
                          </Table.Tr>
                        )}
                      </Fragment>
                    ))}
                </Fragment>
              );
            })}

            {isLoading && (
              <Table.Tr>
                <Table.Td colSpan={6}>Loading resumes...</Table.Td>
              </Table.Tr>
            )}
            {grouped.length === 0 && !isLoading && (
              <Table.Tr>
                <Table.Td colSpan={6}>No resume versions yet.</Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      </Paper>
    </Stack>
  );
}
