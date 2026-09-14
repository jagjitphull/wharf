import { useState } from "react";
import type { GroupInput, GroupRecord } from "@shared/types";
import { ipcErrorMessage, wharf } from "../../api/wharf";
import "../../styles/dialog.css";

interface Props {
  group: GroupRecord | null;
  groups: GroupRecord[];
  onClose(): void;
  onSaved(): void;
}

export function GroupDialog({ group, groups, onClose, onSaved }: Props) {
  const [form, setForm] = useState<GroupInput>(
    group ? { name: group.name, parentId: group.parentId, color: group.color } : { name: "", parentId: null },
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      if (group) await wharf.groups.update(group.id, form);
      else await wharf.groups.create(form);
      onSaved();
    } catch (err) {
      setError(ipcErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const parentCandidates = groups.filter((g) => g.id !== group?.id);

  return (
    <div className="dialog-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="dialog" onSubmit={handleSubmit}>
        <h2>{group ? "Edit group" : "Add group"}</h2>

        <label>
          Name
          <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Production" />
        </label>

        <label>
          Parent group
          <select value={form.parentId ?? ""} onChange={(e) => setForm({ ...form, parentId: e.target.value || null })}>
            <option value="">(top level)</option>
            {parentCandidates.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>

        {error && <div className="dialog-error">{error}</div>}

        <div className="dialog-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
