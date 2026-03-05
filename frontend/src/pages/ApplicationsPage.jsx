import { useEffect, useState } from "react";
import {
  ActionIcon,
  Alert,
  Anchor,
  Breadcrumbs,
  Button,
  Group,
  Menu,
  Modal,
  Paper,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
} from "@mantine/core";
import { AlertCircle, History, Info, MoreVertical, Pencil, Trash2, X } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";

import {
  createApplication,
  deleteApplication,
  getApplicationHistory,
  getApplications,
  getCompanies,
  getJobPostings,
  updateApplication,
  updateApplicationStage,
} from "../api";

const STAGES = ["saved", "applied", "phone_screen", "interview", "offer", "rejected", "withdrawn"];

function getStatusTone(message) {
  const text = String(message || "").toLowerCase();
  if (!text) return "info";
  if (text.includes("failed") || text.includes("error")) return "error";
  if (text.includes("loaded") || text.includes("updated") || text.includes("created") || text.includes("deleted")) {
    return "success";
  }
  return "info";
}

function toStageLabel(value) {
  return String(value || "").replaceAll("_", " ");
}

export default function ApplicationsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlCompanyId = searchParams.get("companyId") ? Number(searchParams.get("companyId")) : null;

  const [applications, setApplications] = useState([]);
  const [postings, setPostings] = useState([]);
  const [companyMap, setCompanyMap] = useState({});
  const [historyByApp, setHistoryByApp] = useState({});
  const [expandedHistoryId, setExpandedHistoryId] = useState(null);
  const [statusText, setStatusText] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [busyStageAppId, setBusyStageAppId] = useState(null);
  const [busyDeleteAppId, setBusyDeleteAppId] = useState(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [filterStage, setFilterStage] = useState("");
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingApp, setEditingApp] = useState(null);
  const [form, setForm] = useState({
    job_posting_id: "",
    stage: "saved",
    applied_at: "",
    target_salary: "",
    notes: "",
  });
  const [editForm, setEditForm] = useState({
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

  async function loadCompanyMap() {
    try {
      const res = await getCompanies();
      const map = {};
      for (const c of res.items || []) {
        map[c.id] = c.name;
      }
      setCompanyMap(map);
    } catch (_) { /* non-critical */ }
  }

  async function loadApplications(stage = filterStage, companyId = urlCompanyId) {
    setIsLoading(true);
    try {
      const response = await getApplications({ stage: stage || undefined, companyId: companyId || undefined });
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
    loadCompanyMap();
    loadApplications();
  }, []);

  function clearCompanyFilter() {
    setSearchParams((prev) => {
      prev.delete("companyId");
      return prev;
    });
    loadApplications(filterStage, null);
  }

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

  async function onInlineStageUpdate(applicationId, nextStage) {
    if (!nextStage) return;
    setBusyStageAppId(applicationId);
    setStatusText(`Updating stage to ${toStageLabel(nextStage)}...`);
    try {
      await updateApplicationStage(applicationId, { to_stage: nextStage, reason: "inline status update" });
      setStatusText("Stage updated.");
      await loadApplications();
    } catch (err) {
      setStatusText(`Stage update failed: ${err.message}`);
    } finally {
      setBusyStageAppId(null);
    }
  }

  function onOpenEdit(app) {
    setEditingApp(app);
    setEditForm({
      stage: app.stage,
      applied_at: app.applied_at || "",
      target_salary: app.target_salary || "",
      notes: app.notes || "",
    });
    setIsEditOpen(true);
  }

  async function onSaveEdit() {
    if (!editingApp) return;
    setIsSavingEdit(true);
    setStatusText("Saving application changes...");
    try {
      await updateApplication(editingApp.id, {
        stage: editForm.stage,
        applied_at: editForm.applied_at || null,
        target_salary: editForm.target_salary || null,
        notes: editForm.notes || null,
      });
      setStatusText("Application updated.");
      setIsEditOpen(false);
      setEditingApp(null);
      await loadApplications();
    } catch (err) {
      setStatusText(`Update failed: ${err.message}`);
    } finally {
      setIsSavingEdit(false);
    }
  }

  async function onDelete(applicationId) {
    const proceed = window.confirm("Delete this application?");
    if (!proceed) return;

    setBusyDeleteAppId(applicationId);
    setStatusText("Deleting application...");
    try {
      await deleteApplication(applicationId);
      setStatusText("Application deleted.");
      if (expandedHistoryId === applicationId) setExpandedHistoryId(null);
      await loadApplications();
    } catch (err) {
      setStatusText(`Delete failed: ${err.message}`);
    } finally {
      setBusyDeleteAppId(null);
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

  const statusTone = getStatusTone(statusText);
  const statusColor = statusTone === "error" ? "red" : statusTone === "warning" ? "yellow" : statusTone === "success" ? "teal" : "blue";
  const postingOptions = postings.map((posting) => ({
    value: String(posting.id),
    label: `${posting.company_name} - ${posting.title}`,
  }));
  const stageOptions = STAGES.map((stage) => ({ value: stage, label: toStageLabel(stage) }));

  return (
    <Stack gap="md">
      <Breadcrumbs>
        <Anchor component={Link} to="/dashboard">Dashboard</Anchor>
        <Text size="sm">Applications</Text>
      </Breadcrumbs>

      <Paper withBorder p="lg" radius="md">
        <Title order={2}>Applications</Title>
        <Text c="dimmed" size="sm">Track application stages and manage entries.</Text>

        <Paper withBorder p="md" radius="md" mt="md">
          <form onSubmit={onCreate}>
            <div className="grid">
              <Select
                label="Job posting"
                placeholder="Select posting"
                data={postingOptions}
                searchable
                value={form.job_posting_id}
                onChange={(value) => setForm((x) => ({ ...x, job_posting_id: value || "" }))}
                disabled={isCreating}
              />
              <Select
                label="Stage"
                data={stageOptions}
                value={form.stage}
                onChange={(value) => setForm((x) => ({ ...x, stage: value || "saved" }))}
                disabled={isCreating}
              />
              <TextInput
                label="Applied at"
                type="date"
                value={form.applied_at}
                onChange={(e) => setForm((x) => ({ ...x, applied_at: e.target.value }))}
                disabled={isCreating}
              />
              <TextInput
                label="Target salary"
                value={form.target_salary}
                onChange={(e) => setForm((x) => ({ ...x, target_salary: e.target.value }))}
                disabled={isCreating}
              />
              <TextInput
                label="Notes"
                value={form.notes}
                onChange={(e) => setForm((x) => ({ ...x, notes: e.target.value }))}
                disabled={isCreating}
              />
            </div>
            <Group mt="md">
              <Button type="submit" loading={isCreating}>Create application</Button>
            </Group>
          </form>
        </Paper>

        <Group mt="md" align="end">
          {urlCompanyId && (
            <Alert color="blue" variant="light" py={4} px="sm" icon={<Info size={14} />}
              styles={{ root: { display: "inline-flex" } }}
            >
              <Group gap={4}>
                <Text size="xs">Filtered to company: <b>{companyMap[urlCompanyId] || `#${urlCompanyId}`}</b></Text>
                <ActionIcon size="xs" variant="subtle" onClick={clearCompanyFilter} aria-label="Clear company filter">
                  <X size={12} />
                </ActionIcon>
              </Group>
            </Alert>
          )}
          <Select
            label="Filter by stage"
            placeholder="All"
            clearable
            data={stageOptions}
            value={filterStage || null}
            onChange={(value) => setFilterStage(value || "")}
          />
          <Button variant="default" onClick={() => loadApplications(filterStage)} disabled={isLoading || isCreating}>
            Apply filter
          </Button>
        </Group>

        {statusText && (
          <Alert mt="md" color={statusColor} icon={statusTone === "error" ? <AlertCircle size={16} /> : <Info size={16} />} variant="light">
            {statusText}
          </Alert>
        )}

        <Table.ScrollContainer minWidth={1000} mt="md">
          <Table striped highlightOnHover withTableBorder withColumnBorders>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Company</Table.Th>
                <Table.Th>Role</Table.Th>
                <Table.Th>Applied Status</Table.Th>
                <Table.Th>Applied Date</Table.Th>
                <Table.Th>Salary</Table.Th>
                <Table.Th>Actions</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {applications.map((app) => (
                <Table.Tr key={app.id}>
                  <Table.Td>{app.company_name}</Table.Td>
                  <Table.Td>{app.posting_title}</Table.Td>
                  <Table.Td>
                    <Select
                      size="xs"
                      radius="xl"
                      variant="filled"
                      data={stageOptions}
                      value={app.stage}
                      onChange={(value) => onInlineStageUpdate(app.id, value || app.stage)}
                      disabled={busyStageAppId === app.id || busyDeleteAppId === app.id}
                      allowDeselect={false}
                      w={160}
                    />
                  </Table.Td>
                  <Table.Td>{app.applied_at || "-"}</Table.Td>
                  <Table.Td>{app.target_salary || "-"}</Table.Td>
                  <Table.Td>
                    <Menu shadow="md" width={170} position="bottom-end">
                      <Menu.Target>
                        <ActionIcon variant="subtle" aria-label="More actions" disabled={busyDeleteAppId === app.id}>
                          <MoreVertical size={16} />
                        </ActionIcon>
                      </Menu.Target>
                      <Menu.Dropdown>
                        <Menu.Item leftSection={<Pencil size={14} />} onClick={() => onOpenEdit(app)}>
                          Edit
                        </Menu.Item>
                        <Menu.Item leftSection={<History size={14} />} onClick={() => onToggleHistory(app.id)}>
                          {expandedHistoryId === app.id ? "Hide history" : "View history"}
                        </Menu.Item>
                        <Menu.Item color="red" leftSection={<Trash2 size={14} />} onClick={() => onDelete(app.id)}>
                          {busyDeleteAppId === app.id ? "Deleting..." : "Delete"}
                        </Menu.Item>
                      </Menu.Dropdown>
                    </Menu>
                  </Table.Td>
                </Table.Tr>
              ))}
              {isLoading && (
                <Table.Tr>
                  <Table.Td colSpan={6}>Loading applications...</Table.Td>
                </Table.Tr>
              )}
              {applications.length === 0 && !isLoading && (
                <Table.Tr>
                  <Table.Td colSpan={6}>No applications yet.</Table.Td>
                </Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>

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
                <Text size="xs">No stage history yet.</Text>
              )}
            </Stack>
          </Paper>
        )}
      </Paper>

      <Modal opened={isEditOpen} onClose={() => setIsEditOpen(false)} title="Edit application" centered>
        <Stack>
          <Text size="sm" c="dimmed">{editingApp ? `${editingApp.company_name} · ${editingApp.posting_title}` : ""}</Text>
          <Select
            label="Stage"
            data={stageOptions}
            value={editForm.stage}
            onChange={(value) => setEditForm((current) => ({ ...current, stage: value || "saved" }))}
            disabled={isSavingEdit}
          />
          <TextInput
            label="Applied date"
            type="date"
            value={editForm.applied_at}
            onChange={(event) => setEditForm((current) => ({ ...current, applied_at: event.target.value }))}
            disabled={isSavingEdit}
          />
          <TextInput
            label="Target salary"
            value={editForm.target_salary}
            onChange={(event) => setEditForm((current) => ({ ...current, target_salary: event.target.value }))}
            disabled={isSavingEdit}
          />
          <Textarea
            label="Notes"
            value={editForm.notes}
            onChange={(event) => setEditForm((current) => ({ ...current, notes: event.target.value }))}
            disabled={isSavingEdit}
          />
          <Group justify="flex-end" mt="sm">
            <Button variant="default" onClick={() => setIsEditOpen(false)} disabled={isSavingEdit}>Cancel</Button>
            <Button onClick={onSaveEdit} loading={isSavingEdit}>Save</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
