import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Anchor,
  Breadcrumbs,
  Button,
  Group,
  Paper,
  Select,
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
  createBackup,
  getBackups,
  getPersonalProfile,
  getSettings,
  initDb,
  restoreBackup,
  runRetentionCleanup,
  savePersonalProfile,
  saveSettings,
  validatePaths,
} from "../api";

function createValidationPayload(form) {
  return {
    runtime_data_root: form.runtime_data_root,
    database_path: form.database.path,
    artifacts_dir: form.storage.artifacts_dir,
    backups_dir: form.storage.backups_dir,
  };
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseCsvTerms(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function csvFromTerms(values) {
  return Array.isArray(values) ? values.join(", ") : "";
}

function toLines(values) {
  return Array.isArray(values) ? values.join("\n") : "";
}

function parseLines(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function getStatusTone(message) {
  const text = String(message || "").toLowerCase();
  if (!text) return "info";
  if (text.includes("failed") || text.includes("error") || text.includes("invalid")) return "error";
  if (text.includes("warning") || text.includes("onedrive")) return "warning";
  if (
    text.includes("saved") ||
    text.includes("passed") ||
    text.includes("initialized") ||
    text.includes("created") ||
    text.includes("completed") ||
    text.includes("reloaded")
  ) {
    return "success";
  }
  return "info";
}

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState("app");
  const [form, setForm] = useState(null);
  const [personalProfile, setPersonalProfile] = useState(null);
  const [backups, setBackups] = useState([]);
  const [selectedBackup, setSelectedBackup] = useState("");
  const [validation, setValidation] = useState(null);
  const [status, setStatus] = useState("");
  const [busyAction, setBusyAction] = useState("");

  useEffect(() => {
    getSettings()
      .then((data) => setForm(data))
      .catch((err) => setStatus(`Failed to load settings: ${err.message}`));

    getPersonalProfile()
      .then((data) => setPersonalProfile(data))
      .catch((err) => setStatus(`Failed to load personal profile: ${err.message}`));

    loadBackups();
  }, []);

  async function loadBackups() {
    try {
      const result = await getBackups();
      setBackups(result.items || []);
      if (!selectedBackup && result.items?.length) {
        setSelectedBackup(result.items[0].name);
      }
    } catch (err) {
      setStatus(`Failed to load backups: ${err.message}`);
    }
  }

  const hasOneDrivePath = useMemo(() => {
    if (!form) return false;
    const values = [
      form.runtime_data_root,
      form.database.path,
      form.storage.artifacts_dir,
      form.storage.backups_dir,
    ];
    return values.some((value) => String(value).toLowerCase().includes("onedrive"));
  }, [form]);

  function update(path, value) {
    setForm((current) => {
      if (!current) return current;

      if (path === "runtime_data_root") return { ...current, runtime_data_root: value };
      if (path === "database.path") return { ...current, database: { ...current.database, path: value } };
      if (path === "storage.artifacts_dir") {
        return { ...current, storage: { ...current.storage, artifacts_dir: value } };
      }
      if (path === "storage.backups_dir") {
        return { ...current, storage: { ...current.storage, backups_dir: value } };
      }
      if (path === "fetch.interval_minutes") {
        return { ...current, fetch: { ...current.fetch, interval_minutes: toNumber(value, 120) } };
      }
      if (path === "fetch.max_workers") {
        return { ...current, fetch: { ...current.fetch, max_workers: toNumber(value, 2) } };
      }
      if (path === "fetch.role_filters.enabled") {
        return {
          ...current,
          fetch: {
            ...current.fetch,
            role_filters: { ...current.fetch.role_filters, enabled: Boolean(value) },
          },
        };
      }
      if (path === "fetch.role_filters.match_mode") {
        return {
          ...current,
          fetch: {
            ...current.fetch,
            role_filters: { ...current.fetch.role_filters, match_mode: value === "all" ? "all" : "any" },
          },
        };
      }
      if (path === "fetch.role_filters.title_contains") {
        return {
          ...current,
          fetch: {
            ...current.fetch,
            role_filters: {
              ...current.fetch.role_filters,
              title_contains: Array.isArray(value) ? value : parseCsvTerms(value),
            },
          },
        };
      }
      if (path === "fetch.role_filters.description_contains") {
        return {
          ...current,
          fetch: {
            ...current.fetch,
            role_filters: {
              ...current.fetch.role_filters,
              description_contains: Array.isArray(value) ? value : parseCsvTerms(value),
            },
          },
        };
      }
      if (path === "resume.max_size_mb") {
        return { ...current, resume: { ...current.resume, max_size_mb: toNumber(value, 2) } };
      }
      if (path === "retention.job_postings_days") {
        return {
          ...current,
          retention: { ...current.retention, job_postings_days: toNumber(value, 180) },
        };
      }
      if (path === "retention.logs_days") {
        return { ...current, retention: { ...current.retention, logs_days: toNumber(value, 30) } };
      }
      if (path === "scoring.weights.ats_searchability") {
        return {
          ...current,
          scoring: {
            ...current.scoring,
            weights: { ...current.scoring.weights, ats_searchability: Number(value) },
          },
        };
      }
      if (path === "scoring.weights.hard_skills") {
        return {
          ...current,
          scoring: {
            ...current.scoring,
            weights: { ...current.scoring.weights, hard_skills: Number(value) },
          },
        };
      }
      if (path === "scoring.weights.soft_skills") {
        return {
          ...current,
          scoring: {
            ...current.scoring,
            weights: { ...current.scoring.weights, soft_skills: Number(value) },
          },
        };
      }

      return current;
    });
  }

  async function onValidate() {
    if (!form) return;
    setBusyAction("validate");
    setStatus("Validating paths...");
    try {
      const result = await validatePaths(createValidationPayload(form));
      setValidation(result);
      setStatus(result.valid ? "Path validation passed." : "Path validation failed.");
    } catch (err) {
      setStatus(`Path validation failed: ${err.message}`);
    } finally {
      setBusyAction("");
    }
  }

  async function onSave() {
    if (!form) return;
    if (hasOneDrivePath) {
      const proceed = window.confirm(
        "One or more paths appear to be in OneDrive. This may cause file lock/sync issues. Continue anyway?"
      );
      if (!proceed) return;
    }

    setBusyAction("save");
    setStatus("Saving settings...");
    try {
      const saved = await saveSettings(form);
      setForm(saved);
      setStatus("Settings saved.");
    } catch (err) {
      setStatus(`Save failed: ${err.message}`);
    } finally {
      setBusyAction("");
    }
  }

  async function onInitDb() {
    setBusyAction("init-db");
    setStatus("Initializing database...");
    try {
      await initDb();
      setStatus("Database initialized.");
    } catch (err) {
      setStatus(`Database init failed: ${err.message}`);
    } finally {
      setBusyAction("");
    }
  }

  async function onCreateBackup() {
    setBusyAction("create-backup");
    setStatus("Creating backup...");
    try {
      const result = await createBackup();
      setStatus(`Backup created: ${result.backup_name}`);
      await loadBackups();
    } catch (err) {
      setStatus(`Backup failed: ${err.message}`);
    } finally {
      setBusyAction("");
    }
  }

  async function onRestoreBackup() {
    setBusyAction("restore-backup");
    setStatus("Restoring backup...");
    try {
      const result = await restoreBackup(selectedBackup || undefined);
      setStatus(`Restore completed from ${result.restored_backup_name}.`);
    } catch (err) {
      setStatus(`Restore failed: ${err.message}`);
    } finally {
      setBusyAction("");
    }
  }

  async function onCleanupRetention() {
    setBusyAction("cleanup");
    setStatus("Running retention cleanup...");
    try {
      const result = await runRetentionCleanup();
      setStatus(
        `Cleanup complete. Deleted postings: ${result.deleted_job_postings}, deleted logs: ${result.deleted_log_files}.`
      );
    } catch (err) {
      setStatus(`Cleanup failed: ${err.message}`);
    } finally {
      setBusyAction("");
    }
  }

  function onRestoreDefaults() {
    getSettings()
      .then((data) => {
        setForm(data);
        setStatus("Reloaded persisted settings.");
      })
      .catch((err) => setStatus(`Failed to restore: ${err.message}`));
  }

  function updatePersonal(path, value) {
    setPersonalProfile((current) => {
      if (!current) return current;

      if (path === "owner.display_name") {
        return { ...current, owner: { ...current.owner, display_name: value } };
      }
      if (path === "owner.target_roles") {
        return { ...current, owner: { ...current.owner, target_roles: parseCsvTerms(value) } };
      }
      if (path === "owner.positioning_preference") {
        return { ...current, owner: { ...current.owner, positioning_preference: value } };
      }
      if (path === "portfolio_sources") {
        return {
          ...current,
          portfolio_sources: parseLines(value).map((url) => ({ url, label: url, enabled: true })),
        };
      }
      if (path === "experience_signals.industries") {
        return {
          ...current,
          experience_signals: { ...current.experience_signals, industries: parseLines(value) },
        };
      }
      if (path === "experience_signals.scope_patterns") {
        return {
          ...current,
          experience_signals: { ...current.experience_signals, scope_patterns: parseLines(value) },
        };
      }
      if (path === "experience_signals.leadership_signals") {
        return {
          ...current,
          experience_signals: { ...current.experience_signals, leadership_signals: parseLines(value) },
        };
      }
      if (path === "experience_signals.outcome_examples") {
        return {
          ...current,
          experience_signals: { ...current.experience_signals, outcome_examples: parseLines(value) },
        };
      }
      return current;
    });
  }

  async function onSavePersonalProfile() {
    if (!personalProfile) return;
    setBusyAction("save-profile");
    setStatus("Saving local personal profile...");
    try {
      const saved = await savePersonalProfile(personalProfile);
      setPersonalProfile(saved);
      setStatus("Personal profile saved locally.");
    } catch (err) {
      setStatus(`Failed to save personal profile: ${err.message}`);
    } finally {
      setBusyAction("");
    }
  }

  if (!form || !personalProfile) {
    return (
      <Stack gap="md">
        <Breadcrumbs>
          <Anchor component={Link} to="/dashboard">Dashboard</Anchor>
          <Text size="sm">Settings</Text>
        </Breadcrumbs>
        <Paper withBorder p="lg" radius="md">Loading settings...</Paper>
      </Stack>
    );
  }

  const statusTone = getStatusTone(status);
  const statusColor = statusTone === "error" ? "red" : statusTone === "warning" ? "yellow" : statusTone === "success" ? "teal" : "blue";
  const isBusy = Boolean(busyAction);

  return (
    <Stack gap="md">
      <Breadcrumbs>
        <Anchor component={Link} to="/dashboard">Dashboard</Anchor>
        <Text size="sm">Settings</Text>
      </Breadcrumbs>

      <Paper withBorder p="lg" radius="md">
      <Title order={2}>Settings</Title>
      <Text c="dimmed" size="sm">Configure local paths, fetch cadence, retention, and scoring weights.</Text>

      <Group mt="md">
        <Button variant={activeTab === "app" ? "filled" : "light"} onClick={() => setActiveTab("app")} disabled={isBusy}>App Settings</Button>
        <Button variant={activeTab === "profile" ? "filled" : "light"} onClick={() => setActiveTab("profile")} disabled={isBusy}>Personal Profile</Button>
      </Group>

      {activeTab === "app" && hasOneDrivePath && (
        <Alert color="yellow" mt="md" variant="light">OneDrive path detected. Local non-synced folders are recommended.</Alert>
      )}

      {activeTab === "app" && (
      <>
      <Group grow mt="md" align="end">
        <TextInput label="Runtime data root" value={form.runtime_data_root} onChange={(e) => update("runtime_data_root", e.target.value)} disabled={isBusy} />
        <TextInput label="Database path" value={form.database.path} onChange={(e) => update("database.path", e.target.value)} disabled={isBusy} />
      </Group>
      <Group grow mt="sm" align="end">
        <TextInput label="Artifacts path" value={form.storage.artifacts_dir} onChange={(e) => update("storage.artifacts_dir", e.target.value)} disabled={isBusy} />
        <TextInput label="Backups path" value={form.storage.backups_dir} onChange={(e) => update("storage.backups_dir", e.target.value)} disabled={isBusy} />
      </Group>
      <Group grow mt="sm" align="end">
        <TextInput type="number" label="Fetch interval (minutes)" value={String(form.fetch.interval_minutes)} onChange={(e) => update("fetch.interval_minutes", e.target.value)} disabled={isBusy} />
        <TextInput type="number" label="Fetch max workers (1-3)" value={String(form.fetch.max_workers)} onChange={(e) => update("fetch.max_workers", e.target.value)} disabled={isBusy} />
      </Group>
      <Group grow mt="sm" align="end">
        <Select
          label="Enable role filters"
          value={String(Boolean(form.fetch.role_filters?.enabled))}
          onChange={(value) => update("fetch.role_filters.enabled", value === "true")}
          disabled={isBusy}
          data={[
            { value: "false", label: "No" },
            { value: "true", label: "Yes" },
          ]}
          allowDeselect={false}
        />
        <Select
          label="Role filter match mode"
          value={form.fetch.role_filters?.match_mode || "any"}
          onChange={(value) => update("fetch.role_filters.match_mode", value || "any")}
          disabled={isBusy}
          data={[
            { value: "any", label: "Any term matches" },
            { value: "all", label: "All terms match" },
          ]}
          allowDeselect={false}
        />
      </Group>
      <Group grow mt="sm" align="end">
        <TextInput
          label="Role title contains (comma separated)"
          value={csvFromTerms(form.fetch.role_filters?.title_contains || [])}
          onChange={(e) => update("fetch.role_filters.title_contains", e.target.value)}
          disabled={isBusy}
          placeholder="engineer, developer, analyst"
        />
        <TextInput
          label="Description contains (comma separated)"
          value={csvFromTerms(form.fetch.role_filters?.description_contains || [])}
          onChange={(e) => update("fetch.role_filters.description_contains", e.target.value)}
          disabled={isBusy}
          placeholder="python, sql, stakeholder"
        />
      </Group>
      <Group grow mt="sm" align="end">
        <TextInput type="number" label="Resume max size (MB)" value={String(form.resume.max_size_mb)} onChange={(e) => update("resume.max_size_mb", e.target.value)} disabled={isBusy} />
        <TextInput type="number" label="Postings retention (days)" value={String(form.retention.job_postings_days)} onChange={(e) => update("retention.job_postings_days", e.target.value)} disabled={isBusy} />
        <TextInput type="number" label="Logs retention (days)" value={String(form.retention.logs_days)} onChange={(e) => update("retention.logs_days", e.target.value)} disabled={isBusy} />
      </Group>
      <Group grow mt="sm" align="end">
        <TextInput type="number" step="0.01" label="ATS weight" value={String(form.scoring.weights.ats_searchability)} onChange={(e) => update("scoring.weights.ats_searchability", e.target.value)} disabled={isBusy} />
        <TextInput type="number" step="0.01" label="Hard skills weight" value={String(form.scoring.weights.hard_skills)} onChange={(e) => update("scoring.weights.hard_skills", e.target.value)} disabled={isBusy} />
        <TextInput type="number" step="0.01" label="Soft skills weight" value={String(form.scoring.weights.soft_skills)} onChange={(e) => update("scoring.weights.soft_skills", e.target.value)} disabled={isBusy} />
      </Group>

      <Group mt="md">
        <Button onClick={onValidate} loading={busyAction === "validate"} disabled={isBusy && busyAction !== "validate"}>Test paths</Button>
        <Button onClick={onSave} loading={busyAction === "save"} disabled={isBusy && busyAction !== "save"}>Save settings</Button>
        <Button variant="light" onClick={onRestoreDefaults} disabled={isBusy}>Restore safe defaults</Button>
        <Button variant="light" onClick={onInitDb} loading={busyAction === "init-db"} disabled={isBusy && busyAction !== "init-db"}>Initialize DB</Button>
      </Group>

      <Paper withBorder p="md" radius="md" mt="md">
        <Text fw={600}>Maintenance</Text>
        <Text c="dimmed" size="sm">Create backups, restore from backup, and run retention cleanup.</Text>
        <Group mt="sm">
          <Button onClick={onCreateBackup} loading={busyAction === "create-backup"} disabled={isBusy && busyAction !== "create-backup"}>Create backup now</Button>
          <Button variant="light" onClick={onCleanupRetention} loading={busyAction === "cleanup"} disabled={isBusy && busyAction !== "cleanup"}>Run retention cleanup</Button>
          <Button variant="subtle" onClick={loadBackups} disabled={isBusy}>Refresh backup list</Button>
        </Group>
        <Group mt="sm" align="end">
          <Select
            label="Restore backup"
            value={selectedBackup || ""}
            onChange={(value) => setSelectedBackup(value || "")}
            disabled={isBusy}
            data={[
              { value: "", label: "Latest backup" },
              ...backups.map((backup) => ({ value: backup.name, label: backup.name })),
            ]}
          />
          <Button onClick={onRestoreBackup} loading={busyAction === "restore-backup"} disabled={isBusy && busyAction !== "restore-backup"}>Restore selected backup</Button>
        </Group>
        <Table.ScrollContainer minWidth={700} mt="md">
          <Table striped highlightOnHover withTableBorder withColumnBorders>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Name</Table.Th>
                <Table.Th>Created</Table.Th>
                <Table.Th>Size (bytes)</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {backups.map((backup) => (
                <Table.Tr key={backup.name}>
                  <Table.Td>{backup.name}</Table.Td>
                  <Table.Td>{backup.created_at}</Table.Td>
                  <Table.Td>{backup.size_bytes}</Table.Td>
                </Table.Tr>
              ))}
              {backups.length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={3}>No backups found yet.</Table.Td>
                </Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>

      {status && (
        <Alert mt="md" color={statusColor} icon={statusTone === "error" ? <AlertCircle size={16} /> : <Info size={16} />} variant="light">
          {status}
        </Alert>
      )}

      {validation && (
        <Paper withBorder p="md" radius="md" mt="md">
          <Text fw={600}>Validation Result</Text>
          <Text>{validation.valid ? "Valid" : "Invalid"}</Text>
          {validation.warnings?.length > 0 && (
            <>
              <Text fw={600} mt="sm">Warnings</Text>
              <ul>
                {validation.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </>
          )}
          {validation.errors?.length > 0 && (
            <>
              <Text fw={600} mt="sm">Errors</Text>
              <ul>
                {validation.errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </>
          )}
        </Paper>
      )}
      </>
      )}

      {activeTab === "profile" && (
        <>
          <Paper withBorder p="md" radius="md" mt="md">
            <Text fw={600}>Personal Profile (Local Only)</Text>
            <Text c="dimmed" size="sm">Parsed portfolio and background signals used for higher-quality resume review. Stored only in local ignored files.</Text>

            <Group grow mt="sm" align="end">
              <TextInput
                label="Display name"
                value={personalProfile.owner?.display_name || ""}
                onChange={(e) => updatePersonal("owner.display_name", e.target.value)}
                disabled={isBusy}
              />
              <TextInput
                label="Target roles (comma separated)"
                value={csvFromTerms(personalProfile.owner?.target_roles || [])}
                onChange={(e) => updatePersonal("owner.target_roles", e.target.value)}
                disabled={isBusy}
              />
            </Group>
            <TextInput
              mt="sm"
              label="Positioning preference"
              value={personalProfile.owner?.positioning_preference || ""}
              onChange={(e) => updatePersonal("owner.positioning_preference", e.target.value)}
              disabled={isBusy}
            />
            <Textarea
              mt="sm"
              label="Portfolio sources (one URL per line)"
              rows={6}
              value={toLines((personalProfile.portfolio_sources || []).map((item) => item.url).filter(Boolean))}
              onChange={(e) => updatePersonal("portfolio_sources", e.target.value)}
              disabled={isBusy}
            />
            <Group grow mt="sm" align="start">
              <Textarea
                label="Industries (one per line)"
                rows={6}
                value={toLines(personalProfile.experience_signals?.industries || [])}
                onChange={(e) => updatePersonal("experience_signals.industries", e.target.value)}
                disabled={isBusy}
              />
              <Textarea
                label="Scope patterns (one per line)"
                rows={6}
                value={toLines(personalProfile.experience_signals?.scope_patterns || [])}
                onChange={(e) => updatePersonal("experience_signals.scope_patterns", e.target.value)}
                disabled={isBusy}
              />
            </Group>
            <Group grow mt="sm" align="start">
              <Textarea
                label="Leadership signals (one per line)"
                rows={6}
                value={toLines(personalProfile.experience_signals?.leadership_signals || [])}
                onChange={(e) => updatePersonal("experience_signals.leadership_signals", e.target.value)}
                disabled={isBusy}
              />
              <Textarea
                label="Outcome examples (one per line)"
                rows={6}
                value={toLines(personalProfile.experience_signals?.outcome_examples || [])}
                onChange={(e) => updatePersonal("experience_signals.outcome_examples", e.target.value)}
                disabled={isBusy}
              />
            </Group>

            <Group mt="md">
              <Button onClick={onSavePersonalProfile} loading={busyAction === "save-profile"} disabled={isBusy && busyAction !== "save-profile"}>Save personal profile</Button>
            </Group>
          </Paper>

          {status && (
            <Alert mt="md" color={statusColor} icon={statusTone === "error" ? <AlertCircle size={16} /> : <Info size={16} />} variant="light">
              {status}
            </Alert>
          )}
        </>
      )}
      </Paper>
    </Stack>
  );
}
