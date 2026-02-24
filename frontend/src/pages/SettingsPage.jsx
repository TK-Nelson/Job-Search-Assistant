import { useEffect, useMemo, useState } from "react";

import {
  createBackup,
  getBackups,
  getSettings,
  initDb,
  restoreBackup,
  runRetentionCleanup,
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
  const [form, setForm] = useState(null);
  const [backups, setBackups] = useState([]);
  const [selectedBackup, setSelectedBackup] = useState("");
  const [validation, setValidation] = useState(null);
  const [status, setStatus] = useState("");
  const [busyAction, setBusyAction] = useState("");

  useEffect(() => {
    getSettings()
      .then((data) => setForm(data))
      .catch((err) => setStatus(`Failed to load settings: ${err.message}`));

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

  if (!form) {
    return <div className="panel">Loading settings...</div>;
  }

  const statusTone = getStatusTone(status);
  const isBusy = Boolean(busyAction);

  return (
    <div className="panel">
      <h2>Settings</h2>
      <p className="muted">Configure local paths, fetch cadence, retention, and scoring weights.</p>

      {hasOneDrivePath && (
        <div className="warning">OneDrive path detected. Local non-synced folders are recommended.</div>
      )}

      <div className="grid">
        <label>
          Runtime data root
          <input value={form.runtime_data_root} onChange={(e) => update("runtime_data_root", e.target.value)} disabled={isBusy} />
        </label>
        <label>
          Database path
          <input value={form.database.path} onChange={(e) => update("database.path", e.target.value)} disabled={isBusy} />
        </label>
        <label>
          Artifacts path
          <input
            value={form.storage.artifacts_dir}
            onChange={(e) => update("storage.artifacts_dir", e.target.value)}
            disabled={isBusy}
          />
        </label>
        <label>
          Backups path
          <input value={form.storage.backups_dir} onChange={(e) => update("storage.backups_dir", e.target.value)} disabled={isBusy} />
        </label>
        <label>
          Fetch interval (minutes)
          <input
            type="number"
            value={form.fetch.interval_minutes}
            onChange={(e) => update("fetch.interval_minutes", e.target.value)}
            disabled={isBusy}
          />
        </label>
        <label>
          Fetch max workers (1-3)
          <input
            type="number"
            min="1"
            max="3"
            value={form.fetch.max_workers}
            onChange={(e) => update("fetch.max_workers", e.target.value)}
            disabled={isBusy}
          />
        </label>
        <label>
          Enable role filters
          <select
            value={String(Boolean(form.fetch.role_filters?.enabled))}
            onChange={(e) => update("fetch.role_filters.enabled", e.target.value === "true")}
            disabled={isBusy}
          >
            <option value="false">No</option>
            <option value="true">Yes</option>
          </select>
        </label>
        <label>
          Role title contains (comma separated)
          <input
            value={csvFromTerms(form.fetch.role_filters?.title_contains || [])}
            onChange={(e) => update("fetch.role_filters.title_contains", e.target.value)}
            disabled={isBusy}
            placeholder="engineer, developer, analyst"
          />
        </label>
        <label>
          Description contains (comma separated)
          <input
            value={csvFromTerms(form.fetch.role_filters?.description_contains || [])}
            onChange={(e) => update("fetch.role_filters.description_contains", e.target.value)}
            disabled={isBusy}
            placeholder="python, sql, stakeholder"
          />
        </label>
        <label>
          Role filter match mode
          <select
            value={form.fetch.role_filters?.match_mode || "any"}
            onChange={(e) => update("fetch.role_filters.match_mode", e.target.value)}
            disabled={isBusy}
          >
            <option value="any">Any term matches</option>
            <option value="all">All terms match</option>
          </select>
        </label>
        <label>
          Resume max size (MB)
          <input
            type="number"
            value={form.resume.max_size_mb}
            onChange={(e) => update("resume.max_size_mb", e.target.value)}
            disabled={isBusy}
          />
        </label>
        <label>
          Postings retention (days)
          <input
            type="number"
            value={form.retention.job_postings_days}
            onChange={(e) => update("retention.job_postings_days", e.target.value)}
            disabled={isBusy}
          />
        </label>
        <label>
          Logs retention (days)
          <input
            type="number"
            value={form.retention.logs_days}
            onChange={(e) => update("retention.logs_days", e.target.value)}
            disabled={isBusy}
          />
        </label>
        <label>
          ATS weight
          <input
            type="number"
            step="0.01"
            value={form.scoring.weights.ats_searchability}
            onChange={(e) => update("scoring.weights.ats_searchability", e.target.value)}
            disabled={isBusy}
          />
        </label>
        <label>
          Hard skills weight
          <input
            type="number"
            step="0.01"
            value={form.scoring.weights.hard_skills}
            onChange={(e) => update("scoring.weights.hard_skills", e.target.value)}
            disabled={isBusy}
          />
        </label>
        <label>
          Soft skills weight
          <input
            type="number"
            step="0.01"
            value={form.scoring.weights.soft_skills}
            onChange={(e) => update("scoring.weights.soft_skills", e.target.value)}
            disabled={isBusy}
          />
        </label>
      </div>

      <div className="actions">
        <button onClick={onValidate} disabled={isBusy}>
          {busyAction === "validate" ? "Validating..." : "Test paths"}
        </button>
        <button onClick={onSave} disabled={isBusy}>
          {busyAction === "save" ? "Saving..." : "Save settings"}
        </button>
        <button onClick={onRestoreDefaults} disabled={isBusy}>
          Restore safe defaults
        </button>
        <button onClick={onInitDb} disabled={isBusy}>
          {busyAction === "init-db" ? "Initializing..." : "Initialize DB"}
        </button>
      </div>

      <section className="panel nested">
        <h3>Maintenance</h3>
        <p className="muted">Create backups, restore from backup, and run retention cleanup.</p>
        <div className="actions">
          <button onClick={onCreateBackup} disabled={isBusy}>
            {busyAction === "create-backup" ? "Creating..." : "Create backup now"}
          </button>
          <button onClick={onCleanupRetention} disabled={isBusy}>
            {busyAction === "cleanup" ? "Cleaning..." : "Run retention cleanup"}
          </button>
          <button onClick={loadBackups} disabled={isBusy}>
            Refresh backup list
          </button>
        </div>
        <div className="grid">
          <label>
            Restore backup
            <select value={selectedBackup} onChange={(e) => setSelectedBackup(e.target.value)} disabled={isBusy}>
              <option value="">Latest backup</option>
              {backups.map((backup) => (
                <option key={backup.name} value={backup.name}>
                  {backup.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="actions">
          <button onClick={onRestoreBackup} disabled={isBusy}>
            {busyAction === "restore-backup" ? "Restoring..." : "Restore selected backup"}
          </button>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Created</th>
                <th>Size (bytes)</th>
              </tr>
            </thead>
            <tbody>
              {backups.map((backup) => (
                <tr key={backup.name}>
                  <td>{backup.name}</td>
                  <td>{backup.created_at}</td>
                  <td>{backup.size_bytes}</td>
                </tr>
              ))}
              {backups.length === 0 && (
                <tr>
                  <td colSpan={3}>No backups found yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {status && <p className={`status status--${statusTone}`}>{status}</p>}

      {validation && (
        <div className="validation">
          <h3>Validation Result</h3>
          <p>{validation.valid ? "Valid" : "Invalid"}</p>
          {validation.warnings?.length > 0 && (
            <>
              <h4>Warnings</h4>
              <ul>
                {validation.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </>
          )}
          {validation.errors?.length > 0 && (
            <>
              <h4>Errors</h4>
              <ul>
                {validation.errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
