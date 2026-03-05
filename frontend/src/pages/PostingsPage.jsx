import { useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Alert,
  Anchor,
  Avatar,
  Breadcrumbs,
  Button,
  Group,
  Menu,
  Paper,
  Select,
  Stack,
  Text,
  Textarea,
  Title,
} from "@mantine/core";
import { AlertCircle, ExternalLink, FileText, Info, MoreVertical, Sparkles, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";

import {
  deleteJobPosting,
  generateCoverLetterPrompt,
  getApplications,
  getComparisons,
  getCompanies,
  getJobPostings,
  getResumes,
  runOptimization,
} from "../api";

function getStatusTone(message) {
  const text = String(message || "").toLowerCase();
  if (!text) return "info";
  if (text.includes("failed") || text.includes("error")) return "error";
  if (text.includes("offline") || text.includes("queued")) return "warning";
  if (text.includes("loaded") || text.includes("completed") || text.includes("generated") || text.includes("copied")) {
    return "success";
  }
  return "info";
}

function formatReviewedDate(value) {
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
  return `${month}-${day}, ${year}`;
}

function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function formatReviewMethod(source) {
  if (source === "chatgpt_api") return "Chat GPT manual";
  if (source === "local_engine") return "Local";
  return "-";
}

export default function PostingsPage() {
  const [companies, setCompanies] = useState([]);
  const [resumes, setResumes] = useState([]);
  const [applications, setApplications] = useState([]);
  const [selectedResumeId, setSelectedResumeId] = useState("");
  const [optimizationByPosting, setOptimizationByPosting] = useState({});
  const [promptByPosting, setPromptByPosting] = useState({});
  const [comparisonReportByPosting, setComparisonReportByPosting] = useState({});
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

  async function loadApplications() {
    try {
      const response = await getApplications();
      setApplications(response.items || []);
    } catch {
      setApplications([]);
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

  async function loadComparisons() {
    try {
      const response = await getComparisons(200);
      const latestByPosting = {};
      for (const item of response.items || []) {
        if (!latestByPosting[item.job_posting_id]) {
          latestByPosting[item.job_posting_id] = item;
        }
      }
      setComparisonReportByPosting(latestByPosting);
    } catch {
      setComparisonReportByPosting({});
    }
  }

  useEffect(() => {
    loadCompanies();
    loadResumes();
    loadApplications();
    loadPostings();
    loadComparisons();
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

  async function optimizePosting(postingId) {
    if (!selectedResumeId) {
      setStatusText("Select a resume version to run optimization.");
      return;
    }

    const posting = postings.find((item) => item.id === postingId);
    const selectedResume = resumes.find((item) => String(item.id) === String(selectedResumeId));
    if (!(posting?.description_text || "").trim() || Number(selectedResume?.parser_confidence || 0) <= 0) {
      setStatusText("Warning: job listing or selected resume appears empty. Update inputs before optimization.");
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
      await loadComparisons();
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

  async function removePosting(postingId) {
    const posting = postings.find((item) => item.id === postingId);
    const proceed = window.confirm(`Delete posting \"${posting?.title || postingId}\"? This also removes linked analysis/comparison/application records.`);
    if (!proceed) return;

    setPostingBusy(postingId, "delete", true);
    setStatusText(`Deleting posting ${postingId}...`);
    try {
      await deleteJobPosting(postingId);
      setStatusText(`Posting ${postingId} deleted.`);
      setOptimizationByPosting((current) => {
        const next = { ...current };
        delete next[postingId];
        return next;
      });
      setPromptByPosting((current) => {
        const next = { ...current };
        delete next[postingId];
        return next;
      });
      await loadPostings();
      await loadComparisons();
      await loadApplications();
    } catch (err) {
      setStatusText(`Delete failed: ${err.message}`);
    } finally {
      setPostingBusy(postingId, "delete", false);
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

  const salaryByPosting = useMemo(() => {
    const map = {};
    for (const app of applications) {
      if (!app.job_posting_id || !app.target_salary) continue;
      if (!map[app.job_posting_id] || String(app.updated_at) > String(map[app.job_posting_id].updated_at)) {
        map[app.job_posting_id] = { value: app.target_salary, updated_at: app.updated_at };
      }
    }
    const flattened = {};
    for (const [key, value] of Object.entries(map)) flattened[key] = value.value;
    return flattened;
  }, [applications]);

  const statusTone = getStatusTone(statusText);
  const statusColor = statusTone === "error" ? "red" : statusTone === "warning" ? "yellow" : statusTone === "success" ? "teal" : "blue";
  const resumeOptions = resumes.map((resume) => ({
    value: String(resume.id),
    label: `${resume.source_name} (${resume.version_tag})`,
  }));
  const companyOptions = companies.map((company) => ({
    value: String(company.id),
    label: company.name,
  }));
  const companyById = Object.fromEntries(companies.map((company) => [company.id, company]));

  return (
    <Stack gap="md">
      <Breadcrumbs>
        <Anchor component={Link} to="/dashboard">Dashboard</Anchor>
        <Text size="sm">Postings</Text>
      </Breadcrumbs>

      <Paper withBorder p="lg" radius="md">
        <Title order={2}>Postings</Title>
        <Text c="dimmed" size="sm">Browse ingested job postings and manage review actions.</Text>

        <Group grow mt="md" align="end">
          <Select
            label="Resume version"
            placeholder="Select resume"
            data={resumeOptions}
            value={selectedResumeId || null}
            onChange={(value) => setSelectedResumeId(value || "")}
            disabled={isLoading}
            clearable
          />
          <Select
            label="Company"
            placeholder="All companies"
            data={companyOptions}
            value={filters.companyId || null}
            onChange={(value) => updateFilter("companyId", value || "")}
            disabled={isLoading}
            clearable
          />
          <Select
            label="Status"
            data={[
              { value: "active", label: "Active" },
              { value: "stale", label: "Stale" },
              { value: "removed", label: "Removed" },
            ]}
            value={filters.status}
            onChange={(value) => updateFilter("status", value || "active")}
            disabled={isLoading}
            allowDeselect={false}
          />
          <Select
            label="Sort"
            data={[
              { value: "freshness", label: "Freshness" },
              { value: "match", label: "Match" },
            ]}
            value={filters.sort}
            onChange={(value) => updateFilter("sort", value || "freshness")}
            disabled={isLoading}
            allowDeselect={false}
          />
        </Group>

        <Group mt="md">
          <Button onClick={applyFilters} loading={isApplyingFilters} disabled={isLoading}>
            Apply filters
          </Button>
        </Group>

        {statusText && (
          <Alert mt="md" color={statusColor} icon={statusTone === "error" ? <AlertCircle size={16} /> : <Info size={16} />} variant="light">
            {statusText}
          </Alert>
        )}

        <Paper withBorder p="xs" radius="md" mt="md">
          <div style={{ display: "grid", gridTemplateColumns: "3fr 1fr 1fr 1fr 1.2fr 1.1fr 1.1fr 0.8fr", gap: 12, padding: "6px 8px" }}>
            <Text fw={600} size="sm">Role</Text>
            <Text fw={600} size="sm">Industry</Text>
            <Text fw={600} size="sm">Location</Text>
            <Text fw={600} size="sm">Match %</Text>
            <Text fw={600} size="sm">Review method</Text>
            <Text fw={600} size="sm">Date reviewed</Text>
            <Text fw={600} size="sm">Salary range</Text>
            <Text fw={600} size="sm">Actions</Text>
          </div>
        </Paper>

        <Stack mt="xs" gap="xs">
          {postings.map((posting) => {
            const comparison = comparisonReportByPosting[posting.id];
            const reviewLink = comparison ? `/postings/reports/${comparison.id}` : null;
            const company = companyById[posting.company_id];
            const industryText = company?.industry?.trim() || "-";
            const salaryRange = salaryByPosting[posting.id] || "-";

            return (
              <Paper key={posting.id} withBorder p="sm" radius="md">
                <div style={{ display: "grid", gridTemplateColumns: "3fr 1fr 1fr 1fr 1.2fr 1.1fr 1.1fr 0.8fr", gap: 12, alignItems: "center" }}>
                  <Group gap="sm" wrap="nowrap">
                    {company?.logo_url ? (
                      <Avatar radius={8} size="md" src={company.logo_url} alt={posting.company_name}>
                        {initials(posting.company_name)}
                      </Avatar>
                    ) : (
                      <Avatar radius={8} size="md" color="blue">{initials(posting.company_name)}</Avatar>
                    )}
                    <Stack gap={2}>
                      {reviewLink ? (
                        <Anchor component={Link} to={reviewLink} fw={600} size="sm">{posting.title}</Anchor>
                      ) : (
                        <Text fw={600} size="sm">{posting.title}</Text>
                      )}
                      <Text size="xs" c="dimmed">{posting.company_name}</Text>
                    </Stack>
                  </Group>
                  <Text size="sm">{industryText}</Text>
                  <Text size="sm">{posting.location || "unknown"}</Text>
                  <Text size="sm">{posting.match_score.toFixed(2)}%</Text>
                  <Text size="sm">{formatReviewMethod(comparison?.evaluation_source)}</Text>
                  <Text size="sm">{formatReviewedDate(posting.last_seen_at)}</Text>
                  <Text size="sm">{salaryRange}</Text>
                  <Menu shadow="md" width={210} position="bottom-end">
                    <Menu.Target>
                      <ActionIcon
                        variant="subtle"
                        aria-label={`Actions for posting ${posting.id}`}
                        disabled={Boolean(busyActionByPosting[posting.id])}
                      >
                        <MoreVertical size={16} />
                      </ActionIcon>
                    </Menu.Target>
                    <Menu.Dropdown>
                      <Menu.Item leftSection={<ExternalLink size={14} />} component="a" href={posting.canonical_url} target="_blank" rel="noreferrer">
                        Open job listing
                      </Menu.Item>
                      {comparison && (
                        <Menu.Item leftSection={<FileText size={14} />} component={Link} to={`/postings/reports/${comparison.id}`}>
                          Open previous review
                        </Menu.Item>
                      )}
                      <Menu.Item leftSection={<Sparkles size={14} />} onClick={() => optimizePosting(posting.id)}>
                        {busyActionByPosting[posting.id] === "optimization" ? "Optimizing..." : "Optimize resume"}
                      </Menu.Item>
                      <Menu.Item leftSection={<FileText size={14} />} onClick={() => generatePrompt(posting.id)}>
                        {busyActionByPosting[posting.id] === "prompt" ? "Generating..." : "Generate prompt"}
                      </Menu.Item>
                      <Menu.Item color="red" leftSection={<Trash2 size={14} />} onClick={() => removePosting(posting.id)}>
                        {busyActionByPosting[posting.id] === "delete" ? "Deleting..." : "Delete posting"}
                      </Menu.Item>
                    </Menu.Dropdown>
                  </Menu>
                </div>

                {optimizationByPosting[posting.id] && (
                  <Text size="xs" mt="xs" c="dimmed">
                    New resume version: {optimizationByPosting[posting.id].output_resume_version_id} · File: {optimizationByPosting[posting.id].deterministic_name}
                  </Text>
                )}
                {promptByPosting[posting.id] && (
                  <Stack gap="xs" mt="xs">
                    <Group>
                      <Button size="xs" variant="subtle" onClick={() => copyPrompt(posting.id)}>
                        Copy prompt
                      </Button>
                    </Group>
                    <Textarea value={promptByPosting[posting.id].prompt} readOnly rows={5} />
                  </Stack>
                )}
              </Paper>
            );
          })}

          {isLoading && <Paper withBorder p="sm">Loading postings...</Paper>}
          {postings.length === 0 && !isLoading && <Paper withBorder p="sm">No postings found for current filters.</Paper>}
        </Stack>
      </Paper>
    </Stack>
  );
}
