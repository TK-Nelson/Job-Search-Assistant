import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Alert,
  Anchor,
  Autocomplete,
  Breadcrumbs,
  Button,
  FileInput,
  Group,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
} from "@mantine/core";
import { AlertCircle, Info } from "lucide-react";

import {
  getCompanies,
  getDashboardSummary,
  getFetchRuns,
  getResumeDiagnostics,
  getResumes,
  runComparison,
  runFetchNow,
  scrapeComparisonUrl,
  uploadResume,
} from "../api";

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
    sourceType: "online",
    sourceText: "",
    sourceUrl: "",
    title: "",
    descriptionText: "",
    resumeVersionId: "",
    evaluationMode: "chatgpt_api",
  });
  const [uploadFile, setUploadFile] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isRunningNow, setIsRunningNow] = useState(false);
  const [isLoadingRuns, setIsLoadingRuns] = useState(true);
  const [isRunningComparison, setIsRunningComparison] = useState(false);
  const [isUploadingResume, setIsUploadingResume] = useState(false);
  const [isScrapingComparisonUrl, setIsScrapingComparisonUrl] = useState(false);

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
      const selectedResumeId = Number(comparisonForm.resumeVersionId);
      const diagnostics = await getResumeDiagnostics(selectedResumeId);
      if (!String(diagnostics?.extracted_text || "").trim()) {
        setStatus("Warning: selected resume has empty extracted text. Choose a different resume or upload/paste a new one.");
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
      setStatus(`Comparison complete via ${result.evaluation_source === "chatgpt_api" ? "Chat GPT" : "local engine"}. Opening report...`);
      navigate(`/postings/reports/${result.comparison_report_id}`);
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
    setStatus("Scraping URL for role details...");
    try {
      const result = await scrapeComparisonUrl(sourceUrl);
      setComparisonForm((current) => ({
        ...current,
        sourceText: current.sourceText || result.inferred_company_name || "",
        title: current.title || result.inferred_title || "",
        descriptionText: result.description_text || current.descriptionText,
      }));
      setStatus(
        `Scraped ${result.extracted_characters} characters from URL${result.truncation_applied ? " (truncated for size)." : "."}`
      );
    } catch (err) {
      setStatus(`URL scrape failed: ${err.message}`);
    } finally {
      setIsScrapingComparisonUrl(false);
    }
  }

  const latest = runs[0];
  const statusTone = getStatusTone(status);
  const statusColor = statusTone === "error" ? "red" : statusTone === "warning" ? "yellow" : statusTone === "success" ? "teal" : "blue";
  const companyOptions = companies.map((company) => ({ value: company.name, label: company.name }));
  const resumeOptions = resumes.map((resume) => ({
    value: String(resume.id),
    label: `${resume.source_name} (${resume.version_tag})`,
  }));

  return (
    <Stack gap="md">
      <Breadcrumbs>
        <Anchor component={Link} to="/dashboard">Dashboard</Anchor>
        <Text size="sm">Overview</Text>
      </Breadcrumbs>

      <Paper withBorder p="lg" radius="md">
      <Title order={2}>Dashboard</Title>
      <Text c="dimmed" size="sm">Fetch pipeline status and direct job-description comparison workflow.</Text>

      <Group mt="md">
        <Button onClick={onRunNow} loading={isRunningNow}>Run fetch now</Button>
        <Button variant="light" onClick={onRefresh} loading={isRefreshing} disabled={isRunningNow}>Refresh</Button>
        {!isOnline && <Text c="dimmed" size="sm">Offline</Text>}
      </Group>

      {status && (
        <Alert mt="md" color={statusColor} icon={statusTone === "error" ? <AlertCircle size={16} /> : <Info size={16} />} variant="light">
          {status}
        </Alert>
      )}

      <div className="dashboard-grid">
        <section className="dashboard-main">
          <Paper withBorder p="md" radius="md">
            <Text fw={600} size="sm">New Roles From Followed</Text>
            <Title order={3}>{summary?.new_roles_from_followed_last_run ?? 0}</Title>
            <Text c="dimmed" size="sm">
              {summary?.latest_fetch_run_id
                ? `From fetch run #${summary.latest_fetch_run_id}${summary.latest_fetch_completed_at ? ` (${summary.latest_fetch_completed_at})` : ""}`
                : "No completed fetch run yet."}
            </Text>
          </Paper>

          {summary && (
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} mt="md">
              <Paper withBorder p="md" radius="md"><Text c="dimmed" size="sm">Applications</Text><Title order={4}>{summary.applications_total_count}</Title></Paper>
              <Paper withBorder p="md" radius="md"><Text c="dimmed" size="sm">Followed Companies</Text><Title order={4}>{summary.followed_companies_count}</Title></Paper>
              <Paper withBorder p="md" radius="md"><Text c="dimmed" size="sm">Active Postings</Text><Title order={4}>{summary.active_postings_count}</Title></Paper>
              <Paper withBorder p="md" radius="md"><Text c="dimmed" size="sm">New Postings (7d)</Text><Title order={4}>{summary.recent_postings_count_7d}</Title></Paper>
            </SimpleGrid>
          )}

          {summary && (
            <Paper withBorder p="md" radius="md" mt="md">
              <Text fw={600} mb="xs">Applications by Stage</Text>
              {summary.applications_by_stage.length > 0 ? (
                <SimpleGrid cols={{ base: 1, sm: 2 }}>
                  {summary.applications_by_stage.map((item) => (
                    <Text key={item.stage}><Text component="span" fw={600}>{item.stage}:</Text> {item.count}</Text>
                  ))}
                </SimpleGrid>
              ) : (
                <Text>No applications yet.</Text>
              )}
            </Paper>
          )}

          <Paper withBorder p="md" radius="md" mt="md">
            <Text fw={600} mb="xs">Latest Fetch Run</Text>
            {latest ? (
              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                <Text><Text component="span" fw={600}>Run ID:</Text> {latest.id}</Text>
                <Text><Text component="span" fw={600}>Status:</Text> {latest.status}</Text>
                <Text><Text component="span" fw={600}>Started:</Text> {latest.started_at}</Text>
                <Text><Text component="span" fw={600}>Completed:</Text> {latest.completed_at || "-"}</Text>
                <Text><Text component="span" fw={600}>Companies Checked:</Text> {latest.companies_checked}</Text>
                <Text><Text component="span" fw={600}>New/Updated/Skipped/Filtered:</Text> {latest.postings_new}/{latest.postings_updated}/{latest.postings_skipped}/{latest.postings_filtered_out || 0}</Text>
              </SimpleGrid>
            ) : (
              <Text>No fetch runs yet.</Text>
            )}
          </Paper>

          <Table.ScrollContainer minWidth={1100} mt="md">
            <Table striped highlightOnHover withTableBorder withColumnBorders>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>ID</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th>Started</Table.Th>
                  <Table.Th>Completed</Table.Th>
                  <Table.Th>Companies</Table.Th>
                  <Table.Th>New</Table.Th>
                  <Table.Th>Updated</Table.Th>
                  <Table.Th>Skipped</Table.Th>
                  <Table.Th>Filtered</Table.Th>
                  <Table.Th>Errors</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {runs.map((run) => (
                  <Table.Tr key={run.id}>
                    <Table.Td>{run.id}</Table.Td>
                    <Table.Td>{run.status}</Table.Td>
                    <Table.Td>{run.started_at}</Table.Td>
                    <Table.Td>{run.completed_at || "-"}</Table.Td>
                    <Table.Td>{run.companies_checked}</Table.Td>
                    <Table.Td>{run.postings_new}</Table.Td>
                    <Table.Td>{run.postings_updated}</Table.Td>
                    <Table.Td>{run.postings_skipped}</Table.Td>
                    <Table.Td>{run.postings_filtered_out || 0}</Table.Td>
                    <Table.Td>{run.errors_json}</Table.Td>
                  </Table.Tr>
                ))}
                {isLoadingRuns && (
                  <Table.Tr>
                    <Table.Td colSpan={10}>Loading run history...</Table.Td>
                  </Table.Tr>
                )}
                {runs.length === 0 && !isLoadingRuns && (
                  <Table.Tr>
                    <Table.Td colSpan={10}>No run history yet.</Table.Td>
                  </Table.Tr>
                )}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </section>

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
      </Paper>
    </Stack>
  );
}
