import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ActionIcon,
  Alert,
  Anchor,
  Avatar,
  Badge,
  Breadcrumbs,
  Button,
  Group,
  Loader,
  Menu,
  Modal,
  MultiSelect,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Tabs,
  Text,
  TextInput,
  Textarea,
  Title,
} from "@mantine/core";
import {
  AlertCircle,
  Briefcase,
  Building2,
  CalendarCheck,
  CheckCircle2,
  ExternalLink,
  History,
  Image as ImageIcon,
  Info,
  MoreVertical,
  Pencil,
  Star,
  TrendingUp,
  Trash2,
} from "lucide-react";

import {
  deleteCompany,
  getApplications,
  getCompanies,
  getJobPostings,
  refreshCompanyLogo,
  updateCompany,
} from "../api";

const STAGES = ["saved", "applied", "phone_screen", "interview", "offer", "rejected", "withdrawn"];

const INDUSTRY_OPTIONS = [
  "Aerospace & Defense",
  "Automotive",
  "Banking & Financial Services",
  "Consulting",
  "Consumer Goods",
  "E-Commerce",
  "Education",
  "Energy & Utilities",
  "Entertainment & Media",
  "Gaming",
  "Government",
  "Healthcare",
  "Hospitality & Travel",
  "Insurance",
  "Legal",
  "Logistics & Supply Chain",
  "Manufacturing",
  "Nonprofit",
  "Pharmaceuticals",
  "Real Estate",
  "Retail",
  "SaaS / Cloud",
  "Streaming / Digital Media",
  "Technology",
  "Telecommunications",
  "Transportation",
];

function parseIndustry(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function serializeIndustry(arr) {
  if (!arr || arr.length === 0) return null;
  return arr.join(", ");
}

function isRealUrl(url) {
  if (!url) return false;
  return /^https?:\/\//i.test(url) && !url.includes("manual.local/");
}

function toStageLabel(v) {
  return String(v || "").replaceAll("_", " ");
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

function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function stageBadgeColor(stage) {
  switch (stage) {
    case "applied": return "blue";
    case "phone_screen": return "cyan";
    case "interview": return "indigo";
    case "offer": return "green";
    case "rejected": return "red";
    case "withdrawn": return "gray";
    default: return "gray";
  }
}

/** Build a simple sparkline-style timeline from application dates. */
function ApplicationTimeline({ applications }) {
  const dated = applications
    .filter((a) => a.applied_at)
    .map((a) => ({ ...a, ts: new Date(a.applied_at).getTime() }))
    .filter((a) => !Number.isNaN(a.ts))
    .sort((a, b) => a.ts - b.ts);

  if (dated.length === 0) {
    return <Text size="xs" c="dimmed">No dated applications yet.</Text>;
  }

  const minTs = dated[0].ts;
  const maxTs = dated[dated.length - 1].ts;
  const range = maxTs - minTs || 1;
  const BAR_HEIGHT = 40;
  const WIDTH = "100%";

  return (
    <svg viewBox={`0 0 400 ${BAR_HEIGHT + 20}`} width={WIDTH} height={BAR_HEIGHT + 20} style={{ display: "block" }}>
      {/* baseline */}
      <line x1="0" y1={BAR_HEIGHT} x2="400" y2={BAR_HEIGHT} stroke="var(--mantine-color-gray-3)" strokeWidth="1" />
      {dated.map((a, i) => {
        const x = dated.length === 1 ? 200 : 10 + ((a.ts - minTs) / range) * 380;
        return (
          <g key={a.id || i}>
            <circle cx={x} cy={BAR_HEIGHT - 6} r={5} fill="var(--mantine-color-blue-5)" />
            {i === 0 || i === dated.length - 1 ? (
              <text x={x} y={BAR_HEIGHT + 16} textAnchor="middle" fontSize="9" fill="var(--mantine-color-dimmed)">{formatDate(a.applied_at)}</text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

export default function CompanyPage() {
  const { companyId } = useParams();
  const id = Number(companyId);

  const [company, setCompany] = useState(null);
  const [applications, setApplications] = useState([]);
  const [postings, setPostings] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [actionMsg, setActionMsg] = useState(null);
  const [refreshingLogo, setRefreshingLogo] = useState(false);
  const [activeTab, setActiveTab] = useState("applications");

  // Edit modal state
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({ name: "", careers_url: "", industry: [], notes: "", followed: true });
  const [isSaving, setIsSaving] = useState(false);

  // Follow-URL prompt modal state
  const [followUrlModalOpen, setFollowUrlModalOpen] = useState(false);
  const [followUrlValue, setFollowUrlValue] = useState("");

  function showAction(text, tone = "success") {
    setActionMsg({ text, tone });
  }

  async function loadData() {
    setIsLoading(true);
    try {
      const [companiesRes, appsRes, postingsRes] = await Promise.all([
        getCompanies(),
        getApplications({ companyId: id }),
        getJobPostings({ companyId: id, status: "active", limit: 300 }),
      ]);
      const found = (companiesRes.items || []).find((c) => c.id === id);
      setCompany(found || null);
      setApplications(appsRes.items || []);
      setPostings(postingsRes.items || []);
    } catch (err) {
      showAction(`Failed to load company data: ${err.message}`, "error");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [id]);

  async function onRefreshLogo() {
    setRefreshingLogo(true);
    try {
      await refreshCompanyLogo(id);
      showAction("Logo refreshed.");
      await loadData();
    } catch (err) {
      showAction(`Logo refresh failed: ${err.message}`, "error");
    } finally {
      setRefreshingLogo(false);
    }
  }

  async function onToggleFollowed() {
    if (!company) return;

    // When following a company that has no careers URL, prompt for one first
    if (!company.followed && !isRealUrl(company.careers_url)) {
      setFollowUrlValue("");
      setFollowUrlModalOpen(true);
      return;
    }

    try {
      await updateCompany(id, {
        name: company.name,
        careers_url: company.careers_url || null,
        industry: company.industry || null,
        notes: company.notes || null,
        followed: !company.followed,
      });
      showAction(company.followed ? "Unfollowed." : "Now following.");
      await loadData();
    } catch (err) {
      showAction(`Update failed: ${err.message}`, "error");
    }
  }

  async function onConfirmFollowWithUrl() {
    if (!company) return;
    setFollowUrlModalOpen(false);
    try {
      await updateCompany(id, {
        name: company.name,
        careers_url: followUrlValue.trim() || null,
        industry: company.industry || null,
        notes: company.notes || null,
        followed: true,
      });
      showAction("Now following — careers URL updated.");
      await loadData();
    } catch (err) {
      showAction(`Follow failed: ${err.message}`, "error");
    }
  }

  function onSkipFollowUrl() {
    setFollowUrlModalOpen(false);
    updateCompany(id, {
      name: company.name,
      careers_url: company.careers_url || null,
      industry: company.industry || null,
      notes: company.notes || null,
      followed: true,
    })
      .then(() => { showAction("Now following."); return loadData(); })
      .catch((err) => showAction(`Follow failed: ${err.message}`, "error"));
  }

  function openEditModal() {
    if (!company) return;
    setEditForm({
      name: company.name,
      careers_url: company.careers_url || "",
      industry: parseIndustry(company.industry),
      notes: company.notes || "",
      followed: Boolean(company.followed),
    });
    setIsEditOpen(true);
  }

  function closeEditModal() {
    setIsEditOpen(false);
  }

  async function onSaveEdit() {
    setIsSaving(true);
    try {
      await updateCompany(id, {
        ...editForm,
        careers_url: editForm.careers_url || null,
        industry: serializeIndustry(editForm.industry),
        notes: editForm.notes || null,
      });
      showAction("Company updated.");
      closeEditModal();
      await loadData();
    } catch (err) {
      showAction(`Save failed: ${err.message}`, "error");
    } finally {
      setIsSaving(false);
    }
  }

  // Derived stats
  const totalApps = applications.length;
  const activeApps = applications.filter((a) => !["rejected", "withdrawn"].includes(a.stage)).length;
  const stageBreakdown = useMemo(() => {
    const counts = {};
    for (const a of applications) {
      counts[a.stage] = (counts[a.stage] || 0) + 1;
    }
    return counts;
  }, [applications]);
  const latestApp = useMemo(() => {
    if (applications.length === 0) return null;
    return [...applications].sort((a, b) => (b.applied_at || "").localeCompare(a.applied_at || ""))[0];
  }, [applications]);
  const stageOptions = STAGES.map((s) => ({ value: s, label: toStageLabel(s) }));

  const actionColor = actionMsg?.tone === "error" ? "red" : "teal";

  if (isLoading) {
    return (
      <Stack gap="md" align="center" mt="xl">
        <Loader />
        <Text c="dimmed">Loading company...</Text>
      </Stack>
    );
  }

  if (!company) {
    return (
      <Stack gap="md">
        <Breadcrumbs>
          <Anchor component={Link} to="/dashboard">Dashboard</Anchor>
          <Anchor component={Link} to="/companies">Companies</Anchor>
          <Text size="sm">Not Found</Text>
        </Breadcrumbs>
        <Alert color="red" icon={<AlertCircle size={16} />}>Company not found.</Alert>
      </Stack>
    );
  }

  return (
    <Stack gap="md">
      <Breadcrumbs>
        <Anchor component={Link} to="/dashboard">Dashboard</Anchor>
        <Anchor component={Link} to="/companies">Companies</Anchor>
        <Text size="sm">{company.name}</Text>
      </Breadcrumbs>

      {/* Company header */}
      <Paper withBorder p="lg" radius="md">
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Group gap="md" wrap="nowrap">
            {company.logo_url ? (
              <Avatar radius={12} size={72} src={company.logo_url} alt={company.name}>
                {initials(company.name)}
              </Avatar>
            ) : (
              <Avatar radius={12} size={72} color="blue">{initials(company.name)}</Avatar>
            )}
            <Stack gap={2}>
              <Title order={1} size="h2">{company.name}</Title>
              {company.industry && <Text c="dimmed" size="sm">{company.industry}</Text>}
              <Group gap="xs" mt={4}>
                {company.followed && (
                  <Badge variant="light" color="yellow" leftSection={<Star size={10} />} size="sm">Followed</Badge>
                )}
                {company.careers_url && /^https?:\/\//.test(company.careers_url) && (
                  <Anchor href={company.careers_url} target="_blank" rel="noreferrer" size="xs" c="dimmed">
                    <Group gap={4}><ExternalLink size={12} /> Careers page</Group>
                  </Anchor>
                )}
              </Group>
            </Stack>
          </Group>

          {/* Right-justified actions */}
          <Menu shadow="md" width={200} position="bottom-end" withArrow>
            <Menu.Target>
              <ActionIcon variant="default" size="lg" aria-label="Company actions">
                <MoreVertical size={18} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item leftSection={<Pencil size={14} />} onClick={openEditModal}>Edit Company</Menu.Item>
              <Menu.Item leftSection={<Star size={14} />} onClick={onToggleFollowed}>
                {company.followed ? "Unfollow" : "Follow"}
              </Menu.Item>
              <Menu.Item leftSection={<ImageIcon size={14} />} onClick={onRefreshLogo} disabled={refreshingLogo}>
                Refresh Logo
              </Menu.Item>
              {company.careers_url && /^https?:\/\//.test(company.careers_url) && (
                <Menu.Item component="a" href={company.careers_url} target="_blank" rel="noreferrer" leftSection={<ExternalLink size={14} />}>
                  Visit Careers Page
                </Menu.Item>
              )}
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Paper>

      {/* Action alerts */}
      {actionMsg && (
        <Alert
          color={actionColor}
          icon={actionMsg.tone === "error" ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
          variant="light"
          withCloseButton
          onClose={() => setActionMsg(null)}
        >
          {actionMsg.text}
        </Alert>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onChange={setActiveTab}>
        <Tabs.List>
          <Tabs.Tab value="applications" leftSection={<Briefcase size={14} />}>
            Applications {totalApps > 0 && <Badge size="xs" variant="light" ml={4}>{totalApps}</Badge>}
          </Tabs.Tab>
          <Tabs.Tab value="retrieved" leftSection={<Building2 size={14} />}>
            Retrieved Roles {postings.length > 0 && <Badge size="xs" variant="light" ml={4}>{postings.length}</Badge>}
          </Tabs.Tab>
        </Tabs.List>

        {/* === Applications Tab === */}
        <Tabs.Panel value="applications" pt="md">
          {/* Stats cards */}
          <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }} spacing="md" mb="md">
            <Paper withBorder p="md" radius="md">
              <Group gap="xs">
                <Briefcase size={18} opacity={0.5} />
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>Total</Text>
              </Group>
              <Text fw={700} size="xl" mt={4}>{totalApps}</Text>
              <Text size="xs" c="dimmed">applications</Text>
            </Paper>
            <Paper withBorder p="md" radius="md">
              <Group gap="xs">
                <TrendingUp size={18} opacity={0.5} />
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>Active</Text>
              </Group>
              <Text fw={700} size="xl" mt={4}>{activeApps}</Text>
              <Text size="xs" c="dimmed">in pipeline</Text>
            </Paper>
            <Paper withBorder p="md" radius="md">
              <Group gap="xs">
                <CalendarCheck size={18} opacity={0.5} />
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>Latest</Text>
              </Group>
              <Text fw={700} size="md" mt={4}>{latestApp ? formatDate(latestApp.applied_at) : "-"}</Text>
              <Text size="xs" c="dimmed">last applied</Text>
            </Paper>
            <Paper withBorder p="md" radius="md">
              <Group gap="xs">
                <History size={18} opacity={0.5} />
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>Timeline</Text>
              </Group>
              <ApplicationTimeline applications={applications} />
            </Paper>
          </SimpleGrid>

          {/* Applications table */}
          <Paper withBorder radius="md">
            <Paper p="xs" style={{ borderBottom: "1px solid var(--mantine-color-gray-3)" }}>
              <div style={{ display: "grid", gridTemplateColumns: "3fr 1.2fr 1.2fr 1.2fr", gap: 12, padding: "6px 8px" }}>
                <Text fw={600} size="sm">Role</Text>
                <Text fw={600} size="sm">Stage</Text>
                <Text fw={600} size="sm">Applied Date</Text>
                <Text fw={600} size="sm">Target Salary</Text>
              </div>
            </Paper>

            <Stack gap={0} p="xs">
              {applications.length === 0 && (
                <Text p="md" c="dimmed" ta="center">No applications for this company yet.</Text>
              )}
              {applications.map((app) => (
                <Paper key={app.id} p="sm" radius="sm" style={{ borderBottom: "1px solid var(--mantine-color-gray-1)" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "3fr 1.2fr 1.2fr 1.2fr", gap: 12, alignItems: "center" }}>
                    <Stack gap={2}>
                      <Text fw={600} size="sm">{app.posting_title}</Text>
                      {app.notes && <Text size="xs" c="dimmed" lineClamp={1}>{app.notes}</Text>}
                    </Stack>
                    <Badge variant="light" color={stageBadgeColor(app.stage)} size="md" radius="xl">
                      {toStageLabel(app.stage)}
                    </Badge>
                    <Text size="sm">{formatDate(app.applied_at)}</Text>
                    <Text size="sm">{app.target_salary || "-"}</Text>
                  </div>
                </Paper>
              ))}
            </Stack>
          </Paper>
        </Tabs.Panel>

        {/* === Retrieved Roles Tab === */}
        <Tabs.Panel value="retrieved" pt="md">
          {postings.length === 0 ? (
            <Paper withBorder p="xl" radius="md">
              <Stack align="center" gap="md" py="xl">
                <Building2 size={48} opacity={0.3} />
                <Title order={3} c="dimmed">No Retrieved Roles</Title>
                <Text c="dimmed" size="sm" ta="center" maw={480}>
                  Roles fetched from <b>{company.name}</b>&apos;s careers page will appear here once a fetch routine runs.
                </Text>
              </Stack>
            </Paper>
          ) : (
            <Paper withBorder radius="md">
              <Paper p="xs" style={{ borderBottom: "1px solid var(--mantine-color-gray-3)" }}>
                <div style={{ display: "grid", gridTemplateColumns: "3fr 1.5fr 0.8fr 1.2fr 1.2fr", gap: 12, padding: "6px 8px" }}>
                  <Text fw={600} size="sm">Role</Text>
                  <Text fw={600} size="sm">Location</Text>
                  <Text fw={600} size="sm">Score</Text>
                  <Text fw={600} size="sm">Date Posted</Text>
                  <Text fw={600} size="sm">First Seen</Text>
                </div>
              </Paper>

              <Stack gap={0} p="xs">
                {postings.map((p) => (
                  <Paper key={p.id} p="sm" radius="sm" style={{ borderBottom: "1px solid var(--mantine-color-gray-1)" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "3fr 1.5fr 0.8fr 1.2fr 1.2fr", gap: 12, alignItems: "center" }}>
                      <Stack gap={2}>
                        {p.canonical_url ? (
                          <Anchor href={p.canonical_url} target="_blank" rel="noreferrer" size="sm" fw={600}>
                            <Group gap={4} wrap="nowrap">{p.title}<ExternalLink size={12} /></Group>
                          </Anchor>
                        ) : (
                          <Text fw={600} size="sm">{p.title}</Text>
                        )}
                        {p.salary_range && <Text size="xs" c="dimmed">{p.salary_range}</Text>}
                      </Stack>
                      <Text size="sm">{p.location || "\u2014"}</Text>
                      <Text size="sm" fw={500} c={p.match_score >= 80 ? "teal" : p.match_score >= 65 ? "yellow.8" : p.match_score > 0 ? "red" : "dimmed"}>
                        {p.match_score > 0 ? `${p.match_score}%` : "\u2014"}
                      </Text>
                      <Text size="sm">{formatDate(p.posted_date)}</Text>
                      <Text size="sm">{formatDate(p.first_seen_at)}</Text>
                    </div>
                  </Paper>
                ))}
              </Stack>
            </Paper>
          )}
        </Tabs.Panel>
      </Tabs>

      {/* Edit Company Modal */}
      <Modal opened={isEditOpen} onClose={closeEditModal} title="Edit company" centered>
        <Stack>
          <TextInput
            label="Company name"
            value={editForm.name}
            onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
            required
            disabled={isSaving}
          />
          <TextInput
            label="Careers / Job board URL"
            type="url"
            placeholder="https://company.com/careers"
            value={editForm.careers_url}
            onChange={(e) => setEditForm((f) => ({ ...f, careers_url: e.target.value }))}
            disabled={isSaving}
          />
          <MultiSelect
            label="Industry"
            placeholder="Select or type industries"
            data={INDUSTRY_OPTIONS}
            value={editForm.industry}
            onChange={(value) => setEditForm((f) => ({ ...f, industry: value }))}
            searchable
            creatable
            getCreateLabel={(query) => `+ Add "${query}"`}
            disabled={isSaving}
          />
          <Textarea
            label="Notes"
            value={editForm.notes}
            onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
            disabled={isSaving}
          />
          <Select
            label="Followed"
            data={[{ value: "true", label: "Yes" }, { value: "false", label: "No" }]}
            value={String(editForm.followed)}
            onChange={(value) => setEditForm((f) => ({ ...f, followed: value === "true" }))}
            disabled={isSaving}
          />
          <Group justify="flex-end" mt="sm">
            <Button variant="default" onClick={closeEditModal} disabled={isSaving}>Cancel</Button>
            <Button onClick={onSaveEdit} loading={isSaving}>Save</Button>
          </Group>
        </Stack>
      </Modal>

      {/* Follow-URL prompt modal */}
      <Modal
        opened={followUrlModalOpen}
        onClose={() => setFollowUrlModalOpen(false)}
        title="Add Careers URL"
        centered
        size="md"
      >
        <Stack>
          <Text size="sm">
            <b>{company?.name}</b> doesn&apos;t have a careers URL yet.
            Adding one lets the fetch routine discover open roles automatically.
          </Text>
          <TextInput
            label="Careers / Job board URL"
            type="url"
            placeholder="https://company.com/careers"
            value={followUrlValue}
            onChange={(e) => setFollowUrlValue(e.target.value)}
          />
          <Group justify="flex-end" mt="sm">
            <Button variant="default" onClick={onSkipFollowUrl}>Skip</Button>
            <Button onClick={onConfirmFollowWithUrl}>Follow</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
