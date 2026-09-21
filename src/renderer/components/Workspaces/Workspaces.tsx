import { useState } from "react";
import type { WorkspaceNode } from "@shared/types";
import { useAppStore } from "../../state/store";
import { ipcErrorMessage, wharf } from "../../api/wharf";
import { IconFolder, IconPlay } from "../Icons/Icons";
import { EmptyState } from "../EmptyState/EmptyState";
import "./Workspaces.css";

function countPanes(node: WorkspaceNode): number {
  return node.type === "leaf" ? 1 : node.children.reduce((sum, c) => sum + countPanes(c), 0);
}

export function Workspaces() {
  const { hosts, workspaces, tabs, saveCurrentAsWorkspace, openWorkspace, refreshWorkspaces } = useAppStore();
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function handleSave() {
    const name = prompt("Workspace name:", `Layout ${workspaces.length + 1}`);
    if (!name) return;
    setError(null);
    try {
      await saveCurrentAsWorkspace(name);
    } catch (err) {
      setError(ipcErrorMessage(err));
    }
  }

  async function handleOpen(id: string) {
    setError(null);
    setBusyId(id);
    try {
      await openWorkspace(id);
    } catch (err) {
      setError(ipcErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function handleRemove(id: string, name: string) {
    if (!confirm(`Delete workspace "${name}"? This only removes the saved layout — any open tabs are unaffected.`)) return;
    await wharf.workspaces.remove(id);
    await refreshWorkspaces();
  }

  function hostLabel(hostId: string | null): string {
    if (!hostId) return "Local Shell";
    return hosts.find((h) => h.id === hostId)?.name ?? "(deleted host)";
  }

  function describeTab(node: WorkspaceNode): string {
    if (node.type === "leaf") return hostLabel(node.hostId);
    return node.children.map(describeTab).join(node.direction === "row" ? " | " : " / ");
  }

  if (workspaces.length === 0) {
    return (
      <EmptyState
        icon={<IconFolder size={40} />}
        title="No saved workspaces"
        hint="Open the tabs and splits you want, then save the current layout — reopen every host in it with one click next time."
      >
        <button className="btn primary small" onClick={handleSave} disabled={tabs.length === 0}>
          Save current layout…
        </button>
      </EmptyState>
    );
  }

  return (
    <div className="workspaces-panel">
      <div className="workspaces-header">
        <h2>Workspaces</h2>
        <button className="btn ghost small" onClick={handleSave} disabled={tabs.length === 0}>
          Save current layout…
        </button>
      </div>
      <p className="hint">
        A saved set of tabs (and their splits) — each pane remembers which host it connects to, not a live session,
        so opening one always reconnects fresh.
      </p>
      {error && <div className="dialog-error">{error}</div>}
      <div className="workspaces-list">
        {workspaces.map((w) => (
          <div className="workspace-row" key={w.id}>
            <div className="workspace-info">
              <span className="workspace-name">{w.name}</span>
              <span className="workspace-detail">
                {w.tabs.length} tab{w.tabs.length === 1 ? "" : "s"}, {w.tabs.reduce((n, t) => n + countPanes(t.layout), 0)} pane
                {w.tabs.reduce((n, t) => n + countPanes(t.layout), 0) === 1 ? "" : "s"} —{" "}
                {w.tabs.map((t) => describeTab(t.layout)).join(", ")}
              </span>
            </div>
            <div className="workspace-actions">
              <button className="btn ghost small" onClick={() => handleOpen(w.id)} disabled={busyId === w.id} title="Open">
                <IconPlay size={12} /> {busyId === w.id ? "Opening…" : "Open"}
              </button>
              <button className="btn ghost small" onClick={() => handleRemove(w.id, w.name)}>
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
