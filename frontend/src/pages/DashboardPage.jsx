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
  Collapse,
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
  Archive,
  ArchiveRestore,
  BarChart2,
  Briefcase,
  CheckCircle,
  ChevronDown,
  ChevronUp,
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
  X,
} from "lucide-react";

import {
  archiveJobPosting,
  createApplication,
  createFetchRoutine,
  deleteFetchRoutine,
  deleteJobPosting,
  getLifecycleWarnings,
  updateCompany,
  updateJobPosting,
  getCompanies,
  getDashboardSummary,
  getFetchedRoles,
  getFetchPreflight,
  getFetchRoutine,
  getFetchRuns,
  getJobPostings,
  getResumeDiagnostics,
  getResumes,
  runComparison,
  runFetchNow,
  saveFetchSearchUrls,
  scrapeComparisonUrl,
  setComparisonApplicationDecision,
  testFetchCompany,
  unarchiveJobPosting,
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

/** Return a relative-time string: "<1 hour", "X hour(s)", "X day(s)" (up to 30), exact date after */
function timeAgo(value) {
  if (!value) return { relative: "\u2014", exact: "" };
  const d = value.includes("T") || /^\d{4}-\d{2}-\d{2} /.test(value)
    ? new Date(value + (value.endsWith("Z") ? "" : "Z"))
    : new Date(value);
  if (Number.isNaN(d.getTime())) return { relative: value, exact: "" };
  const exact = formatDate(value);
  const now = new Date();
  const diffMs = now - d;
  if (diffMs < 0) return { relative: exact, exact };
  const diffHours = diffMs / (1000 * 60 * 60);
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffHours < 1) return { relative: "<1 hour ago", exact };
  if (diffDays < 1) {
    const h = Math.floor(diffHours);
    return { relative: `${h} hour${h === 1 ? "" : "s"} ago`, exact };
  }
  if (diffDays <= 30) {
    return { relative: `${diffDays} day${diffDays === 1 ? "" : "s"} ago`, exact };
  }
  return { relative: exact, exact };
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
  const [fetchErrorsDismissed, setFetchErrorsDismissed] = useState(false);

  /* Quick-edit company modal (opened from fetch errors) */
  const [editCompanyModalOpen, setEditCompanyModalOpen] = useState(false);
  const [editCompanyData, setEditCompanyData] = useState(null); // { id, name, careers_url, search_url, portal_type }
  const [editCompanyForm, setEditCompanyForm] = useState({ careers_url: "", search_url: "" });
  const [isSavingCompanyEdit, setIsSavingCompanyEdit] = useState(false);
  const [editCompanyTestResult, setEditCompanyTestResult] = useState(null); // { success, message }

  /* Archived roles */
  const [archivedPostings, setArchivedPostings] = useState([]);
  const [showArchivedSection, setShowArchivedSection] = useState(false);
  const [lifecycleWarnings, setLifecycleWarnings] = useState(null);

  /* UI state */
  const [status, setStatus] = useState("");
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isRunningNow, setIsRunningNow] = useState(false);
  const [fetchSuccessMsg, setFetchSuccessMsg] = useState("");
  const [isRunningComparison, setIsRunningComparison] = useState(false);
  const [isUploadingResume, setIsUploadingResume] = useState(false);
  const [isScrapingComparisonUrl, setIsScrapingComparisonUrl] = useState(false);
  const [routineModalOpen, setRoutineModalOpen] = useState(false);
  const [isSavingRoutine, setIsSavingRoutine] = useState(false);

  /* Preflight modal state */
  const [preflightModalOpen, setPreflightModalOpen] = useState(false);
  const [preflightReady, setPreflightReady] = useState([]);
  const [preflightNeedsInput, setPreflightNeedsInput] = useState([]);
  const [preflightUrlInputs, setPreflightUrlInputs] = useState({}); // { companyId: url }
  const [preflightSkips, setPreflightSkips] = useState(new Set()); // companyIds to skip
  const [isSavingPreflight, setIsSavingPreflight] = useState(false);

  /* Comparison form */
  const [comparisonForm, setComparisonForm] = useState({
    sourceType: "online",
    sourceText: "",
    sourceUrl: "",
    title: "",
    descriptionText: "",
    resumeVersionId: "",
    evaluationMode: "gemini_api",
  });
  const [uploadFile, setUploadFile] = useState(null);

  /* Inline "Did you apply?" prompt */
  const [appliedPromptRoleId, setAppliedPromptRoleId] = useState(null);
  const [isAutoApplying, setIsAutoApplying] = useState(false);

  /* Inline title editing */
  const [editingTitleId, setEditingTitleId] = useState(null);
  const [editingTitleValue, setEditingTitleValue] = useState("");

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
          const newErrs = Array.isArray(errs) ? errs : [];
          setFetchErrors((prev) => {
            // Reset dismissed state if errors changed
            if (JSON.stringify(prev) !== JSON.stringify(newErrs)) {
              setFetchErrorsDismissed(false);
            }
            return newErrs;
          });
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

  async function loadArchivedPostings() {
    try {
      const result = await getJobPostings({ status: "active", limit: 500 });
      setArchivedPostings((result.items || []).filter((p) => p.archived_at));
    } catch {
      /* silent */
    }
  }

  async function loadLifecycleWarnings() {
    try {
      const warnings = await getLifecycleWarnings();
      setLifecycleWarnings(warnings);
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
    loadArchivedPostings();
    loadLifecycleWarnings();
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  /* ── Actions ────────────────────────────────────────────────── */

  async function onRunNow() {
    // Run preflight check first
    setStatus("");
    setFetchSuccessMsg("");
    try {
      const preflight = await getFetchPreflight();
      const needs = preflight.needs_input || [];
      const ready = preflight.ready || [];

      if (needs.length > 0) {
        // Some companies need input — show preflight modal
        setPreflightReady(ready);
        setPreflightNeedsInput(needs);
        setPreflightUrlInputs({});
        setPreflightSkips(new Set());
        setPreflightModalOpen(true);
        return;
      }

      // All companies ready — run fetch directly
      await executeFetch([]);
    } catch (err) {
      setStatus(`Preflight check failed: ${err.message}`);
    }
  }

  async function executeFetch(exemptCompanyIds) {
    setIsRunningNow(true);
    setStatus("");
    setFetchSuccessMsg("");
    try {
      const result = await runFetchNow(exemptCompanyIds);
      await Promise.all([loadSummary(), loadRoles(), loadFetchErrors(), loadArchivedPostings()]);
      const newCount = result?.postings_new ?? 0;
      const updatedCount = result?.postings_updated ?? 0;
      const checkedCount = result?.companies_checked ?? 0;
      if (newCount > 0) {
        setFetchSuccessMsg(`Fetch complete — ${newCount} new role${newCount !== 1 ? "s" : ""} found across ${checkedCount} companies.`);
      } else if (updatedCount > 0) {
        setFetchSuccessMsg(`Fetch complete — ${updatedCount} role${updatedCount !== 1 ? "s" : ""} refreshed, no new roles. ${checkedCount} companies checked.`);
      } else {
        setFetchSuccessMsg(`Fetch complete — no new roles found. ${checkedCount} companies checked.`);
      }
    } catch (err) {
      setStatus(`Fetch failed: ${err.message}`);
    } finally {
      setIsRunningNow(false);
    }
  }

  async function onPreflightContinue() {
    setIsSavingPreflight(true);
    try {
      // Save any search URLs the user entered
      const updates = Object.entries(preflightUrlInputs)
        .filter(([, url]) => url.trim())
        .map(([companyId, url]) => ({ company_id: Number(companyId), search_url: url.trim() }));

      if (updates.length > 0) {
        await saveFetchSearchUrls(updates);
      }

      // Build exempt list: companies the user chose to skip AND ones that still have no URL
      const exemptIds = [...preflightSkips];
      for (const c of preflightNeedsInput) {
        const hasNewUrl = preflightUrlInputs[c.id]?.trim();
        const isSkipped = preflightSkips.has(c.id);
        if (!hasNewUrl && !isSkipped) {
          // No URL provided and not explicitly skipped — auto-exempt
          exemptIds.push(c.id);
        }
      }

      setPreflightModalOpen(false);
      await executeFetch([...new Set(exemptIds)]);
    } catch (err) {
      setStatus(`Failed to save search URLs: ${err.message}`);
    } finally {
      setIsSavingPreflight(false);
    }
  }

  async function onDeleteRole(postingId) {
    try {
      await deleteJobPosting(postingId);
      setRoles((prev) => prev.filter((r) => r.id !== postingId));
      setRolesTotal((t) => Math.max(0, t - 1));
      setArchivedPostings((prev) => prev.filter((p) => p.id !== postingId));
    } catch (err) {
      setStatus(`Failed to delete role: ${err.message}`);
    }
  }

  async function onMarkAsApplied(role) {
    if (!resumes.length) {
      setStatus("Upload a resume first — a comparison report is created when marking as applied.");
      return;
    }
    const defaultResume = resumes[0];
    setIsRunningComparison(true);
    try {
      // 1. Scrape description if needed
      let descText = role.description_text || "";
      if (descText.length < 40 && role.canonical_url) {
        try {
          const scraped = await scrapeComparisonUrl(role.canonical_url);
          descText = scraped.description_text || descText;
        } catch { /* fall through */ }
      }

      let reportId = null;
      let fallbackQs = "";

      // 2. Create comparison report if description is long enough
      if (descText.length >= 40) {
        const result = await runComparison({
          source_company_id: role.company_id,
          title: role.title,
          description_text: descText,
          resume_version_id: defaultResume.id,
          source_url: role.canonical_url || undefined,
        });
        reportId = result?.comparison_report_id || result?.id;
        if (result.fallback_reason) fallbackQs = "?fallback=1";

        // 3. Mark comparison as "applied"
        if (reportId) {
          await setComparisonApplicationDecision(reportId, true);
        }
      }

      // 4. Create application entry
      await createApplication({
        job_posting_id: role.id,
        stage: "applied",
        applied_at: new Date().toISOString().slice(0, 10),
      });

      // 5. Remove from feed
      setRoles((prev) => prev.filter((r) => r.id !== role.id));
      setRolesTotal((t) => Math.max(0, t - 1));
      await loadSummary();

      // 6. Navigate to report if created
      if (reportId) {
        navigate(`/applications/application/${reportId}${fallbackQs}`);
      } else {
        setStatus("Marked as applied (description too short for comparison report).");
      }
    } catch (err) {
      setStatus(`Failed to mark as applied: ${err.message}`);
    } finally {
      setIsRunningComparison(false);
    }
  }

  async function onSaveTitleEdit(roleId) {
    const trimmed = editingTitleValue.trim();
    if (!trimmed) return;
    try {
      await updateJobPosting(roleId, { title: trimmed });
      setRoles((prev) => prev.map((r) => (r.id === roleId ? { ...r, title: trimmed } : r)));
      setEditingTitleId(null);
    } catch (err) {
      setStatus(`Failed to update title: ${err.message}`);
    }
  }

  async function onCreateComparison(role) {
    if (!resumes.length) {
      setStatus("Upload a resume first before creating a comparison report.");
      return;
    }
    const defaultResume = resumes[0];
    try {
      setIsRunningComparison(true);
      // Use the role's description_text if available, otherwise scrape the URL
      let descText = role.description_text || "";
      if (descText.length < 40 && role.canonical_url) {
        try {
          const scraped = await scrapeComparisonUrl(role.canonical_url);
          descText = scraped.description_text || descText;
        } catch {
          /* fall through with short text */
        }
      }
      if (descText.length < 40) {
        // Navigate to comparison page with pre-filled data instead
        navigate(`/comparisons`);
        setStatus("Description too short for comparison. Please create manually.");
        return;
      }
      const result = await runComparison({
        source_company_id: role.company_id,
        title: role.title,
        description_text: descText,
        resume_version_id: defaultResume.id,
        source_url: role.canonical_url || undefined,
      });
      const reportId = result?.comparison_report_id || result?.id;
      if (reportId) {
        const fallbackQs = result.fallback_reason ? "?fallback=1" : "";
        navigate(`/applications/application/${reportId}${fallbackQs}`);
      }
    } catch (err) {
      setStatus(`Comparison failed: ${err.message}`);
    } finally {
      setIsRunningComparison(false);
    }
  }

  /** Auto-create comparison report + mark as applied when user confirms from the inline prompt */
  async function onConfirmApplied(role) {
    if (!resumes.length) {
      setStatus("Upload a resume first before marking as applied with comparison.");
      setAppliedPromptRoleId(null);
      return;
    }
    const defaultResume = resumes[0];
    setIsAutoApplying(true);
    try {
      // 1. Scrape description if needed
      let descText = role.description_text || "";
      if (descText.length < 40 && role.canonical_url) {
        try {
          const scraped = await scrapeComparisonUrl(role.canonical_url);
          descText = scraped.description_text || descText;
        } catch {
          /* fall through */
        }
      }

      let reportId = null;
      let fallbackQs = "";

      // 2. Create comparison report (if description available)
      if (descText.length >= 40) {
        const result = await runComparison({
          source_company_id: role.company_id,
          title: role.title,
          description_text: descText,
          resume_version_id: defaultResume.id,
          source_url: role.canonical_url || undefined,
        });
        reportId = result?.comparison_report_id || result?.id;
        if (result.fallback_reason) fallbackQs = "?fallback=1";

        // 3. Mark comparison as "applied"
        if (reportId) {
          await setComparisonApplicationDecision(reportId, true);
        }
      }

      // 4. Create application entry
      await createApplication({
        job_posting_id: role.id,
        stage: "applied",
        applied_at: new Date().toISOString().slice(0, 10),
      });

      // 5. Remove from feed
      setRoles((prev) => prev.filter((r) => r.id !== role.id));
      setRolesTotal((t) => Math.max(0, t - 1));
      setAppliedPromptRoleId(null);
      await loadSummary();

      // 6. Navigate to the comparison report if one was created
      if (reportId) {
        navigate(`/applications/application/${reportId}${fallbackQs}`);
      } else {
        setStatus("Marked as applied (description too short for comparison).");
      }
    } catch (err) {
      setStatus(`Auto-apply failed: ${err.message}`);
    } finally {
      setIsAutoApplying(false);
    }
  }

  async function onArchiveRole(postingId) {
    try {
      await archiveJobPosting(postingId);
      setRoles((prev) => prev.filter((r) => r.id !== postingId));
      setRolesTotal((t) => Math.max(0, t - 1));
      await loadArchivedPostings();
    } catch (err) {
      setStatus(`Failed to archive role: ${err.message}`);
    }
  }

  async function onUnarchiveRole(postingId) {
    try {
      await unarchiveJobPosting(postingId);
      await Promise.all([loadRoles(), loadArchivedPostings()]);
    } catch (err) {
      setStatus(`Failed to unarchive role: ${err.message}`);
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
        await onRunNow();
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
        evaluation_mode: comparisonForm.evaluationMode || "gemini_api",
      };
      const result = await runComparison(payload);
      const fallbackQs = result.fallback_reason ? "?fallback=1" : "";
      navigate(`/applications/application/${result.comparison_report_id}${fallbackQs}`);
      if (result.fallback_reason) {
        setStatus(`Gemini unavailable — manual LLM import opened. ${result.fallback_reason}`);
      }
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

      {/* ── Fetch success notification ─────────────────────────── */}
      {fetchSuccessMsg && (
        <Alert
          color="teal"
          icon={<CheckCircle size={16} />}
          variant="light"
          withCloseButton
          onClose={() => setFetchSuccessMsg("")}
        >
          {fetchSuccessMsg}
        </Alert>
      )}

      {/* ── Lifecycle warning banner ──────────────────────────── */}
      {lifecycleWarnings && (lifecycleWarnings.approaching_archive > 0 || lifecycleWarnings.approaching_delete > 0 || lifecycleWarnings.approaching_retention > 0) && (
        <Alert
          color="orange"
          icon={<AlertCircle size={16} />}
          variant="light"
          withCloseButton
          onClose={() => setLifecycleWarnings(null)}
          title="Upcoming automatic actions"
        >
          <Stack gap={4}>
            {lifecycleWarnings.approaching_archive > 0 && (
              <Text size="sm">{lifecycleWarnings.approaching_archive} role(s) not viewed in 23+ days will be <strong>auto-archived</strong> within 7 days.</Text>
            )}
            {lifecycleWarnings.approaching_delete > 0 && (
              <Text size="sm">{lifecycleWarnings.approaching_delete} archived role(s) will be <strong>permanently deleted</strong> within 14 days.</Text>
            )}
            {lifecycleWarnings.approaching_retention > 0 && (
              <Text size="sm">{lifecycleWarnings.approaching_retention} inactive role(s) approaching the retention limit will be <strong>removed</strong> soon.</Text>
            )}
          </Stack>
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
                    {summary?.latest_fetch_completed_at && (() => {
                      const ta = timeAgo(summary.latest_fetch_completed_at);
                      return ta.exact ? (
                        <Tooltip label={ta.exact} withArrow><span> · Last updated {ta.relative}</span></Tooltip>
                      ) : (
                        <> · Last updated {ta.relative}</>
                      );
                    })()}
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
              {fetchErrors.length > 0 && !fetchErrorsDismissed && (
                <Accordion variant="contained" radius="md" mt="sm">
                  <Accordion.Item value="fetch-errors">
                    <Accordion.Control icon={<AlertCircle size={18} color="var(--mantine-color-red-6)" />}>
                      <Group gap="xs" justify="space-between" wrap="nowrap" style={{ width: '100%' }}>
                        <Text size="sm" fw={600} c="red">{fetchErrors.length} fetch error{fetchErrors.length !== 1 ? "s" : ""} from latest run</Text>
                      </Group>
                    </Accordion.Control>
                    <Accordion.Panel>
                      <Stack gap={6}>
                        {fetchErrors.map((err, i) => {
                          const colonIdx = err.indexOf(": ");
                          const companyName = colonIdx > 0 ? err.slice(0, colonIdx) : "Unknown";
                          const message = colonIdx > 0 ? err.slice(colonIdx + 2) : err;
                          const matchedCompany = companies.find(
                            (c) => String(c.name || "").toLowerCase() === companyName.toLowerCase()
                          );
                          return (
                            <Group key={i} gap={8} wrap="nowrap" align="flex-start">
                              <Badge
                                color="red"
                                variant="light"
                                size="sm"
                                style={{ flexShrink: 0, cursor: matchedCompany ? "pointer" : "default" }}
                                onClick={() => {
                                  if (matchedCompany) {
                                    setEditCompanyData(matchedCompany);
                                    setEditCompanyForm({
                                      careers_url: matchedCompany.careers_url || "",
                                      search_url: matchedCompany.search_url || "",
                                    });
                                    setEditCompanyModalOpen(true);
                                  }
                                }}
                                title={matchedCompany ? "Click to edit company" : undefined}
                              >
                                {companyName}{matchedCompany ? " ✎" : ""}
                              </Badge>
                              <Text size="sm">{message}</Text>
                            </Group>
                          );
                        })}
                        <Group justify="flex-end" mt={4}>
                          <Button size="xs" variant="subtle" color="gray" leftSection={<X size={14} />} onClick={() => setFetchErrorsDismissed(true)}>Dismiss</Button>
                        </Group>
                      </Stack>
                    </Accordion.Panel>
                  </Accordion.Item>
                </Accordion>
              )}

              {/* Roles table — card-row grid matching platform pattern */}
              <Paper p="xs" radius="md" mt="xs" style={{ borderBottom: "1px solid var(--mantine-color-gray-3)" }}>
                <div style={{ display: "grid", gridTemplateColumns: "3.5fr 1.2fr 1.2fr 0.4fr", gap: 12, padding: "6px 8px" }}>
                  <Text fw={600} size="sm">Role</Text>
                  <Text fw={600} size="sm">Date Posted</Text>
                  <Text fw={600} size="sm">First Seen</Text>
                  <Text fw={600} size="sm"></Text>
                </div>
              </Paper>

              <Stack mt="xs" gap="xs">
                {roles.map((role) => (
                  <Paper key={role.id} p="sm" radius="md">
                    <div style={{ display: "grid", gridTemplateColumns: "3.5fr 1.2fr 1.2fr 0.4fr", gap: 12, alignItems: "center" }}>
                      <Group gap="sm" wrap="nowrap">
                        <Avatar src={role.company_logo_url} alt={role.company_name} size="md" radius={8}>
                          {role.company_name?.[0]}
                        </Avatar>
                        <Stack gap={2}>
                          {editingTitleId === role.id ? (
                            <TextInput
                              size="xs"
                              value={editingTitleValue}
                              onChange={(e) => setEditingTitleValue(e.currentTarget.value)}
                              onBlur={() => onSaveTitleEdit(role.id)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") onSaveTitleEdit(role.id);
                                if (e.key === "Escape") setEditingTitleId(null);
                              }}
                              autoFocus
                              style={{ minWidth: 200 }}
                            />
                          ) : role.canonical_url && /^https?:\/\//.test(role.canonical_url) ? (
                            <Anchor
                              href={role.canonical_url}
                              target="_blank"
                              rel="noopener"
                              fw={600}
                              size="sm"
                              lineClamp={1}
                              onClick={() => setAppliedPromptRoleId(role.id)}
                            >
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
                      {(() => {
                        const ta = role.posted_date ? timeAgo(role.posted_date) : null;
                        return ta ? (
                          ta.exact ? <Tooltip label={ta.exact} withArrow><Text size="sm" c="dimmed">{ta.relative}</Text></Tooltip>
                            : <Text size="sm" c="dimmed">{ta.relative}</Text>
                        ) : <Text size="sm" c="dimmed">—</Text>;
                      })()}
                      {(() => {
                        const ta = role.first_seen_at ? timeAgo(role.first_seen_at) : null;
                        return ta ? (
                          ta.exact ? <Tooltip label={ta.exact} withArrow><Text size="sm" c="dimmed">{ta.relative}</Text></Tooltip>
                            : <Text size="sm" c="dimmed">{ta.relative}</Text>
                        ) : <Text size="sm" c="dimmed">—</Text>;
                      })()}
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
                            onClick={() => {
                              setEditingTitleId(role.id);
                              setEditingTitleValue(role.title);
                            }}
                          >
                            Edit title
                          </Menu.Item>
                          <Menu.Item
                            leftSection={<BarChart2 size={14} />}
                            onClick={() => onCreateComparison(role)}
                            disabled={isRunningComparison}
                          >
                            Create comparison report
                          </Menu.Item>
                          <Menu.Item
                            leftSection={<Briefcase size={14} />}
                            onClick={() => onMarkAsApplied(role)}
                            disabled={isRunningComparison}
                          >
                            Mark as applied
                          </Menu.Item>
                          <Menu.Item
                            leftSection={<Archive size={14} />}
                            onClick={() => onArchiveRole(role.id)}
                          >
                            Archive
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

                    {/* Inline "Did you apply?" prompt */}
                    <Collapse in={appliedPromptRoleId === role.id}>
                      <Paper
                        mt="xs"
                        p="xs"
                        radius="md"
                        style={{ background: "var(--mantine-color-blue-0)", border: "1px solid var(--mantine-color-blue-2)" }}
                      >
                        <Group justify="space-between" align="center">
                          <Text size="sm" fw={500}>Did you apply to this role?</Text>
                          <Group gap="xs">
                            <Button
                              size="xs"
                              color="teal"
                              variant="filled"
                              leftSection={<CheckCircle size={14} />}
                              loading={isAutoApplying}
                              onClick={() => onConfirmApplied(role)}
                            >
                              Yes, I applied
                            </Button>
                            <Button
                              size="xs"
                              variant="default"
                              onClick={() => setAppliedPromptRoleId(null)}
                              disabled={isAutoApplying}
                            >
                              No
                            </Button>
                          </Group>
                        </Group>
                      </Paper>
                    </Collapse>
                  </Paper>
                ))}
                {roles.length === 0 && (
                  <Paper p="md" radius="md">
                    <Text c="dimmed" ta="center" py="md">
                      No new roles to review. Roles you've applied to or archived won't appear here.
                    </Text>
                  </Paper>
                )}
              </Stack>

              {/* ── Archived Roles Accordion ──────────────────── */}
              {archivedPostings.length > 0 && (
                <Paper mt="md" radius="md">
                  <Group
                    justify="space-between"
                    p="sm"
                    style={{ cursor: "pointer" }}
                    onClick={() => setShowArchivedSection((v) => !v)}
                  >
                    <Group gap="xs">
                      <Archive size={16} color="var(--mantine-color-dimmed)" />
                      <Text fw={600} size="sm">Hidden Roles</Text>
                      <Badge variant="light" color="gray" size="sm">{archivedPostings.length}</Badge>
                    </Group>
                    {showArchivedSection ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </Group>
                  <Collapse in={showArchivedSection}>
                    <Stack gap="xs" p="sm" pt={0}>
                      {archivedPostings.map((posting) => (
                        <Paper key={posting.id} p="xs" radius="md" withBorder>
                          <Group justify="space-between" wrap="nowrap">
                            <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                              <Avatar src={posting.company_logo_url} alt={posting.company_name} size="sm" radius={6}>
                                {posting.company_name?.[0]}
                              </Avatar>
                              <div style={{ minWidth: 0 }}>
                                <Text fw={500} size="sm" lineClamp={1}>{posting.title}</Text>
                                <Text size="xs" c="dimmed">{posting.company_name} · Archived {(() => { const ta = timeAgo(posting.archived_at); return ta.exact ? <Tooltip label={ta.exact} withArrow><span>{ta.relative}</span></Tooltip> : ta.relative; })()}</Text>
                              </div>
                            </Group>
                            <Group gap="xs" wrap="nowrap">
                              <Tooltip label="Unarchive">
                                <ActionIcon variant="subtle" size="sm" onClick={() => onUnarchiveRole(posting.id)}>
                                  <ArchiveRestore size={14} />
                                </ActionIcon>
                              </Tooltip>
                              <Tooltip label="Delete permanently">
                                <ActionIcon variant="subtle" color="red" size="sm" onClick={() => onDeleteRole(posting.id)}>
                                  <Trash2 size={14} />
                                </ActionIcon>
                              </Tooltip>
                            </Group>
                          </Group>
                        </Paper>
                      ))}
                    </Stack>
                  </Collapse>
                </Paper>
              )}
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
                onChange={(value) => updateComparisonField("evaluationMode", value || "gemini_api")}
                disabled={isRunningComparison}
                data={[
                  { value: "gemini_api", label: "Gemini AI (auto)" },
                  { value: "chatgpt_api", label: "Import external LLM response" },
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
            onChange={(event) => { const c = event.currentTarget.checked; setRoutineForm((f) => ({ ...f, use_followed_companies: c })); }}
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

      {/* ── Preflight Modal ─────────────────────────────────────── */}
      <Modal
        opened={preflightModalOpen}
        onClose={() => setPreflightModalOpen(false)}
        title="Configure company portals"
        size="lg"
      >
        <Stack gap="md">
          {preflightReady.length > 0 && (
            <Alert color="teal" variant="light" icon={<CheckCircle size={16} />}>
              {preflightReady.length} compan{preflightReady.length === 1 ? "y is" : "ies are"} ready to fetch
              ({preflightReady.map((c) => c.name).join(", ")})
            </Alert>
          )}

          {preflightNeedsInput.length > 0 && (
            <>
              <Text size="sm" c="dimmed">
                The following companies don't have a search portal configured.
                Enter a job search URL, or check "Skip" to exclude them from this fetch.
              </Text>

              {preflightNeedsInput.map((company) => (
                <Paper key={company.id} p="sm" withBorder>
                  <Group justify="space-between" mb={4}>
                    <Text fw={600} size="sm">{company.name}</Text>
                    <Checkbox
                      label="Skip this time"
                      size="xs"
                      checked={preflightSkips.has(company.id)}
                      onChange={(e) => {
                        const isChecked = e.currentTarget.checked;
                        setPreflightSkips((prev) => {
                          const next = new Set(prev);
                          if (isChecked) next.add(company.id);
                          else next.delete(company.id);
                          return next;
                        });
                      }}
                    />
                  </Group>
                  {company.careers_url && (
                    <Text size="xs" c="dimmed" mb={4} truncate>
                      Careers page: {company.careers_url}
                    </Text>
                  )}
                  <TextInput
                    placeholder="https://company.example.com/search-jobs"
                    size="xs"
                    disabled={preflightSkips.has(company.id)}
                    value={preflightUrlInputs[company.id] || ""}
                    onChange={(e) => {
                      const val = e.currentTarget.value;
                      setPreflightUrlInputs((prev) => ({
                        ...prev,
                        [company.id]: val,
                      }));
                    }}
                  />
                </Paper>
              ))}
            </>
          )}

          <Group justify="flex-end" mt="sm">
            <Button variant="default" onClick={() => setPreflightModalOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={onPreflightContinue}
              loading={isSavingPreflight}
            >
              {preflightNeedsInput.every((c) => preflightSkips.has(c.id))
                ? "Skip all & fetch"
                : "Save & fetch"}
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* Quick-edit company modal (from fetch errors) */}
      <Modal
        opened={editCompanyModalOpen}
        onClose={() => { setEditCompanyModalOpen(false); setEditCompanyData(null); setEditCompanyTestResult(null); }}
        title={editCompanyData ? `Edit ${editCompanyData.name}` : "Edit company"}
        centered
      >
        <Stack>
          <TextInput
            label="Careers / Job board URL"
            type="url"
            placeholder="https://company.com/careers"
            value={editCompanyForm.careers_url}
            onChange={(e) => { const v = e.currentTarget.value; setEditCompanyForm((f) => ({ ...f, careers_url: v })); }}
            disabled={isSavingCompanyEdit}
          />
          <TextInput
            label="Search portal URL"
            type="url"
            placeholder="https://company.com/search-jobs?q="
            value={editCompanyForm.search_url}
            onChange={(e) => { const v = e.currentTarget.value; setEditCompanyForm((f) => ({ ...f, search_url: v })); }}
            disabled={isSavingCompanyEdit}
          />
          {editCompanyData?.portal_type && (
            <Text size="xs" c="dimmed">Detected portal type: <strong>{editCompanyData.portal_type}</strong></Text>
          )}
          {editCompanyTestResult && (
            <Alert
              color={editCompanyTestResult.success ? "green" : "red"}
              icon={editCompanyTestResult.success ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
              variant="light"
              withCloseButton
              onClose={() => setEditCompanyTestResult(null)}
            >
              {editCompanyTestResult.message}
            </Alert>
          )}
          <Group justify="flex-end" mt="sm">
            <Button
              variant="light"
              size="xs"
              leftSection={<Play size={14} />}
              loading={isSavingCompanyEdit}
              onClick={async () => {
                if (!editCompanyData) return;
                setIsSavingCompanyEdit(true);
                setEditCompanyTestResult(null);
                try {
                  // Save first so portal_type gets auto-detected
                  const updated = await updateCompany(editCompanyData.id, {
                    name: editCompanyData.name,
                    careers_url: editCompanyForm.careers_url || null,
                    search_url: editCompanyForm.search_url || null,
                  });
                  setEditCompanyData(updated);
                  // Then test
                  const result = await testFetchCompany(editCompanyData.id);
                  if (result.errors && result.errors.length > 0) {
                    setEditCompanyTestResult({ success: false, message: result.errors.join("; ") });
                  } else {
                    setEditCompanyTestResult({ success: true, message: `Found ${result.postings_found} posting${result.postings_found !== 1 ? "s" : ""}. Portal type: ${result.portal_type || "unknown"}` });
                  }
                } catch (err) {
                  setEditCompanyTestResult({ success: false, message: `Test failed: ${err.message}` });
                } finally {
                  setIsSavingCompanyEdit(false);
                }
              }}
            >Save & Test</Button>
            <Button variant="default" onClick={() => { setEditCompanyModalOpen(false); setEditCompanyData(null); setEditCompanyTestResult(null); }} disabled={isSavingCompanyEdit}>Cancel</Button>
            <Button
              loading={isSavingCompanyEdit}
              onClick={async () => {
                if (!editCompanyData) return;
                setIsSavingCompanyEdit(true);
                try {
                  await updateCompany(editCompanyData.id, {
                    name: editCompanyData.name,
                    careers_url: editCompanyForm.careers_url || null,
                    search_url: editCompanyForm.search_url || null,
                  });
                  setEditCompanyModalOpen(false);
                  setEditCompanyData(null);
                  setEditCompanyTestResult(null);
                  await loadCompanies();
                  await loadFetchErrors();
                } catch (err) {
                  setStatus(`Failed to update company: ${err.message}`);
                } finally {
                  setIsSavingCompanyEdit(false);
                }
              }}
            >Save</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
