import { useEffect, useState } from "react";

import { createCompany, deleteCompany, getCompanies, updateCompany } from "../api";

const emptyForm = {
  name: "",
  careers_url: "",
  notes: "",
  followed: true,
};

function getStatusTone(message) {
  const text = String(message || "").toLowerCase();
  if (!text) return "info";
  if (text.includes("failed") || text.includes("error")) return "error";
  if (text.includes("offline") || text.includes("queued")) return "warning";
  if (
    text.includes("loaded") ||
    text.includes("added") ||
    text.includes("updated") ||
    text.includes("deleted") ||
    text.includes("created") ||
    text.includes("saved") ||
    text.includes("completed")
  ) {
    return "success";
  }
  return "info";
}

export default function CompaniesPage() {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [status, setStatus] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  async function loadCompanies() {
    setIsLoading(true);
    try {
      const response = await getCompanies();
      setItems(response.items || []);
      setStatus(`Loaded ${response.items?.length || 0} company record(s).`);
    } catch (err) {
      setStatus(`Failed to load companies: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadCompanies();
  }, []);

  function updateField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function beginEdit(company) {
    setEditingId(company.id);
    setForm({
      name: company.name,
      careers_url: company.careers_url,
      notes: company.notes || "",
      followed: Boolean(company.followed),
    });
  }

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm);
  }

  async function onSubmit(event) {
    event.preventDefault();
    setIsSubmitting(true);
    setStatus(editingId ? "Updating company..." : "Adding company...");

    try {
      if (editingId) {
        await updateCompany(editingId, form);
        setStatus("Company updated.");
      } else {
        await createCompany(form);
        setStatus("Company added.");
      }

      resetForm();
      await loadCompanies();
    } catch (err) {
      setStatus(`Save failed: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function onDelete(companyId) {
    const proceed = window.confirm("Delete this company?");
    if (!proceed) return;

    setDeletingId(companyId);
    setStatus("Deleting company...");
    try {
      await deleteCompany(companyId);
      setStatus("Company deleted.");
      await loadCompanies();
    } catch (err) {
      setStatus(`Delete failed: ${err.message}`);
    } finally {
      setDeletingId(null);
    }
  }

  const statusTone = getStatusTone(status);

  return (
    <div className="panel">
      <h2>Companies</h2>
      <p className="muted">Add companies to follow and track their career pages.</p>

      <form className="grid" onSubmit={onSubmit}>
        <label>
          Company name
          <input value={form.name} onChange={(e) => updateField("name", e.target.value)} required disabled={isSubmitting} />
        </label>
        <label>
          Careers URL
          <input
            type="url"
            value={form.careers_url}
            onChange={(e) => updateField("careers_url", e.target.value)}
            required
            disabled={isSubmitting}
          />
        </label>
        <label>
          Notes
          <input value={form.notes} onChange={(e) => updateField("notes", e.target.value)} disabled={isSubmitting} />
        </label>
        <label>
          Followed
          <select
            value={String(form.followed)}
            onChange={(e) => updateField("followed", e.target.value === "true")}
            disabled={isSubmitting}
          >
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </label>
        <div className="actions">
          <button type="submit" disabled={isSubmitting}>
            {editingId ? "Update" : "Add"} company
          </button>
          {editingId && (
            <button type="button" onClick={resetForm} disabled={isSubmitting}>
              Cancel edit
            </button>
          )}
        </div>
      </form>

      {status && <p className={`status status--${statusTone}`}>{status}</p>}

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Careers URL</th>
              <th>Followed</th>
              <th>Last Checked</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((company) => (
              <tr key={company.id}>
                <td>{company.name}</td>
                <td>
                  <a href={company.careers_url} target="_blank" rel="noreferrer">
                    {company.careers_url}
                  </a>
                </td>
                <td>{company.followed ? "Yes" : "No"}</td>
                <td>{company.last_checked_at || "-"}</td>
                <td>
                  <button onClick={() => beginEdit(company)} disabled={isSubmitting || deletingId === company.id}>
                    Edit
                  </button>
                  <button onClick={() => onDelete(company.id)} disabled={isSubmitting || deletingId === company.id}>
                    {deletingId === company.id ? "Deleting..." : "Delete"}
                  </button>
                </td>
              </tr>
            ))}
            {isLoading && (
              <tr>
                <td colSpan={5}>Loading companies...</td>
              </tr>
            )}
            {items.length === 0 && !isLoading && (
              <tr>
                <td colSpan={5}>No companies yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
