import { useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Alert,
  Anchor,
  Avatar,
  Badge,
  Breadcrumbs,
  Button,
  Checkbox,
  Group,
  Image,
  Menu,
  Modal,
  MultiSelect,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
  Tooltip,
} from "@mantine/core";
import { AlertCircle, BarChart3, CheckCircle2, Image as ImageIcon, Info, MoreVertical, Pencil, Play, Plus, RefreshCw, Star, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";

import {
  createCompany,
  deleteCompany,
  getApplications,
  getCompanies,
  refreshAllCompanyLogos,
  refreshCompanyLogo,
  testFetchCompany,
  updateCompany,
} from "../api";

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

const emptyForm = {
  name: "",
  careers_url: "",
  search_url: "",
  industry: [],
  notes: "",
  followed: true,
};

function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

/** Returns true when the careers_url looks like a real link (not a placeholder). */
function isRealUrl(url) {
  if (!url) return false;
  return /^https?:\/\//i.test(url) && !url.includes("manual.local/");
}

/** Parse a comma-separated industry string into an array of trimmed values. */
function parseIndustry(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

/** Serialize an array of industries to a comma-separated string (or null). */
function serializeIndustry(arr) {
  if (!arr || arr.length === 0) return null;
  return arr.join(", ");
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

export default function CompaniesPage() {
  const [items, setItems] = useState([]);
  const [allApplications, setAllApplications] = useState([]);
  const [loadInfo, setLoadInfo] = useState("");        // quiet indicator text (hover)
  const [actionMsg, setActionMsg] = useState(null);    // {text, tone} – dismissable toast
  const [isLoading, setIsLoading] = useState(true);
  const [deletingId, setDeletingId] = useState(null);
  const [followingId, setFollowingId] = useState(null);
  const [refreshingLogoId, setRefreshingLogoId] = useState(null);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [testingCompanyId, setTestingCompanyId] = useState(null);

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [modalForm, setModalForm] = useState(emptyForm);
  const [isSaving, setIsSaving] = useState(false);

  // Filters
  const [filterFollowed, setFilterFollowed] = useState(false);
  const [filterSearch, setFilterSearch] = useState("");

  // Follow-URL prompt modal state
  const [followUrlModalOpen, setFollowUrlModalOpen] = useState(false);
  const [followUrlTarget, setFollowUrlTarget] = useState(null);   // company object
  const [followUrlValue, setFollowUrlValue] = useState("");

  function showAction(text, tone = "success") {
    setActionMsg({ text, tone });
  }

  async function loadCompanies() {
    setIsLoading(true);
    try {
      const [companiesResult, applicationsResult] = await Promise.allSettled([
        getCompanies(),
        getApplications(),
      ]);

      const companyItems = companiesResult.status === "fulfilled" ? companiesResult.value.items || [] : [];
      const applicationItems = applicationsResult.status === "fulfilled" ? applicationsResult.value.items || [] : [];
      setAllApplications(applicationItems);

      const appsByCompany = new Map();
      for (const app of applicationItems) {
        const key = String(app.company_name || "").toLowerCase();
        if (!key) continue;
        const current = appsByCompany.get(key);
        if (!current || String(app.updated_at || "") > String(current.updated_at || "")) {
          appsByCompany.set(key, app);
        }
      }

      const merged = new Map();
      for (const company of companyItems) {
        const latestApp = appsByCompany.get(company.name.toLowerCase());
        merged.set(company.id, {
          ...company,
          latest_application_id: latestApp?.id || null,
          applied_stage: latestApp?.stage || "none",
        });
      }

      for (const app of applicationItems) {
        const key = `applied-${String(app.company_name || "unknown").toLowerCase()}`;
        const exists = Array.from(merged.values()).find(
          (company) => String(company.name || "").toLowerCase() === String(app.company_name || "").toLowerCase()
        );
        if (exists || merged.has(key)) continue;

        merged.set(key, {
          id: key,
          name: app.company_name,
          careers_url: "",
          industry: "",
          followed: false,
          notes: "",
          last_checked_at: null,
          created_at: "",
          updated_at: "",
          latest_application_id: app.id,
          applied_stage: app.stage || "none",
          readOnly: true,
        });
      }

      const sortedItems = Array.from(merged.values()).sort((left, right) => String(left.name || "").localeCompare(String(right.name || "")));
      setItems(sortedItems);
      setLoadInfo(`Loaded ${sortedItems.length} company record(s).`);
    } catch (err) {
      showAction(`Failed to load companies: ${err.message}`, "error");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadCompanies();
  }, []);

  // Compute application counts per company (by company id)
  const appCountByCompanyId = useMemo(() => {
    const counts = new Map();
    for (const app of allApplications) {
      // We need to match by company name since applications don't carry company_id directly
      // Instead, find the company id from items
      const companyName = String(app.company_name || "").toLowerCase();
      const matched = items.find((c) => String(c.name || "").toLowerCase() === companyName);
      if (matched && typeof matched.id === "number") {
        counts.set(matched.id, (counts.get(matched.id) || 0) + 1);
      }
    }
    return counts;
  }, [items, allApplications]);

  // Filtered items
  const filteredItems = useMemo(() => {
    let result = items;
    if (filterFollowed) {
      result = result.filter((c) => c.followed);
    }
    if (filterSearch.trim()) {
      const needle = filterSearch.trim().toLowerCase();
      result = result.filter(
        (c) =>
          String(c.name || "").toLowerCase().includes(needle) ||
          String(c.industry || "").toLowerCase().includes(needle)
      );
    }
    return result;
  }, [items, filterFollowed, filterSearch]);

  // Modal helpers
  function openCreateModal() {
    setEditingId(null);
    setModalForm(emptyForm);
    setIsModalOpen(true);
  }

  function openEditModal(company) {
    if (typeof company.id !== "number") return;
    setEditingId(company.id);
    setModalForm({
      name: company.name,
      careers_url: company.careers_url || "",
      search_url: company.search_url || "",
      industry: parseIndustry(company.industry),
      notes: company.notes || "",
      followed: Boolean(company.followed),
    });
    setIsModalOpen(true);
  }

  function closeModal() {
    setIsModalOpen(false);
    setEditingId(null);
    setModalForm(emptyForm);
  }

  async function onSaveModal() {
    setIsSaving(true);
    try {
      const payload = {
        ...modalForm,
        careers_url: modalForm.careers_url || null,
        search_url: modalForm.search_url || null,
        industry: serializeIndustry(modalForm.industry),
        notes: modalForm.notes || null,
      };
      if (editingId) {
        await updateCompany(editingId, payload);
        showAction("Company updated.");
      } else {
        await createCompany(payload);
        showAction("Company added.");
      }
      closeModal();
      await loadCompanies();
    } catch (err) {
      showAction(`Save failed: ${err.message}`, "error");
    } finally {
      setIsSaving(false);
    }
  }

  async function onDelete(companyId) {
    if (typeof companyId !== "number") return;
    const proceed = window.confirm("Delete this company?");
    if (!proceed) return;

    setDeletingId(companyId);
    try {
      await deleteCompany(companyId);
      showAction("Company deleted.");
      await loadCompanies();
    } catch (err) {
      showAction(`Delete failed: ${err.message}`, "error");
    } finally {
      setDeletingId(null);
    }
  }

  async function onToggleFollowed(company) {
    if (typeof company.id !== "number") return;

    // When following a company that has no careers URL, prompt for one first
    if (!company.followed && !isRealUrl(company.careers_url)) {
      setFollowUrlTarget(company);
      setFollowUrlValue("");
      setFollowUrlModalOpen(true);
      return;
    }

    setFollowingId(company.id);
    try {
      await updateCompany(company.id, {
        name: company.name,
        careers_url: company.careers_url || null,
        industry: company.industry || null,
        notes: company.notes || null,
        followed: !company.followed,
      });
      showAction("Followed status updated.");
      await loadCompanies();
    } catch (err) {
      showAction(`Follow status update failed: ${err.message}`, "error");
    } finally {
      setFollowingId(null);
    }
  }

  async function onConfirmFollowWithUrl() {
    if (!followUrlTarget) return;
    setFollowingId(followUrlTarget.id);
    setFollowUrlModalOpen(false);
    try {
      await updateCompany(followUrlTarget.id, {
        name: followUrlTarget.name,
        careers_url: followUrlValue.trim() || null,
        industry: followUrlTarget.industry || null,
        notes: followUrlTarget.notes || null,
        followed: true,
      });
      showAction("Now following — careers URL updated.");
      await loadCompanies();
    } catch (err) {
      showAction(`Follow failed: ${err.message}`, "error");
    } finally {
      setFollowingId(null);
      setFollowUrlTarget(null);
    }
  }

  function onSkipFollowUrl() {
    if (!followUrlTarget) return;
    // Follow without URL — just toggle
    const company = followUrlTarget;
    setFollowUrlModalOpen(false);
    setFollowUrlTarget(null);
    setFollowingId(company.id);
    updateCompany(company.id, {
      name: company.name,
      careers_url: company.careers_url || null,
      industry: company.industry || null,
      notes: company.notes || null,
      followed: true,
    })
      .then(() => { showAction("Now following."); return loadCompanies(); })
      .catch((err) => showAction(`Follow failed: ${err.message}`, "error"))
      .finally(() => setFollowingId(null));
  }

  async function onRefreshLogo(company) {
    if (typeof company.id !== "number") return;
    setRefreshingLogoId(company.id);
    try {
      await refreshCompanyLogo(company.id);
      showAction("Logo refreshed.");
      await loadCompanies();
    } catch (err) {
      showAction(`Logo refresh failed: ${err.message}`, "error");
    } finally {
      setRefreshingLogoId(null);
    }
  }

  async function onRefreshAllLogos() {
    setRefreshingAll(true);
    try {
      const result = await refreshAllCompanyLogos();
      showAction(`Refreshed logos for ${result.updated} companies.`);
      await loadCompanies();
    } catch (err) {
      showAction(`Bulk logo refresh failed: ${err.message}`, "error");
    } finally {
      setRefreshingAll(false);
    }
  }

  async function onTestFetch(company) {
    if (typeof company.id !== "number") return;
    setTestingCompanyId(company.id);
    try {
      const result = await testFetchCompany(company.id);
      if (result.errors && result.errors.length > 0) {
        showAction(`Test fetch for ${company.name}: ${result.errors.join("; ")}`, "error");
      } else {
        showAction(`Test fetch for ${company.name}: found ${result.postings_found} posting(s) via ${result.portal_type || "adapter"}.`);
      }
    } catch (err) {
      showAction(`Test fetch failed for ${company.name}: ${err.message}`, "error");
    } finally {
      setTestingCompanyId(null);
    }
  }

  const isManualPlaceholder = editingId
    ? items.find((c) => c.id === editingId)?.notes === "Created from manual comparison input"
    : false;
  const actionColor = actionMsg?.tone === "error" ? "red" : "teal";

  const followedCount = useMemo(() => items.filter((c) => c.followed).length, [items]);
  const totalApps = useMemo(() => allApplications.length, [allApplications]);
  const industriesCount = useMemo(() => new Set(items.map((c) => c.industry).filter(Boolean)).size, [items]);

  return (
    <Stack gap="md">
      <Breadcrumbs>
        <Anchor component={Link} to="/dashboard">Dashboard</Anchor>
        <Text size="sm">Companies</Text>
      </Breadcrumbs>

      {/* Page title – outside the card */}
      <div>
        <Title order={2}>Companies</Title>
        <Text c="dimmed" size="sm">Track companies, follow status, and applications.</Text>
      </div>

      {/* Summary placeholder cards */}
      <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }} spacing="md">
        <Paper withBorder p="md" radius="md">
          <Group gap="xs">
            <BarChart3 size={18} opacity={0.5} />
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>Total</Text>
          </Group>
          <Text fw={700} size="xl" mt={4}>{items.length}</Text>
          <Text size="xs" c="dimmed">companies tracked</Text>
        </Paper>
        <Paper withBorder p="md" radius="md">
          <Group gap="xs">
            <Star size={18} opacity={0.5} />
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>Followed</Text>
          </Group>
          <Text fw={700} size="xl" mt={4}>{followedCount}</Text>
          <Text size="xs" c="dimmed">companies followed</Text>
        </Paper>
        <Paper withBorder p="md" radius="md">
          <Group gap="xs">
            <BarChart3 size={18} opacity={0.5} />
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>Applications</Text>
          </Group>
          <Text fw={700} size="xl" mt={4}>{totalApps}</Text>
          <Text size="xs" c="dimmed">total applications</Text>
        </Paper>
        <Paper withBorder p="md" radius="md">
          <Group gap="xs">
            <BarChart3 size={18} opacity={0.5} />
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>Industries</Text>
          </Group>
          <Text fw={700} size="xl" mt={4}>{industriesCount}</Text>
          <Text size="xs" c="dimmed">unique industries</Text>
        </Paper>
      </SimpleGrid>

      {/* Dismissable action toast */}
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

      <Paper withBorder p="lg" radius="md">
        {/* Table action bar: title + status indicator + filters */}
        <Group justify="space-between" align="center" wrap="wrap" mb="md">
          <Group gap="xs" align="center">
            <Title order={4}>Company Records</Title>
            <Tooltip label={loadInfo || "Loading..."} withArrow position="right">
              <ActionIcon variant="subtle" color={isLoading ? "gray" : "teal"} size="sm">
                {isLoading ? <Info size={14} /> : <CheckCircle2 size={14} />}
              </ActionIcon>
            </Tooltip>
          </Group>
          <Group gap="sm" align="center">
            <TextInput
              placeholder="Search name or industry"
              size="xs"
              value={filterSearch}
              onChange={(e) => setFilterSearch(e.target.value)}
              w={200}
            />
            <Checkbox
              label="Followed only"
              size="xs"
              checked={filterFollowed}
              onChange={(e) => { const c = e.currentTarget.checked; setFilterFollowed(c); }}
            />
            <Button size="xs" variant="light" leftSection={<RefreshCw size={14} />} onClick={onRefreshAllLogos} loading={refreshingAll}>
              Refresh logos
            </Button>
            <Button size="xs" leftSection={<Plus size={14} />} onClick={openCreateModal}>
              Add company
            </Button>
          </Group>
        </Group>

        <Table.ScrollContainer minWidth={1000}>
          <Table striped highlightOnHover withTableBorder withColumnBorders>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>★</Table.Th>
                <Table.Th>Company</Table.Th>
                <Table.Th>Industry</Table.Th>
                <Table.Th>Applications</Table.Th>
                <Table.Th>Last Checked</Table.Th>
                <Table.Th>Actions</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {filteredItems.map((company) => {
                const appCount = typeof company.id === "number" ? appCountByCompanyId.get(company.id) || 0 : 0;
                return (
                  <Table.Tr key={company.id}>
                    <Table.Td>
                      <ActionIcon
                        variant="subtle"
                        color={company.followed ? "yellow" : "gray"}
                        onClick={() => onToggleFollowed(company)}
                        disabled={typeof company.id !== "number" || followingId === company.id}
                        aria-label={company.followed ? "Unfollow company" : "Follow company"}
                      >
                        <Star size={16} fill={company.followed ? "currentColor" : "none"} />
                      </ActionIcon>
                    </Table.Td>
                    <Table.Td>
                      <Group gap="sm" wrap="nowrap">
                        {company.logo_url ? (
                          <Avatar radius={8} size="md" src={company.logo_url} alt={company.name}>
                            {initials(company.name)}
                          </Avatar>
                        ) : (
                          <Avatar radius={8} size="md" color="blue">{initials(company.name)}</Avatar>
                        )}
                        {typeof company.id === "number" ? (
                          <Anchor component={Link} to={`/companies/${company.id}`}>
                            {company.name}
                          </Anchor>
                        ) : (
                          <Text>{company.name}</Text>
                        )}
                      </Group>
                    </Table.Td>
                    <Table.Td>{company.industry || "-"}</Table.Td>
                    <Table.Td>
                      {appCount > 0 && typeof company.id === "number" ? (
                        <Anchor component={Link} to={`/applications?companyId=${company.id}`} size="sm">
                          <Badge variant="light" size="lg">{appCount}</Badge>
                        </Anchor>
                      ) : (
                        <Text size="sm" c="dimmed">0</Text>
                      )}
                    </Table.Td>
                    <Table.Td>{formatDate(company.last_checked_at)}</Table.Td>
                    <Table.Td>
                      <Menu shadow="md" width={180} position="bottom-end" withArrow>
                        <Menu.Target>
                          <ActionIcon variant="subtle" disabled={typeof company.id !== "number"}>
                            <MoreVertical size={16} />
                          </ActionIcon>
                        </Menu.Target>
                        <Menu.Dropdown>
                          <Menu.Item
                            leftSection={<Pencil size={14} />}
                            onClick={() => openEditModal(company)}
                            disabled={isSaving || deletingId === company.id}
                          >
                            Edit
                          </Menu.Item>
                          <Menu.Item
                            leftSection={<ImageIcon size={14} />}
                            onClick={() => onRefreshLogo(company)}
                            disabled={refreshingLogoId === company.id}
                          >
                            Refresh logo
                          </Menu.Item>
                          <Menu.Item
                            leftSection={<Play size={14} />}
                            onClick={() => onTestFetch(company)}
                            disabled={testingCompanyId === company.id || !company.careers_url}
                          >
                            {testingCompanyId === company.id ? "Testing..." : "Test fetch"}
                          </Menu.Item>
                          <Menu.Divider />
                          <Menu.Item
                            color="red"
                            leftSection={<Trash2 size={14} />}
                            onClick={() => onDelete(company.id)}
                            disabled={isSaving || deletingId === company.id}
                          >
                            Delete
                          </Menu.Item>
                        </Menu.Dropdown>
                      </Menu>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
              {isLoading && (
                <Table.Tr>
                  <Table.Td colSpan={6}>Loading companies...</Table.Td>
                </Table.Tr>
              )}
              {filteredItems.length === 0 && !isLoading && (
                <Table.Tr>
                  <Table.Td colSpan={6}>No companies match the current filters.</Table.Td>
                </Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>

      {/* Create / Edit modal */}
      <Modal opened={isModalOpen} onClose={closeModal} title={editingId ? "Edit company" : "Add company"} centered>
        <Stack>
          <TextInput
            label="Company name"
            value={modalForm.name}
            onChange={(e) => setModalForm((f) => ({ ...f, name: e.target.value }))}
            required
            disabled={isSaving}
          />
          <TextInput
            label="Careers / Job board URL"
            type="url"
            placeholder="https://company.com/careers"
            value={modalForm.careers_url}
            onChange={(e) => setModalForm((f) => ({ ...f, careers_url: e.target.value }))}
            disabled={isSaving}
          />
          <TextInput
            label="Search portal URL"
            type="url"
            placeholder="https://company.com/search-jobs?q="
            value={modalForm.search_url}
            onChange={(e) => setModalForm((f) => ({ ...f, search_url: e.target.value }))}
            disabled={isSaving}
          />
          <MultiSelect
            label="Industry"
            placeholder={isManualPlaceholder ? "Add industry for this manually-created entry" : "Select or type industries"}
            data={INDUSTRY_OPTIONS}
            value={modalForm.industry}
            onChange={(value) => setModalForm((f) => ({ ...f, industry: value }))}
            searchable
            creatable
            getCreateLabel={(query) => `+ Add "${query}"`}
            disabled={isSaving}
          />
          <Textarea
            label="Notes"
            value={modalForm.notes}
            onChange={(e) => setModalForm((f) => ({ ...f, notes: e.target.value }))}
            disabled={isSaving}
          />
          <Select
            label="Followed"
            data={[{ value: "true", label: "Yes" }, { value: "false", label: "No" }]}
            value={String(modalForm.followed)}
            onChange={(value) => setModalForm((f) => ({ ...f, followed: value === "true" }))}
            disabled={isSaving}
          />
          {isManualPlaceholder && (
            <Alert color="blue" icon={<Info size={16} />} variant="light">
              This company was auto-created from a manual comparison input. Consider adding a real careers URL and industry.
            </Alert>
          )}
          <Group justify="flex-end" mt="sm">
            <Button variant="default" onClick={closeModal} disabled={isSaving}>Cancel</Button>
            <Button onClick={onSaveModal} loading={isSaving}>Save</Button>
          </Group>
        </Stack>
      </Modal>

      {/* Follow-URL prompt modal */}
      <Modal
        opened={followUrlModalOpen}
        onClose={() => { setFollowUrlModalOpen(false); setFollowUrlTarget(null); }}
        title="Add Careers URL"
        centered
        size="md"
      >
        <Stack>
          <Text size="sm">
            <b>{followUrlTarget?.name}</b> doesn&apos;t have a careers URL yet.
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
