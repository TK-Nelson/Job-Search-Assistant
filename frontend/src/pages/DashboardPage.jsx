import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Accordion,
  ActionIcon,
  Alert,
  Anchor,
  Autocomplete,
  Avatar,
  Badge,
  Breadcrumbs,
  Button,
  Checkbox,
  FileInput,
  Group,
  Menu,
  Modal,
  MultiSelect,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  TagsInput,
  Text,
  TextInput,
  Textarea,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  AlertCircle,
  Briefcase,
  ExternalLink,
  History,
  Info,
  MoreVertical,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Settings2,
  Trash2,
} from "lucide-react";

import {
  createApplication,
  createFetchRoutine,
  deleteFetchRoutine,
  deleteJobPosting,
  getCompanies,
  getDashboardSummary,
  getFetchedRoles,
  getFetchRoutine,
  getFetchRuns,
  getResumeDiagnostics,
  getResumes,
  runComparison,
  runFetchNow,
  scrapeComparisonUrl,
  updateFetchRoutine,
  uploadResume,
} from "../api";

/* ── Helpers ──────────────────────────────────────────────────── */

const FREQUENCY_OPTIONS = [
  { value: "120", label: "Every 2 hours" },
  { value: "360", label: "Every 6 hours" },
  { value: "720", label: "Every 12 hours" },
  { value: "1440", label: "Daily" },
  { value: "10080", label: "Weekly" },
];

const MAX_AGE_OPTIONS = [
  { value: "3", label: "3 days" },
  { value: "7", label: "7 days" },
  { value: "14", label: "14 days" },
  { value: "30", label: "30 days" },
  { value: "60", label: "60 days" },
  { value: "90", label: "90 days" },
];

function getStatusTone(message) {
  const text = String(message || "").toLowerCase();
  if (!text) return "info";
  if (text.includes("failed") || text.includes("error")) return "error";
  if (text.includes("offline") || text.includes("queued") || text.includes("warning")) return "warning";
  return "info";
}

/** Format a UTC or plain date string to "MMM DD, YYYY H:MM AM/PM" */
function formatDate(value) {
  if (!value) return "\u2014";
  const d = value.includes("T") || /^\d{4}-\d{2}-\d{2} /.test(value)
    ? new Date(value + (value.endsWith("Z") ? "" : "Z"))
    : new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const hours = d.getHours();
  const ampm = hours >= 12 ? "PM" : "AM";
  const h12 = hours % 12 || 12;
  return `${months[d.getMonth()]} ${String(d.getDate()).padStart(2,"0")}, ${d.getFullYear()} ${h12}:${String(d.getMinutes()).padStart(2,"0")} ${ampm}`;
}

/* ── Component ────────────────────────────────────────────────── */

export default function DashboardPage() {
  const navigate = useNavigate();

  /* Data state */
  const [summary, setSummary] = useState(null);
  const [routine, setRoutine] = useState(undefined); // undefined=loading, null=none
  const [roles, setRoles] = useState([]);
  const [rolesTotal, setRolesTotal] = useState(0);
  const [rolesNewCount, setRolesNewCount] = useState(0);
  const [companies, setCompanies] = useState([]);
  const [resumes, setResumes] = useState([]);
  const [fetchErrors, setFetchErrors] = useState([]);

  /* UI state */
  const [status, setStatus] = useState("");
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isRunningNow, setIsRunningNow] = useState(false);
  const [isRunningComparison, setIsRunningComparison] = useState(false);
  const [isUploadingResume, setIsUploadingResume] = useState(false);
  const [isScrapingComparisonUrl, setIsScrapingComparisonUrl] = useState(false);
  const [routineModalOpen, setRoutineModalOpen] = useState(false);
  const [isSavingRoutine, setIsSavingRoutine] = useState(false);

  /* Comparison form */
  const [comparisonForm, setComparisonForm] = useState({
    sourceType: "online",
    sourceText: "",
    sourceUrl: "",
    title: "",
    descriptionText: "",
    resumeVersionId: "",
    evaluationMode: "chatgpt_api",
  });
  const [uploadFile, setUploadFile] = useState(null);

  /* Routine form (modal) */
  const [routineForm, setRoutineForm] = useState({
    title_keywords: [],
    description_keywords: [],
    keyword_match_mode: "any",
    max_role_age_days: "14",
    frequency_minutes: "720",
    company_ids: [],
    use_followed_companies: true,
  });

  /* ── Loaders ────────────────────────────────────────────────── */

  async function loadSummary() {
    try {
      setSummary(await getDashboardSummary());
    } catch (err) {
      setStatus(`Failed to load dashboard summary: ${err.message}`);
    }
  }

  async function loadRoutine() {
    try {
      const r = await getFetchRoutine();
      setRoutine(r ?? null);
    } catch {
      setRoutine(null);
    }
  }

  async function loadRoles() {
    try {
      const result = await getFetchedRoles(50, 0);
      setRoles(result.items || []);
      setRolesTotal(result.total || 0);
      setRolesNewCount(result.new_count || 0);
    } catch {
      /* silent — roles table just stays empty */
    }
  }

  async function loadCompanies() {
    try {
      const result = await getCompanies();
      setCompanies(result.items || []);
    } catch {
      /* silent */
    }
  }

  async function loadFetchErrors() {
    try {
      const result = await getFetchRuns(1);
      const latestRun = (result.items || [])[0];
      if (latestRun) {
        try {
          const errs = JSON.parse(latestRun.errors_json || "[]");
          setFetchErrors(Array.isArray(errs) ? errs : []);
        } catch {
          setFetchErrors([]);
        }
      } else {
        setFetchErrors([]);
      }
    } catch {
      /* silent */
    }
  }

  async function loadResumes() {
    try {
      const result = await getResumes();
      const items = result.items || [];
      setResumes(items);
      setComparisonForm((c) => {
        if (c.resumeVersionId || items.length === 0) return c;
        return { ...c, resumeVersionId: String(items[0].id) };
      });
    } catch {
      /* silent */
    }
  }

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    loadSummary();
    loadRoutine();
    loadRoles();
    loadCompanies();
    loadResumes();
    loadFetchErrors();
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  /* ── Actions ────────────────────────────────────────────────── */

  async function onRunNow() {
    setIsRunningNow(true);
    setStatus("");
    try {
      await runFetchNow();
      await Promise.all([loadSummary(), loadRoles(), loadFetchErrors()]);
    } catch (err) {
      setStatus(`Fetch failed: ${err.message}`);
    } finally {
      setIsRunningNow(false);
    }
  }

  async function onDeleteRole(postingId) {
    try {
      await deleteJobPosting(postingId);
      setRoles((prev) => prev.filter((r) => r.id !== postingId));
      setRolesTotal((t) => Math.max(0, t - 1));
    } catch (err) {
      setStatus(`Failed to delete role: ${err.message}`);
    }
  }

  async function onMarkAsApplied(role) {
    try {
      await createApplication({
        job_posting_id: role.id,
        stage: "applied",
        applied_at: new Date().toISOString().slice(0, 10),
      });
      setRoles((prev) => prev.filter((r) => r.id !== role.id));
      setRolesTotal((t) => Math.max(0, t - 1));
      await loadSummary();
    } catch (err) {
      setStatus(`Failed to mark as applied: ${err.message}`);
    }
  }

  async function onSaveRoutine() {
    setIsSavingRoutine(true);
    try {
      const payload = {
        title_keywords: routineForm.title_keywords,
        description_keywords: routineForm.description_keywords,
        keyword_match_mode: routineForm.keyword_match_mode,
        max_role_age_days: Number(routineForm.max_role_age_days),
        frequency_minutes: Number(routineForm.frequency_minutes),
        company_ids: routineForm.company_ids.map(Number),
        use_followed_companies: routineForm.use_followed_companies,
      };

      let saved;
      if (routine) {
        saved = await updateFetchRoutine(payload);
      } else {
        saved = await createFetchRoutine(payload);
      }
      setRoutine(saved);
      setRoutineModalOpen(false);

      // Trigger an immediate fetch after first routine creation
      if (!routine) {
        setIsRunningNow(true);
        try {
          await runFetchNow();
          await Promise.all([loadSummary(), loadRoles(), loadFetchErrors()]);
        } catch (err) {
          setStatus(`Initial fetch failed: ${err.message}`);
        } finally {
          setIsRunningNow(false);
        }
      } else {
        await loadRoles();
      }
    } catch (err) {
      setStatus(`Failed to save fetch routine: ${err.message}`);
    } finally {
      setIsSavingRoutine(false);
    }
  }

  async function onDeleteRoutine() {
    try {
      await deleteFetchRoutine();
      setRoutine(null);
    } catch (err) {
      setStatus(`Failed to delete routine: ${err.message}`);
    }
  }

  function openRoutineModal() {
    if (routine) {
      setRoutineForm({
        title_keywords: routine.title_keywords || [],
        description_keywords: routine.description_keywords || [],
        keyword_match_mode: routine.keyword_match_mode || "any",
        max_role_age_days: String(routine.max_role_age_days ?? 14),
        frequency_minutes: String(routine.frequency_minutes ?? 720),
        company_ids: (routine.company_ids || []).map(String),
        use_followed_companies: routine.use_followed_companies ?? true,
      });
    } else {
      setRoutineForm({
        title_keywords: [],
        description_keywords: [],
        keyword_match_mode: "any",
        max_role_age_days: "14",
        frequency_minutes: "720",
        company_ids: [],
        use_followed_companies: true,
      });
    }
    setRoutineModalOpen(true);
  }

  /* Comparison */
  function updateComparisonField(key, value) {
    setComparisonForm((c) => ({ ...c, [key]: value }));
  }

  async function onUploadResumeInline(event) {
    event.preventDefault();
    if (!uploadFile) return;
    setIsUploadingResume(true);
    try {
      const result = await uploadResume(uploadFile);
      setUploadFile(null);
      await loadResumes();
      if (result.resume_version_id) updateComparisonField("resumeVersionId", String(result.resume_version_id));
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
    const selectedCompany = companies.find((c) => c.name.toLowerCase() === sourceText.toLowerCase());
    if (!selectedCompany && !sourceText) {
      setStatus("Select a source company or type a company name.");
      return;
    }
    setIsRunningComparison(true);
    setStatus("");
    try {
      const selectedResumeId = Number(comparisonForm.resumeVersionId);
      const diagnostics = await getResumeDiagnostics(selectedResumeId);
      if (!String(diagnostics?.extracted_text || "").trim()) {
        setStatus("Warning: selected resume has empty extracted text.");
        return;
      }
      const payload = {
        source_company_id: selectedCompany ? selectedCompany.id : undefined,
        source_company_name: selectedCompany ? undefined : sourceText,
        source_url: (comparisonForm.sourceUrl || "").trim() || undefined,
        title: (comparisonForm.title || "").trim() || "Untitled role",
        description_text: comparisonForm.descriptionText,
        resume_version_id: selectedResumeId,
        evaluation_mode: comparisonForm.evaluationMode || "chatgpt_api",
      };
      const result = await runComparison(payload);
      navigate(`/applications/application/${result.comparison_report_id}`);
    } catch (err) {
      setStatus(`Comparison failed: ${err.message}`);
    } finally {
      setIsRunningComparison(false);
    }
  }

  async function onScrapeComparisonUrl() {
    const sourceUrl = (comparisonForm.sourceUrl || "").trim();
    if (!sourceUrl) {
      setStatus("Enter a URL first, then click Scrape URL.");
      return;
    }
    setIsScrapingComparisonUrl(true);
    setStatus("");
    try {
      const result = await scrapeComparisonUrl(sourceUrl);
      setComparisonForm((c) => ({
        ...c,
        sourceText: c.sourceText || result.inferred_company_name || "",
        title: c.title || result.inferred_title || "",
        descriptionText: result.description_text || c.descriptionText,
      }));
    } catch (err) {
      setStatus(`URL scrape failed: ${err.message}`);
    } finally {
      setIsScrapingComparisonUrl(false);
    }
  }

  /* ── Derived data ───────────────────────────────────────────── */

  const statusTone = getStatusTone(status);
  const statusColor = statusTone === "error" ? "red" : statusTone === "warning" ? "yellow" : "blue";
  const companyOptions = [...new Map(companies.map((c) => [c.name, c])).values()].map((c) => ({
    value: c.name,
    label: c.name,
  }));
  const companyMultiSelectData = companies.map((c) => ({ value: String(c.id), label: c.name }));
  const resumeOptions = resumes.map((r) => ({
    value: String(r.id),
    label: `${r.source_name} (${r.version_tag})`,
  }));
  const hasRoutine = routine !== undefined && routine !== null;
  const isLoading = routine === undefined;

  /* ── Render ─────────────────────────────────────────────────── */

  return (
    <Stack gap="md">
      <Breadcrumbs>
        <Anchor component={Link} to="/dashboard">Dashboard</Anchor>
        <Text size="sm">Overview</Text>
      </Breadcrumbs>

      {/* ── Summary statistics ─────────────────────────────────── */}
      {summary && (
        <SimpleGrid cols={{ base: 2, sm: 4 }}>
          <Paper withBorder p="md" radius="md">
            <Text c="dimmed" size="sm">Followed Companies</Text>
            <Title order={3}>{summary.followed_companies_count}</Title>
          </Paper>
          <Paper withBorder p="md" radius="md">
            <Text c="dimmed" size="sm">Active Postings</Text>
            <Title order={3}>{summary.active_postings_count}</Title>
          </Paper>
          <Paper withBorder p="md" radius="md">
            <Text c="dimmed" size="sm">Applications</Text>
            <Title order={3}>{summary.applications_total_count}</Title>
          </Paper>
          <Paper withBorder p="md" radius="md">
            <Text c="dimmed" size="sm">New Postings (7d)</Text>
            <Title order={3}>{summary.recent_postings_count_7d}</Title>
          </Paper>
        </SimpleGrid>
      )}

      {/* ── Status alert (warnings/errors only) ───────────────── */}
      {status && (statusTone === "error" || statusTone === "warning") && (
        <Alert
          color={statusColor}
          icon={statusTone === "error" ? <AlertCircle size={16} /> : <Info size={16} />}
          variant="light"
          withCloseButton
          onClose={() => setStatus("")}
        >
          {status}
        </Alert>
      )}

      <div className="dashboard-grid">
        {/* ── LEFT COLUMN: Fetch routine + roles ───────────────── */}
        <section className="dashboard-main">
          {isLoading ? (
            <Paper withBorder p="xl" radius="md">
              <Text c="dimmed">Loading...</Text>
            </Paper>
          ) : !hasRoutine ? (
            /* ── Zero state ─────────────────────────────────────── */
            <Paper withBorder p="xl" radius="md">
              <Stack align="center" gap="md" py="xl">
                <RefreshCw size={48} strokeWidth={1.2} color="var(--mantine-color-dimmed)" />
                <Title order={3} ta="center">No fetch routine configured</Title>
                <Text c="dimmed" ta="center" maw={420}>
                  Create a fetch routine to automatically search for new roles across your followed companies.
                  Define keywords, set a schedule, and choose which companies to watch.
                </Text>
                <Button leftSection={<Plus size={16} />} onClick={openRoutineModal} size="md">
                  Create fetch routine
                </Button>
              </Stack>
            </Paper>
          ) : (
            /* ── Active state: roles table ─────────────────────── */
            <Paper withBorder p="md" radius="md">
              {/* Table title line */}
              <Group justify="space-between" mb="md">
                <div>
                  <Group gap="xs">
                    <Title order={4}>Fetched Roles</Title>
                    {rolesNewCount > 0 && (
                      <Badge variant="light" color="teal" size="lg">
                        {rolesNewCount} new
                      </Badge>
                    )}
                    <Text c="dimmed" size="sm">{rolesTotal} total</Text>
                  </Group>
                  <Text c="dimmed" size="xs" mt={2}>
                    {FREQUENCY_OPTIONS.find((f) => f.value === String(routine.frequency_minutes))?.label || `${routine.frequency_minutes}m`}
                  </Text>
                </div>
                <Group gap="xs">
                  <Tooltip label="Run fetch now">
                    <ActionIcon variant="light" onClick={onRunNow} loading={isRunningNow} size="lg">
                      <Play size={16} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label="Edit routine">
                    <ActionIcon variant="light" onClick={openRoutineModal} size="lg">
                      <Settings2 size={16} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label="Fetch logs">
                    <ActionIcon variant="light" component={Link} to="/fetch-logs" size="lg">
                      <History size={16} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              </Group>

              {/* Fetch error accordion */}
              {fetchErrors.length > 0 && (
                <Accordion variant="contained" radius="md" mt="sm">
                  <Accordion.Item value="fetch-errors">
                    <Accordion.Control icon={<AlertCircle size={18} color="var(--mantine-color-red-6)" />}>
                      <Group gap="xs">
                        <Text size="sm" fw={600} c="red">{fetchErrors.length} fetch error{fetchErrors.length !== 1 ? "s" : ""} from latest run</Text>
                      </Group>
                    </Accordion.Control>
                    <Accordion.Panel>
                      <Stack gap={6}>
                        {fetchErrors.map((err, i) => {
                          const colonIdx = err.indexOf(": ");
                          const company = colonIdx > 0 ? err.slice(0, colonIdx) : "Unknown";
                          const message = colonIdx > 0 ? err.slice(colonIdx + 2) : err;
                          return (
                            <Group key={i} gap={8} wrap="nowrap" align="flex-start">
                              <Badge color="red" variant="light" size="sm" style={{ flexShrink: 0 }}>{company}</Badge>
                              <Text size="sm">{message}</Text>
                            </Group>
                          );
                        })}
                      </Stack>
                    </Accordion.Panel>
                  </Accordion.Item>
                </Accordion>
              )}

              {/* Roles table — card-row grid matching platform pattern */}
              <Paper p="xs" radius="md" mt="xs" style={{ borderBottom: "1px solid var(--mantine-color-gray-3)" }}>
                <div style={{ display: "grid", gridTemplateColumns: "3.5fr 1.5fr 1.5fr 0.4fr", gap: 12, padding: "6px 8px" }}>
                  <Text fw={600} size="sm">Role</Text>
                  <Text fw={600} size="sm">Date Posted</Text>
                  <Text fw={600} size="sm">First Seen</Text>
                  <Text fw={600} size="sm"></Text>
                </div>
              </Paper>

              <Stack mt="xs" gap="xs">
                {roles.map((role) => (
                  <Paper key={role.id} p="sm" radius="md">
                    <div style={{ display: "grid", gridTemplateColumns: "3.5fr 1.5fr 1.5fr 0.4fr", gap: 12, alignItems: "center" }}>
                      <Group gap="sm" wrap="nowrap">
                        <Avatar src={role.company_logo_url} alt={role.company_name} size="md" radius={8}>
                          {role.company_name?.[0]}
                        </Avatar>
                        <Stack gap={2}>
                          {role.canonical_url && /^https?:\/\//.test(role.canonical_url) ? (
                            <Anchor href={role.canonical_url} target="_blank" rel="noopener" fw={600} size="sm" lineClamp={1}>
                              {role.title}
                            </Anchor>
                          ) : (
                            <Text fw={600} size="sm" lineClamp={1}>{role.title}</Text>
                          )}
                          <Anchor component={Link} to={`/companies/${role.company_id}`} size="xs" c="dimmed">
                            {role.company_name}
                          </Anchor>
                        </Stack>
                      </Group>
                      <Text size="sm" c="dimmed">
                        {role.posted_date ? formatDate(role.posted_date) : "—"}
                      </Text>
                      <Text size="sm" c="dimmed">
                        {role.first_seen_at ? formatDate(role.first_seen_at) : "—"}
                      </Text>
                      <Menu shadow="md" width={200} position="bottom-end" withArrow>
                        <Menu.Target>
                          <ActionIcon variant="subtle" size="sm">
                            <MoreVertical size={16} />
                          </ActionIcon>
                        </Menu.Target>
                        <Menu.Dropdown>
                          {role.canonical_url && /^https?:\/\//.test(role.canonical_url) && (
                            <Menu.Item
                              leftSection={<ExternalLink size={14} />}
                              component="a"
                              href={role.canonical_url}
                              target="_blank"
                              rel="noopener"
                            >
                              View listing
                            </Menu.Item>
                          )}
                          <Menu.Item
                            leftSection={<Pencil size={14} />}
                            component={Link}
                            to={`/applications`}
                          >
                            Edit role
                          </Menu.Item>
                          <Menu.Item
                            leftSection={<Briefcase size={14} />}
                            onClick={() => onMarkAsApplied(role)}
                          >
                            Mark as applied
                          </Menu.Item>
                          <Menu.Divider />
                          <Menu.Item
                            leftSection={<Trash2 size={14} />}
                            color="red"
                            onClick={() => onDeleteRole(role.id)}
                          >
                            Delete role
                          </Menu.Item>
                        </Menu.Dropdown>
                      </Menu>
                    </div>
                  </Paper>
                ))}
                {roles.length === 0 && (
                  <Paper p="md" radius="md">
                    <Text c="dimmed" ta="center" py="md">
                      No roles fetched yet. Click the play button to run a fetch.
                    </Text>
                  </Paper>
                )}
              </Stack>
            </Paper>
          )}
        </section>

        {/* ── RIGHT COLUMN: Comparison rail ────────────────────── */}
        <Paper withBorder p="md" radius="md" className="dashboard-rail">
          <Text fw={600}>Job Description Comparison</Text>
          <Text c="dimmed" size="sm">Paste a role description and evaluate it against a selected resume version.</Text>

          <form onSubmit={onRunComparison}>
            <Stack mt="sm">
              <Select
                label="Source"
                value={comparisonForm.sourceType}
                onChange={(value) => updateComparisonField("sourceType", value || "online")}
                disabled={isRunningComparison}
                data={[
                  { value: "online", label: "Online Job Listing" },
                  { value: "recruiter", label: "Recruiter" },
                ]}
                allowDeselect={false}
              />

              <Autocomplete
                label="Company Name"
                data={companyOptions}
                value={comparisonForm.sourceText || ""}
                onChange={(value) => updateComparisonField("sourceText", value || "")}
                placeholder="Type or select company"
                disabled={isRunningComparison}
              />

              <Select
                label="Evaluation mode"
                value={comparisonForm.evaluationMode}
                onChange={(value) => updateComparisonField("evaluationMode", value || "chatgpt_api")}
                disabled={isRunningComparison}
                data={[
                  { value: "chatgpt_api", label: "Manual Chat GPT" },
                  { value: "local_engine", label: "Run locally" },
                ]}
                allowDeselect={false}
              />

              {comparisonForm.sourceType === "online" && (
                <Group align="end">
                  <TextInput
                    style={{ flex: 1 }}
                    type="url"
                    label="URL"
                    value={comparisonForm.sourceUrl}
                    onChange={(event) => updateComparisonField("sourceUrl", event.target.value)}
                    placeholder="https://..."
                    disabled={isRunningComparison || isScrapingComparisonUrl}
                  />
                  <Button
                    type="button"
                    variant="light"
                    onClick={onScrapeComparisonUrl}
                    loading={isScrapingComparisonUrl}
                    disabled={isRunningComparison || isUploadingResume}
                  >
                    Scrape URL
                  </Button>
                </Group>
              )}

              <TextInput
                label="Role title"
                value={comparisonForm.title}
                onChange={(event) => updateComparisonField("title", event.target.value)}
                placeholder="Backend Engineer"
                disabled={isRunningComparison}
              />

              <Textarea
                label="Job description"
                rows={10}
                value={comparisonForm.descriptionText}
                onChange={(event) => updateComparisonField("descriptionText", event.target.value)}
                placeholder="Paste full job description"
                disabled={isRunningComparison}
              />

              <Select
                label="Compare against resume"
                placeholder="Select resume"
                data={resumeOptions}
                value={comparisonForm.resumeVersionId || null}
                onChange={(value) => updateComparisonField("resumeVersionId", value || "")}
                disabled={isRunningComparison || isUploadingResume}
              />

              <Group align="end">
                <FileInput
                  style={{ flex: 1 }}
                  label="Or upload new DOCX"
                  placeholder="Select .docx file"
                  accept=".docx"
                  onChange={setUploadFile}
                  value={uploadFile}
                  disabled={isUploadingResume || isRunningComparison}
                />
                <Button type="button" onClick={onUploadResumeInline} loading={isUploadingResume} disabled={isRunningComparison || !uploadFile}>
                  Upload & Select
                </Button>
              </Group>

              <Group>
                <Button type="submit" loading={isRunningComparison} disabled={isUploadingResume}>
                  Run Evaluation
                </Button>
              </Group>
            </Stack>
          </form>
        </Paper>
      </div>

      {/* ── Create / Edit Fetch Routine Modal ──────────────────── */}
      <Modal
        opened={routineModalOpen}
        onClose={() => setRoutineModalOpen(false)}
        title={hasRoutine ? "Edit Fetch Routine" : "Create Fetch Routine"}
        size="lg"
      >
        <Stack gap="md">
          <TagsInput
            label="Title keywords"
            description="Roles with titles containing any of these terms will be included"
            placeholder="e.g. software engineer, data analyst"
            value={routineForm.title_keywords}
            onChange={(val) => setRoutineForm((f) => ({ ...f, title_keywords: val }))}
          />

          <TagsInput
            label="Description keywords"
            description="Additional terms to match in role descriptions"
            placeholder="e.g. python, react, kubernetes"
            value={routineForm.description_keywords}
            onChange={(val) => setRoutineForm((f) => ({ ...f, description_keywords: val }))}
          />

          <Select
            label="Keyword match mode"
            description="Match any keyword or require all keywords"
            data={[
              { value: "any", label: "Match any keyword" },
              { value: "all", label: "Match all keywords" },
            ]}
            value={routineForm.keyword_match_mode}
            onChange={(val) => setRoutineForm((f) => ({ ...f, keyword_match_mode: val || "any" }))}
            allowDeselect={false}
          />

          <Select
            label="Max role age"
            description="Only show roles first seen within this window"
            data={MAX_AGE_OPTIONS}
            value={routineForm.max_role_age_days}
            onChange={(val) => setRoutineForm((f) => ({ ...f, max_role_age_days: val || "14" }))}
            allowDeselect={false}
          />

          <Select
            label="Fetch frequency"
            description="How often the system checks for new roles"
            data={FREQUENCY_OPTIONS}
            value={routineForm.frequency_minutes}
            onChange={(val) => setRoutineForm((f) => ({ ...f, frequency_minutes: val || "720" }))}
            allowDeselect={false}
          />

          <Checkbox
            label="Include all followed companies"
            checked={routineForm.use_followed_companies}
            onChange={(event) => setRoutineForm((f) => ({ ...f, use_followed_companies: event.currentTarget.checked }))}
          />

          <MultiSelect
            label="Additional companies"
            description={routineForm.use_followed_companies ? "Select specific companies to include alongside followed ones" : "Select which companies to fetch roles from"}
            data={companyMultiSelectData}
            value={routineForm.company_ids}
            onChange={(val) => setRoutineForm((f) => ({ ...f, company_ids: val }))}
            placeholder="Search companies..."
            searchable
            clearable
          />

          <Group justify="space-between" mt="md">
            <Group>
              {hasRoutine && (
                <Button
                  variant="subtle"
                  color="red"
                  leftSection={<Trash2 size={14} />}
                  onClick={() => {
                    onDeleteRoutine();
                    setRoutineModalOpen(false);
                  }}
                >
                  Delete routine
                </Button>
              )}
            </Group>
            <Group>
              <Button variant="default" onClick={() => setRoutineModalOpen(false)}>
                Cancel
              </Button>
              <Button onClick={onSaveRoutine} loading={isSavingRoutine}>
                {hasRoutine ? "Save changes" : "Create & run fetch"}
              </Button>
            </Group>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
