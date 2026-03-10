import { useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Alert,
  Anchor,
  Avatar,
  Badge,
  Breadcrumbs,
  Button,
  Collapse,
  Divider,
  Group,
  Menu,
  Modal,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Textarea,
  Title,
} from "@mantine/core";
import {
  AlertCircle,
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FileText,
  History,
  Info,
  MoreVertical,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";

import {
  archiveJobPosting,
  createApplication,
  deleteApplication,
  deleteJobPosting,
  getApplicationHistory,
  getApplications,
  getComparisons,
  getCompanies,
  getDashboardSummary,
  getJobPostings,
  getResumes,
  unarchiveJobPosting,
  updateApplication,
  updateApplicationStage,
  updateComparisonParsedInfo,
} from "../api";

// ── Constants ─────────────────────────────────────────────────────

const STAGES = ["saved", "applied", "phone_screen", "interview", "offer", "rejected", "withdrawn"];

// ── Helpers ───────────────────────────────────────────────────────

function getStatusTone(message) {
  const text = String(message || "").toLowerCase();
  if (!text) return "info";
  if (text.includes("failed") || text.includes("error")) return "error";
  if (text.includes("loaded") || text.includes("updated") || text.includes("created") || text.includes("deleted") || text.includes("archived") || text.includes("unarchived")) {
    return "success";
  }
  return "info";
}

function toStageLabel(value) {
  return String(value || "").replaceAll("_", " ");
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const parts = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  }).formatToParts(date);
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  const year = parts.find((part) => part.type === "year")?.value;
  if (!month || !day || !year) return value;
  return `${month} ${day}, ${year}`;
}

function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function matchBadgeColor(score) {
  if (score == null) return "gray";
  if (score >= 70) return "green";
  if (score >= 40) return "yellow";
  return "red";
}

// ── Main Component ────────────────────────────────────────────────

export default function ApplicationsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlCompanyId = searchParams.get("companyId") ? Number(searchParams.get("companyId")) : null;

  // --- data ---
  const [applications, setApplications] = useState([]);
  const [postings, setPostings] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [resumes, setResumes] = useState([]);
  const [comparisonByPosting, setComparisonByPosting] = useState({});
  const [historyByApp, setHistoryByApp] = useState({});
  const [stagesSummary, setStagesSummary] = useState([]);

  // --- UI state ---
  const [statusText, setStatusText] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [filterStage, setFilterStage] = useState("");
  const [filterSearch, setFilterSearch] = useState("");
  const [expandedHistoryId, setExpandedHistoryId] = useState(null);
  const [showArchivedSection, setShowArchivedSection] = useState(false);

  // --- create modal ---
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [createForm, setCreateForm] = useState({
    job_posting_id: "",
    resume_version_id: "",
    stage: "applied",
    applied_at: new Date().toISOString().slice(0, 10),
    target_salary: "",
    notes: "",
  });

  // --- edit modal ---
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editingApp, setEditingApp] = useState(null);
  const [editForm, setEditForm] = useState({
    stage: "saved",
    applied_at: "",
    target_salary: "",
    notes: "",
    title: "",
    company_name: "",
    salary_range: "",
    seniority_level: "",
    workplace_type: "",
    commitment_type: "",
  });

  // --- delete dialog ---
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteScope, setDeleteScope] = useState("application_only");
  const [isDeleting, setIsDeleting] = useState(false);

  // --- busy states ---
  const [busyStageAppId, setBusyStageAppId] = useState(null);
  const [busyActionByPosting, setBusyActionByPosting] = useState({});

  // ── Data loaders ──────────────────────────────────────────────

  async function loadCompanies() {
    try {
      const res = await getCompanies();
      setCompanies(res.items || []);
    } catch (_) { /* non-critical */ }
  }

  async function loadResumes() {
    try {
      const res = await getResumes();
      setResumes(res.items || []);
    } catch (_) { /* non-critical */ }
  }

  async function loadApplications(stage = filterStage, companyId = urlCompanyId) {
    setIsLoading(true);
    try {
      const response = await getApplications({ stage: stage || undefined, companyId: companyId || undefined });
      setApplications(response.items || []);
    } catch (err) {
      setStatusText(`Failed to load applications: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  }

  async function loadPostings() {
    try {
      const response = await getJobPostings({ limit: 500, status: "active" });
      setPostings(response.items || []);
    } catch (err) {
      setStatusText(`Failed to load postings: ${err.message}`);
    }
  }

  async function loadComparisons() {
    try {
      const response = await getComparisons(500);
      const latestByPosting = {};
      for (const item of response.items || []) {
        if (!latestByPosting[item.job_posting_id]) {
          latestByPosting[item.job_posting_id] = item;
        }
      }
      setComparisonByPosting(latestByPosting);
    } catch { setComparisonByPosting({}); }
  }

  async function loadStagesSummary() {
    try {
      const result = await getDashboardSummary();
      setStagesSummary(result.applications_by_stage || []);
    } catch { /* non-critical */ }
  }

  useEffect(() => {
    loadCompanies();
    loadResumes();
    loadApplications();
    loadPostings();
    loadComparisons();
    loadStagesSummary();
  }, []);

  // ── Derived data ──────────────────────────────────────────────

  const companyById = useMemo(
    () => Object.fromEntries(companies.map((c) => [c.id, c])),
    [companies]
  );

  const appliedPostingIds = useMemo(
    () => new Set(applications.map((a) => a.job_posting_id)),
    [applications]
  );

  const parsedRoles = useMemo(() => {
    return postings.filter((p) => !appliedPostingIds.has(p.id) && !p.archived_at);
  }, [postings, appliedPostingIds]);

  const archivedPostings = useMemo(() => {
    return postings.filter((p) => p.archived_at);
  }, [postings]);

  const filteredParsedRoles = useMemo(() => {
    if (!filterSearch.trim()) return parsedRoles;
    const q = filterSearch.toLowerCase();
    return parsedRoles.filter(
      (p) =>
        p.title?.toLowerCase().includes(q) ||
        p.company_name?.toLowerCase().includes(q)
    );
  }, [parsedRoles, filterSearch]);

  const postingOptions = useMemo(() => {
    return postings
      .filter((p) => !appliedPostingIds.has(p.id))
      .map((p) => ({
        value: String(p.id),
        label: `${p.company_name} – ${p.title}`,
      }));
  }, [postings, appliedPostingIds]);

  const resumeOptions = useMemo(() => {
    return resumes.map((r) => ({
      value: String(r.id),
      label: `${r.source_name} (${r.version_tag})`,
    }));
  }, [resumes]);

  const stageOptions = STAGES.map((s) => ({ value: s, label: toStageLabel(s) }));
  const statusTone = getStatusTone(statusText);
  const statusColor = statusTone === "error" ? "red" : statusTone === "success" ? "teal" : "blue";

  // ── Actions ───────────────────────────────────────────────────

  function clearCompanyFilter() {
    setSearchParams((prev) => { prev.delete("companyId"); return prev; });
    loadApplications(filterStage, null);
  }

  async function onCreate(event) {
    event.preventDefault();
    if (!createForm.job_posting_id) {
      setStatusText("Select a job posting before creating an application.");
      return;
    }
    if (!createForm.resume_version_id) {
      setStatusText("Select a resume version before creating an application.");
      return;
    }

    setIsCreating(true);
    setStatusText("Creating application & running comparison...");
    try {
      await createApplication({
        job_posting_id: Number(createForm.job_posting_id),
        resume_version_id: Number(createForm.resume_version_id),
        stage: createForm.stage,
        applied_at: createForm.applied_at || null,
        target_salary: createForm.target_salary || null,
        notes: createForm.notes || null,
      });
      setStatusText("Application created with comparison report.");
      setCreateForm({ job_posting_id: "", resume_version_id: "", stage: "applied", applied_at: new Date().toISOString().slice(0, 10), target_salary: "", notes: "" });
      setIsCreateOpen(false);
      await Promise.all([loadApplications(), loadPostings(), loadComparisons(), loadStagesSummary()]);
    } catch (err) {
      setStatusText(`Create failed: ${err.message}`);
    } finally {
      setIsCreating(false);
    }
  }

  async function onInlineStageUpdate(applicationId, nextStage) {
    if (!nextStage) return;
    setBusyStageAppId(applicationId);
    try {
      await updateApplicationStage(applicationId, { to_stage: nextStage, reason: "inline status update" });
      setStatusText("Stage updated.");
      await Promise.all([loadApplications(), loadStagesSummary()]);
    } catch (err) {
      setStatusText(`Stage update failed: ${err.message}`);
    } finally {
      setBusyStageAppId(null);
    }
  }

  function onOpenEdit(app) {
    const comparison = comparisonByPosting[app.job_posting_id];
    setEditingApp(app);
    setEditForm({
      stage: app.stage,
      applied_at: app.applied_at || "",
      target_salary: app.target_salary || "",
      notes: app.notes || "",
      title: app.posting_title || "",
      company_name: app.company_name || "",
      salary_range: comparison?.salary_range || "",
      seniority_level: comparison?.seniority_level || "",
      workplace_type: comparison?.workplace_type || "",
      commitment_type: comparison?.commitment_type || "",
    });
    setIsEditOpen(true);
  }

  async function onSaveEdit() {
    if (!editingApp) return;
    setIsSavingEdit(true);
    setStatusText("Saving changes...");
    try {
      await updateApplication(editingApp.id, {
        stage: editForm.stage,
        applied_at: editForm.applied_at || null,
        target_salary: editForm.target_salary || null,
        notes: editForm.notes || null,
      });

      const comparison = comparisonByPosting[editingApp.job_posting_id];
      if (comparison) {
        await updateComparisonParsedInfo(comparison.id, {
          company_name: editForm.company_name || undefined,
          title: editForm.title || undefined,
          salary_range: editForm.salary_range || undefined,
          seniority_level: editForm.seniority_level || undefined,
          workplace_type: editForm.workplace_type || undefined,
          commitment_type: editForm.commitment_type || undefined,
        });
      }

      setStatusText("Application updated.");
      setIsEditOpen(false);
      setEditingApp(null);
      await Promise.all([loadApplications(), loadComparisons(), loadStagesSummary()]);
    } catch (err) {
      setStatusText(`Update failed: ${err.message}`);
    } finally {
      setIsSavingEdit(false);
    }
  }

  function onOpenDelete(app) {
    setDeleteTarget({ app, type: "application" });
    setDeleteScope("application_only");
  }

  function onOpenDeletePosting(posting) {
    setDeleteTarget({ posting, type: "posting" });
    setDeleteScope("posting");
  }

  async function onConfirmDelete() {
    if (!deleteTarget) return;
    setIsDeleting(true);
    setStatusText("Deleting...");

    try {
      if (deleteTarget.type === "application") {
        if (deleteScope === "cascade") {
          await deleteJobPosting(deleteTarget.app.job_posting_id);
          setStatusText("Application and posting deleted.");
        } else {
          await deleteApplication(deleteTarget.app.id);
          setStatusText("Application deleted.");
        }
      } else {
        await deleteJobPosting(deleteTarget.posting.id);
        setStatusText("Posting deleted.");
      }

      setDeleteTarget(null);
      if (expandedHistoryId === deleteTarget.app?.id) setExpandedHistoryId(null);
      await Promise.all([loadApplications(), loadPostings(), loadComparisons(), loadStagesSummary()]);
    } catch (err) {
      setStatusText(`Delete failed: ${err.message}`);
    } finally {
      setIsDeleting(false);
    }
  }

  async function onToggleHistory(applicationId) {
    if (expandedHistoryId === applicationId) {
      setExpandedHistoryId(null);
      return;
    }
    if (!historyByApp[applicationId]) {
      try {
        const response = await getApplicationHistory(applicationId);
        setHistoryByApp((current) => ({ ...current, [applicationId]: response.items || [] }));
      } catch (err) {
        setStatusText(`History load failed: ${err.message}`);
        return;
      }
    }
    setExpandedHistoryId(applicationId);
  }

  async function onArchivePosting(postingId) {
    setBusyActionByPosting((c) => ({ ...c, [postingId]: "archive" }));
    try {
      await archiveJobPosting(postingId);
      setStatusText("Posting archived.");
      await loadPostings();
    } catch (err) {
      setStatusText(`Archive failed: ${err.message}`);
    } finally {
      setBusyActionByPosting((c) => { const n = { ...c }; delete n[postingId]; return n; });
    }
  }

  async function onUnarchivePosting(postingId) {
    setBusyActionByPosting((c) => ({ ...c, [postingId]: "unarchive" }));
    try {
      await unarchiveJobPosting(postingId);
      setStatusText("Posting unarchived.");
      await loadPostings();
    } catch (err) {
      setStatusText(`Unarchive failed: ${err.message}`);
    } finally {
      setBusyActionByPosting((c) => { const n = { ...c }; delete n[postingId]; return n; });
    }
  }

  // ── Render ────────────────────────────────────────────────────

  return (
    <Stack gap="md">
      <Breadcrumbs>
        <Anchor component={Link} to="/dashboard">Dashboard</Anchor>
        <Text size="sm">Applications</Text>
      </Breadcrumbs>

      {/* Page header */}
      <div>
        <Title order={2}>Applications</Title>
        <Text c="dimmed" size="sm">Track your job applications, parsed roles, and comparison reports.</Text>
      </div>

      {/* Stage summary cards */}
      {stagesSummary.length > 0 && (
        <SimpleGrid cols={{ base: 2, sm: 4, lg: 7 }}>
          {stagesSummary.map((item) => (
            <Paper withBorder p="sm" radius="md" key={item.stage}>
              <Text c="dimmed" size="xs" tt="capitalize">{toStageLabel(item.stage)}</Text>
              <Title order={4}>{item.count}</Title>
            </Paper>
          ))}
        </SimpleGrid>
      )}

      {/* Status alert */}
      {statusText && (
        <Alert
          color={statusColor}
          icon={statusTone === "error" ? <AlertCircle size={16} /> : <Info size={16} />}
          variant="light"
          withCloseButton
          onClose={() => setStatusText("")}
        >
          {statusText}
        </Alert>
      )}

      {/* ─── APPLICATIONS TABLE ─────────────────────────────────── */}
      <Paper withBorder p="lg" radius="md">
        <Group justify="space-between" align="center" mb="md">
          <Title order={3}>Applications</Title>
          <Group gap="sm">
            {urlCompanyId && (
              <Alert color="blue" variant="light" py={4} px="sm" icon={<Info size={14} />}
                styles={{ root: { display: "inline-flex" } }}
              >
                <Group gap={4}>
                  <Text size="xs">Filtered: <b>{companyById[urlCompanyId]?.name || `#${urlCompanyId}`}</b></Text>
                  <ActionIcon size="xs" variant="subtle" onClick={clearCompanyFilter}><X size={12} /></ActionIcon>
                </Group>
              </Alert>
            )}
            <Select
              placeholder="Filter by stage"
              clearable
              size="sm"
              data={stageOptions}
              value={filterStage || null}
              onChange={(value) => { setFilterStage(value || ""); loadApplications(value || ""); }}
              w={160}
            />
            <Button leftSection={<Plus size={16} />} onClick={() => setIsCreateOpen(true)}>
              Create Application
            </Button>
          </Group>
        </Group>

        {/* Applications table header */}
        <Paper p="xs" radius="md" style={{ borderBottom: "1px solid var(--mantine-color-gray-3)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "3fr 0.8fr 1.2fr 1.2fr 1.2fr 0.6fr", gap: 12, padding: "6px 8px" }}>
            <Text fw={600} size="sm">Role</Text>
            <Text fw={600} size="sm">Match %</Text>
            <Text fw={600} size="sm">Status</Text>
            <Text fw={600} size="sm">Applied Date</Text>
            <Text fw={600} size="sm">Salary</Text>
            <Text fw={600} size="sm">Actions</Text>
          </div>
        </Paper>

        {/* Applications rows */}
        <Stack mt="xs" gap="xs">
          {applications.map((app) => {
            const company = companyById[app.company_id] || {};
            const logoUrl = app.logo_url || company.logo_url;
            const comparison = comparisonByPosting[app.job_posting_id];
            const reportLink = comparison ? `/applications/application/${comparison.id}` : null;

            return (
              <Paper key={app.id} p="sm" radius="md">
                <div style={{ display: "grid", gridTemplateColumns: "3fr 0.8fr 1.2fr 1.2fr 1.2fr 0.6fr", gap: 12, alignItems: "center" }}>
                  <Group gap="sm" wrap="nowrap">
                    {logoUrl ? (
                      <Avatar radius={8} size="md" src={logoUrl} alt={app.company_name}>
                        {initials(app.company_name)}
                      </Avatar>
                    ) : (
                      <Avatar radius={8} size="md" color="blue">{initials(app.company_name)}</Avatar>
                    )}
                    <Stack gap={2}>
                      {reportLink ? (
                        <Anchor component={Link} to={reportLink} fw={600} size="sm">{app.posting_title}</Anchor>
                      ) : (
                        <Text fw={600} size="sm">{app.posting_title}</Text>
                      )}
                      <Group gap={6}>
                        <Anchor component={Link} to={`/companies/${app.company_id}`} size="xs" c="dimmed">{app.company_name}</Anchor>
                        {(app.industry || company.industry) && (
                          <Text size="xs" c="dimmed">· {app.industry || company.industry}</Text>
                        )}
                      </Group>
                    </Stack>
                  </Group>

                  <Badge color={matchBadgeColor(app.match_score)} variant="light" size="sm">
                    {app.match_score != null ? `${app.match_score.toFixed(1)}%` : "–"}
                  </Badge>

                  <Select
                    size="xs"
                    radius="xl"
                    variant="filled"
                    data={stageOptions}
                    value={app.stage}
                    onChange={(value) => onInlineStageUpdate(app.id, value || app.stage)}
                    disabled={busyStageAppId === app.id}
                    allowDeselect={false}
                    w={150}
                  />

                  <Text size="sm">{formatDate(app.applied_at)}</Text>
                  <Text size="sm">{app.target_salary || "-"}</Text>

                  <Menu shadow="md" width={180} position="bottom-end">
                    <Menu.Target>
                      <ActionIcon variant="subtle" aria-label="More actions">
                        <MoreVertical size={16} />
                      </ActionIcon>
                    </Menu.Target>
                    <Menu.Dropdown>
                      {reportLink && (
                        <Menu.Item leftSection={<FileText size={14} />} component={Link} to={reportLink}>
                          View report
                        </Menu.Item>
                      )}
                      <Menu.Item leftSection={<Pencil size={14} />} onClick={() => onOpenEdit(app)}>
                        Edit
                      </Menu.Item>
                      <Menu.Item leftSection={<History size={14} />} onClick={() => onToggleHistory(app.id)}>
                        {expandedHistoryId === app.id ? "Hide history" : "View history"}
                      </Menu.Item>
                      <Menu.Item color="red" leftSection={<Trash2 size={14} />} onClick={() => onOpenDelete(app)}>
                        Delete
                      </Menu.Item>
                    </Menu.Dropdown>
                  </Menu>
                </div>
              </Paper>
            );
          })}

          {isLoading && <Paper p="sm"><Text size="sm">Loading applications...</Text></Paper>}
          {applications.length === 0 && !isLoading && <Paper p="sm"><Text size="sm" c="dimmed">No applications yet. Create one from a parsed role below.</Text></Paper>}
        </Stack>

        {/* Expanded history */}
        {expandedHistoryId && historyByApp[expandedHistoryId] && (
          <Paper withBorder p="sm" radius="md" mt="md">
            <Text fw={600} size="sm">Stage history</Text>
            <Stack gap={4} mt="xs">
              {historyByApp[expandedHistoryId].length > 0 ? (
                historyByApp[expandedHistoryId].map((item) => (
                  <Text key={item.id} size="xs">
                    {item.changed_at}: {toStageLabel(item.from_stage || "start")} → {toStageLabel(item.to_stage)}
                  </Text>
                ))
              ) : (
                <Text size="xs" c="dimmed">No stage history yet.</Text>
              )}
            </Stack>
          </Paper>
        )}
      </Paper>

      {/* ─── PARSED ROLES TABLE ─────────────────────────────────── */}
      <Paper withBorder p="lg" radius="md">
        <Group justify="space-between" align="center" mb="md">
          <div>
            <Title order={3}>Parsed Roles</Title>
            <Text c="dimmed" size="xs">{filteredParsedRoles.length} role(s) not yet applied to</Text>
          </div>
          <TextInput
            placeholder="Search roles..."
            size="sm"
            value={filterSearch}
            onChange={(e) => setFilterSearch(e.target.value)}
            w={220}
          />
        </Group>

        <Paper p="xs" radius="md" style={{ borderBottom: "1px solid var(--mantine-color-gray-3)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "3fr 0.8fr 1.2fr 0.6fr", gap: 12, padding: "6px 8px" }}>
            <Text fw={600} size="sm">Role</Text>
            <Text fw={600} size="sm">Match %</Text>
            <Text fw={600} size="sm">Date Seen</Text>
            <Text fw={600} size="sm">Actions</Text>
          </div>
        </Paper>

        <Stack mt="xs" gap="xs">
          {filteredParsedRoles.map((posting) => {
            const company = companyById[posting.company_id] || {};
            const comparison = comparisonByPosting[posting.id];
            const reportLink = comparison ? `/applications/application/${comparison.id}` : null;

            return (
              <Paper key={posting.id} p="sm" radius="md">
                <div style={{ display: "grid", gridTemplateColumns: "3fr 0.8fr 1.2fr 0.6fr", gap: 12, alignItems: "center" }}>
                  <Group gap="sm" wrap="nowrap">
                    {company.logo_url ? (
                      <Avatar radius={8} size="sm" src={company.logo_url} alt={posting.company_name}>
                        {initials(posting.company_name)}
                      </Avatar>
                    ) : (
                      <Avatar radius={8} size="sm" color="blue">{initials(posting.company_name)}</Avatar>
                    )}
                    <Stack gap={2}>
                      {reportLink ? (
                        <Anchor component={Link} to={reportLink} fw={600} size="sm">{posting.title}</Anchor>
                      ) : (
                        <Text fw={600} size="sm">{posting.title}</Text>
                      )}
                      <Anchor component={Link} to={`/companies/${posting.company_id}`} size="xs" c="dimmed">{posting.company_name}</Anchor>
                    </Stack>
                  </Group>

                  <Badge color={matchBadgeColor(posting.match_score)} variant="light" size="sm">
                    {posting.match_score != null ? `${posting.match_score.toFixed(1)}%` : "–"}
                  </Badge>

                  <Text size="sm">{formatDate(posting.first_seen_at)}</Text>

                  <Menu shadow="md" width={210} position="bottom-end">
                    <Menu.Target>
                      <ActionIcon variant="subtle" aria-label="Actions" disabled={Boolean(busyActionByPosting[posting.id])}>
                        <MoreVertical size={16} />
                      </ActionIcon>
                    </Menu.Target>
                    <Menu.Dropdown>
                      {reportLink && (
                        <Menu.Item leftSection={<FileText size={14} />} component={Link} to={reportLink}>
                          View report
                        </Menu.Item>
                      )}
                      <Menu.Item leftSection={<ExternalLink size={14} />} component="a" href={posting.canonical_url} target="_blank" rel="noreferrer">
                        Open job listing
                      </Menu.Item>
                      <Menu.Item leftSection={<Archive size={14} />} onClick={() => onArchivePosting(posting.id)}>
                        Archive
                      </Menu.Item>
                      <Menu.Item color="red" leftSection={<Trash2 size={14} />} onClick={() => onOpenDeletePosting(posting)}>
                        Delete
                      </Menu.Item>
                    </Menu.Dropdown>
                  </Menu>
                </div>
              </Paper>
            );
          })}

          {filteredParsedRoles.length === 0 && !isLoading && (
            <Paper p="sm"><Text size="sm" c="dimmed">No parsed roles found.</Text></Paper>
          )}
        </Stack>
      </Paper>

      {/* ─── ARCHIVED SECTION ───────────────────────────────────── */}
      {archivedPostings.length > 0 && (
        <Paper withBorder p="lg" radius="md">
          <Group
            justify="space-between"
            align="center"
            style={{ cursor: "pointer" }}
            onClick={() => setShowArchivedSection((v) => !v)}
          >
            <Group gap="sm">
              <Title order={3}>Archived</Title>
              <Badge variant="light" color="gray" size="sm">{archivedPostings.length}</Badge>
            </Group>
            {showArchivedSection ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </Group>

          <Collapse in={showArchivedSection}>
            <Stack mt="md" gap="xs">
              {archivedPostings.map((posting) => {
                const company = companyById[posting.company_id] || {};
                return (
                  <Paper key={posting.id} p="sm" radius="md">
                    <Group justify="space-between" align="center">
                      <Group gap="sm" wrap="nowrap">
                        {company.logo_url ? (
                          <Avatar radius={8} size="sm" src={company.logo_url} alt={posting.company_name}>
                            {initials(posting.company_name)}
                          </Avatar>
                        ) : (
                          <Avatar radius={8} size="sm" color="gray">{initials(posting.company_name)}</Avatar>
                        )}
                        <Stack gap={2}>
                          <Text fw={500} size="sm" c="dimmed">{posting.title}</Text>
                          <Text size="xs" c="dimmed">{posting.company_name} · Archived {formatDate(posting.archived_at)}</Text>
                        </Stack>
                      </Group>
                      <Group gap="xs">
                        <Button
                          size="xs"
                          variant="subtle"
                          leftSection={<ArchiveRestore size={14} />}
                          onClick={() => onUnarchivePosting(posting.id)}
                          loading={busyActionByPosting[posting.id] === "unarchive"}
                        >
                          Unarchive
                        </Button>
                        <ActionIcon
                          variant="subtle"
                          color="red"
                          onClick={() => onOpenDeletePosting(posting)}
                          disabled={Boolean(busyActionByPosting[posting.id])}
                        >
                          <Trash2 size={14} />
                        </ActionIcon>
                      </Group>
                    </Group>
                  </Paper>
                );
              })}
            </Stack>
          </Collapse>
        </Paper>
      )}

      {/* ─── CREATE APPLICATION MODAL ───────────────────────────── */}
      <Modal opened={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="Create Application" centered size="lg">
        <form onSubmit={onCreate}>
          <Stack>
            <Select
              label="Job posting"
              placeholder="Select a parsed role"
              data={postingOptions}
              searchable
              value={createForm.job_posting_id}
              onChange={(value) => setCreateForm((x) => ({ ...x, job_posting_id: value || "" }))}
              disabled={isCreating}
              required
            />
            <Select
              label="Resume version"
              placeholder="Select a resume for comparison"
              data={resumeOptions}
              value={createForm.resume_version_id}
              onChange={(value) => setCreateForm((x) => ({ ...x, resume_version_id: value || "" }))}
              disabled={isCreating}
              required
              description="A comparison report will be auto-generated using this resume."
            />
            <Select
              label="Stage"
              data={stageOptions}
              value={createForm.stage}
              onChange={(value) => setCreateForm((x) => ({ ...x, stage: value || "applied" }))}
              disabled={isCreating}
            />
            <TextInput
              label="Applied date"
              type="date"
              value={createForm.applied_at}
              onChange={(e) => setCreateForm((x) => ({ ...x, applied_at: e.target.value }))}
              disabled={isCreating}
            />
            <TextInput
              label="Target salary"
              placeholder="e.g. $120k-$150k"
              value={createForm.target_salary}
              onChange={(e) => setCreateForm((x) => ({ ...x, target_salary: e.target.value }))}
              disabled={isCreating}
            />
            <Textarea
              label="Notes"
              value={createForm.notes}
              onChange={(e) => setCreateForm((x) => ({ ...x, notes: e.target.value }))}
              disabled={isCreating}
            />
            <Group justify="flex-end" mt="sm">
              <Button variant="default" onClick={() => setIsCreateOpen(false)} disabled={isCreating}>Cancel</Button>
              <Button type="submit" loading={isCreating}>Create &amp; Compare</Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      {/* ─── EDIT APPLICATION MODAL ─────────────────────────────── */}
      <Modal opened={isEditOpen} onClose={() => setIsEditOpen(false)} title="Edit Application" centered size="lg">
        <Stack>
          <Text size="sm" c="dimmed">{editingApp ? `${editingApp.company_name} · ${editingApp.posting_title}` : ""}</Text>

          {/* Section 1: Application */}
          <Title order={5}>Application</Title>
          <Select
            label="Stage"
            data={stageOptions}
            value={editForm.stage}
            onChange={(value) => setEditForm((c) => ({ ...c, stage: value || "saved" }))}
            disabled={isSavingEdit}
          />
          <TextInput
            label="Applied date"
            type="date"
            value={editForm.applied_at}
            onChange={(e) => setEditForm((c) => ({ ...c, applied_at: e.target.value }))}
            disabled={isSavingEdit}
          />
          <Textarea
            label="Notes"
            value={editForm.notes}
            onChange={(e) => setEditForm((c) => ({ ...c, notes: e.target.value }))}
            disabled={isSavingEdit}
          />

          <Divider my="sm" />

          {/* Section 2: Role Info */}
          <Title order={5}>Role Info</Title>
          <TextInput
            label="Title"
            value={editForm.title}
            onChange={(e) => setEditForm((c) => ({ ...c, title: e.target.value }))}
            disabled={isSavingEdit}
          />
          <TextInput
            label="Company"
            value={editForm.company_name}
            onChange={(e) => setEditForm((c) => ({ ...c, company_name: e.target.value }))}
            disabled={isSavingEdit}
          />
          <TextInput
            label="Target salary"
            placeholder="e.g. $120k-$150k"
            value={editForm.target_salary}
            onChange={(e) => setEditForm((c) => ({ ...c, target_salary: e.target.value }))}
            disabled={isSavingEdit}
          />
          <TextInput
            label="Salary range (from posting)"
            value={editForm.salary_range}
            onChange={(e) => setEditForm((c) => ({ ...c, salary_range: e.target.value }))}
            disabled={isSavingEdit}
          />
          <Group grow>
            <TextInput
              label="Seniority"
              value={editForm.seniority_level}
              onChange={(e) => setEditForm((c) => ({ ...c, seniority_level: e.target.value }))}
              disabled={isSavingEdit}
            />
            <TextInput
              label="Workplace type"
              value={editForm.workplace_type}
              onChange={(e) => setEditForm((c) => ({ ...c, workplace_type: e.target.value }))}
              disabled={isSavingEdit}
            />
            <TextInput
              label="Commitment"
              value={editForm.commitment_type}
              onChange={(e) => setEditForm((c) => ({ ...c, commitment_type: e.target.value }))}
              disabled={isSavingEdit}
            />
          </Group>

          <Group justify="flex-end" mt="sm">
            <Button variant="default" onClick={() => setIsEditOpen(false)} disabled={isSavingEdit}>Cancel</Button>
            <Button onClick={onSaveEdit} loading={isSavingEdit}>Save</Button>
          </Group>
        </Stack>
      </Modal>

      {/* ─── DELETE CONFIRMATION DIALOG ─────────────────────────── */}
      <Modal
        opened={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Confirm Delete"
        centered
        size="sm"
      >
        <Stack>
          {deleteTarget?.type === "application" ? (
            <>
              <Text size="sm">
                Delete application for <b>{deleteTarget.app.posting_title}</b> at <b>{deleteTarget.app.company_name}</b>?
              </Text>
              <Select
                label="What to delete"
                data={[
                  { value: "application_only", label: "Application only (keep posting & comparison)" },
                  { value: "cascade", label: "Application + posting + comparison (full cascade)" },
                ]}
                value={deleteScope}
                onChange={(v) => setDeleteScope(v || "application_only")}
                allowDeselect={false}
              />
            </>
          ) : (
            <Text size="sm">
              Delete posting <b>{deleteTarget?.posting?.title}</b>? This also removes linked analysis, comparisons, and applications (cascade).
            </Text>
          )}
          <Group justify="flex-end" mt="sm">
            <Button variant="default" onClick={() => setDeleteTarget(null)} disabled={isDeleting}>Cancel</Button>
            <Button color="red" onClick={onConfirmDelete} loading={isDeleting}>Delete</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
