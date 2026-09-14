import { useMemo, useState } from "react";
import type { GroupRecord, HostRecord } from "@shared/types";
import { useAppStore, type ActiveView } from "../../state/store";
import { ipcErrorMessage, wharf } from "../../api/wharf";
import { HostDialog } from "../HostDialog/HostDialog";
import { GroupDialog } from "../GroupDialog/GroupDialog";
import "./Sidebar.css";

interface Props {
  onOpenQuickConnect(): void;
}

function hostMatchesFilter(host: HostRecord, filter: string): boolean {
  const haystack = `${host.name} ${host.username} ${host.hostname}`.toLowerCase();
  return haystack.includes(filter);
}

export function Sidebar({ onOpenQuickConnect }: Props) {
  const { hosts, groups, activeView, setActiveView, contextHostId, setContextHostId, openTerminal, loadAll } =
    useAppStore();
  const [hostDialog, setHostDialog] = useState<{ host: HostRecord | null; groupId: string | null } | null>(null);
  const [groupDialog, setGroupDialog] = useState<{ group: GroupRecord | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const normalizedFilter = filter.trim().toLowerCase();
  const visibleHosts = useMemo(
    () => (normalizedFilter ? hosts.filter((h) => hostMatchesFilter(h, normalizedFilter)) : hosts),
    [hosts, normalizedFilter],
  );

  async function connect(host: HostRecord) {
    setContextHostId(host.id);
    setError(null);
    try {
      await openTerminal(host);
    } catch (err) {
      setError(ipcErrorMessage(err));
    }
  }

  function openFiles(host: HostRecord) {
    setContextHostId(host.id);
    setActiveView("sftp");
  }

  async function deleteHost(host: HostRecord) {
    if (!confirm(`Delete host "${host.name}"? This also removes its saved credentials.`)) return;
    await wharf.hosts.remove(host.id);
    await loadAll();
  }

  async function deleteGroup(group: GroupRecord) {
    if (!confirm(`Delete group "${group.name}"? Hosts inside become ungrouped.`)) return;
    await wharf.groups.remove(group.id);
    await loadAll();
  }

  function renderHost(host: HostRecord) {
    return (
      <div key={host.id} className={`host-row ${contextHostId === host.id ? "active" : ""}`}>
        <button className="host-name" onDoubleClick={() => connect(host)} onClick={() => setContextHostId(host.id)}>
          <span className="dot" style={{ background: host.color ?? "var(--accent)" }} />
          {host.name}
          <span className="host-sub">
            {host.username}@{host.hostname}:{host.port}
          </span>
        </button>
        <div className="host-actions">
          <button title="Connect" onClick={() => connect(host)}>
            ▶
          </button>
          <button title="Files (SFTP)" onClick={() => openFiles(host)}>
            📁
          </button>
          <button title="Edit" onClick={() => setHostDialog({ host, groupId: host.groupId })}>
            ✎
          </button>
          <button title="Delete" onClick={() => deleteHost(host)}>
            🗑
          </button>
        </div>
      </div>
    );
  }

  function renderGroup(group: GroupRecord | null, depth = 0): React.ReactNode {
    const childGroups = groups.filter((g) => g.parentId === (group?.id ?? null));
    const groupHosts = visibleHosts.filter((h) => h.groupId === (group?.id ?? null));
    const renderedChildGroups = childGroups.map((g) => renderGroup(g, depth + 1)).filter(Boolean);
    // While filtering, hide groups that have no matching hosts anywhere in their subtree.
    if (normalizedFilter && groupHosts.length === 0 && renderedChildGroups.length === 0) return null;
    if (!group && childGroups.length === 0 && groupHosts.length === 0) return null;

    return (
      <div className="group-node" style={{ marginLeft: depth * 12 }} key={group?.id ?? "root"}>
        {group && (
          <div className="group-row">
            <span className="group-name">{group.name}</span>
            <div className="group-actions">
              <button title="Add host here" onClick={() => setHostDialog({ host: null, groupId: group.id })}>
                +
              </button>
              <button title="Edit group" onClick={() => setGroupDialog({ group })}>
                ✎
              </button>
              <button title="Delete group" onClick={() => deleteGroup(group)}>
                🗑
              </button>
            </div>
          </div>
        )}
        {groupHosts.map(renderHost)}
        {renderedChildGroups}
      </div>
    );
  }

  const navItem = (view: ActiveView, label: string) => (
    <button className={`nav-item ${activeView === view ? "active" : ""}`} onClick={() => setActiveView(view)}>
      {label}
    </button>
  );

  return (
    <aside className="sidebar">
      <nav className="sidebar-nav">
        {navItem("hosts", "Hosts")}
        {navItem("tunnels", "Tunnels")}
        {navItem("settings", "Settings")}
      </nav>

      <div className="sidebar-search">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter hosts…"
        />
        <button className="quick-connect-hint-btn" title="Quick Connect" onClick={onOpenQuickConnect}>
          ⌘K
        </button>
      </div>

      <div className="sidebar-toolbar">
        <button className="btn ghost small" onClick={() => setHostDialog({ host: null, groupId: null })}>
          + Host
        </button>
        <button className="btn ghost small" onClick={() => setGroupDialog({ group: null })}>
          + Group
        </button>
      </div>

      {error && <div className="sidebar-error">{error}</div>}

      <div className="host-tree">
        {renderGroup(null)}
        {normalizedFilter && visibleHosts.length === 0 && <p className="sidebar-empty">No hosts match "{filter}".</p>}
      </div>

      <div className="sidebar-footer">
        <span className="host-count">
          {hosts.length} host{hosts.length === 1 ? "" : "s"}
        </span>
      </div>

      {hostDialog && (
        <HostDialog
          host={hostDialog.host}
          groups={groups}
          hosts={hosts}
          defaultGroupId={hostDialog.groupId}
          onClose={() => setHostDialog(null)}
          onSaved={async () => {
            setHostDialog(null);
            await loadAll();
          }}
        />
      )}

      {groupDialog && (
        <GroupDialog
          group={groupDialog.group}
          groups={groups}
          onClose={() => setGroupDialog(null)}
          onSaved={async () => {
            setGroupDialog(null);
            await loadAll();
          }}
        />
      )}
    </aside>
  );
}
