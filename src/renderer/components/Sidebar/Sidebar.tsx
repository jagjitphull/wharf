import { useMemo, useState } from "react";
import type { GroupRecord, HostRecord } from "@shared/types";
import { useAppStore, type ActiveView } from "../../state/store";
import { ipcErrorMessage, wharf } from "../../api/wharf";
import { HostDialog } from "../HostDialog/HostDialog";
import { GroupDialog } from "../GroupDialog/GroupDialog";
import { SshConfigImportDialog } from "../SshConfigImport/SshConfigImportDialog";
import { ContextMenu, useContextMenu } from "../ContextMenu/ContextMenu";
import { IconFolder, IconPencil, IconPlay, IconPlus, IconTerminal, IconTrash } from "../Icons/Icons";
import "./Sidebar.css";

interface Props {
  onOpenQuickConnect(): void;
}

function hostMatchesFilter(host: HostRecord, filter: string): boolean {
  const haystack = `${host.name} ${host.username} ${host.hostname}`.toLowerCase();
  return haystack.includes(filter);
}

/** Sentinel for the "Ungrouped" drop zone (the sidebar footer while
 * dragging a host) — distinct from `null`, which means "not hovering any
 * drop target right now" for dropTargetGroupId. */
const UNGROUPED = "__ungrouped__";

export function Sidebar({ onOpenQuickConnect }: Props) {
  const {
    hosts,
    groups,
    activeView,
    setActiveView,
    contextHostId,
    setContextHostId,
    openTerminal,
    openLocalShell,
    loadAll,
    moveHostToGroup,
  } = useAppStore();
  const [hostDialog, setHostDialog] = useState<{ host: HostRecord | null; groupId: string | null } | null>(null);
  const [groupDialog, setGroupDialog] = useState<{ group: GroupRecord | null } | null>(null);
  const [sshConfigImportOpen, setSshConfigImportOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [draggingHostId, setDraggingHostId] = useState<string | null>(null);
  const [dropTargetGroupId, setDropTargetGroupId] = useState<string | null>(null);
  const { menu, open: openMenu, close: closeMenu } = useContextMenu();

  function endHostDrag() {
    setDraggingHostId(null);
    setDropTargetGroupId(null);
  }

  async function dropHostOnGroup(groupId: string | null) {
    const hostId = draggingHostId;
    endHostDrag();
    if (!hostId) return;
    try {
      await moveHostToGroup(hostId, groupId);
    } catch (err) {
      setError(ipcErrorMessage(err));
    }
  }

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

  async function startLocalShell() {
    setError(null);
    try {
      await openLocalShell();
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
      <div
        key={host.id}
        draggable
        onDragStart={() => setDraggingHostId(host.id)}
        onDragEnd={endHostDrag}
        className={`host-row ${contextHostId === host.id ? "active" : ""} ${draggingHostId === host.id ? "dragging" : ""}`}
        onContextMenu={(e) =>
          openMenu(e, [
            { label: "Connect", onClick: () => connect(host) },
            { label: "Files (SFTP)", onClick: () => openFiles(host) },
            { separator: true },
            { label: "Edit…", onClick: () => setHostDialog({ host, groupId: host.groupId }) },
            { label: "Delete", danger: true, onClick: () => deleteHost(host) },
          ])
        }
      >
        <button className="host-name" onDoubleClick={() => connect(host)} onClick={() => setContextHostId(host.id)}>
          <span className="dot" style={{ background: host.color ?? "var(--accent)" }} />
          <span className="host-title">{host.name}</span>
          {host.mosh && (
            <span className="host-mosh-badge" title="Connects via Mosh">
              Mosh
            </span>
          )}
          <span className="host-sub">
            {host.username}@{host.hostname}:{host.port}
          </span>
        </button>
        <div className="host-actions">
          <button title="Connect" onClick={() => connect(host)}>
            <IconPlay />
          </button>
          <button title="Files (SFTP)" onClick={() => openFiles(host)}>
            <IconFolder />
          </button>
          <button title="Edit" onClick={() => setHostDialog({ host, groupId: host.groupId })}>
            <IconPencil />
          </button>
          <button title="Delete" onClick={() => deleteHost(host)}>
            <IconTrash />
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
          <div
            className={`group-row ${dropTargetGroupId === group.id ? "drop-target" : ""}`}
            onDragOver={(e) => {
              if (!draggingHostId) return;
              e.preventDefault();
              setDropTargetGroupId(group.id);
            }}
            onDragLeave={() => setDropTargetGroupId((cur) => (cur === group.id ? null : cur))}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void dropHostOnGroup(group.id);
            }}
            onContextMenu={(e) =>
              openMenu(e, [
                { label: "Add host here", onClick: () => setHostDialog({ host: null, groupId: group.id }) },
                { separator: true },
                { label: "Edit…", onClick: () => setGroupDialog({ group }) },
                { label: "Delete", danger: true, onClick: () => deleteGroup(group) },
              ])
            }
          >
            <span className="group-name">{group.name}</span>
            <div className="group-actions">
              <button title="Add host here" onClick={() => setHostDialog({ host: null, groupId: group.id })}>
                <IconPlus />
              </button>
              <button title="Edit group" onClick={() => setGroupDialog({ group })}>
                <IconPencil />
              </button>
              <button title="Delete group" onClick={() => deleteGroup(group)}>
                <IconTrash />
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
        {navItem("history", "History")}
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
          <IconPlus size={12} /> Host
        </button>
        <button className="btn ghost small" onClick={() => setGroupDialog({ group: null })}>
          <IconPlus size={12} /> Group
        </button>
        <button
          className="btn ghost small"
          title="Import from ~/.ssh/config"
          onClick={() => setSshConfigImportOpen(true)}
        >
          Import…
        </button>
        <button className="btn ghost small" title="Open a local shell (no SSH)" onClick={startLocalShell}>
          <IconTerminal /> Local Shell
        </button>
      </div>

      {error && <div className="sidebar-error">{error}</div>}

      <div className="host-tree">
        {renderGroup(null)}
        {normalizedFilter && visibleHosts.length === 0 && <p className="sidebar-empty">No hosts match "{filter}".</p>}
      </div>

      <div
        className={`sidebar-footer ${draggingHostId ? "drop-zone" : ""} ${dropTargetGroupId === UNGROUPED ? "drop-target" : ""}`}
        onDragOver={(e) => {
          if (!draggingHostId) return;
          e.preventDefault();
          setDropTargetGroupId(UNGROUPED);
        }}
        onDragLeave={() => setDropTargetGroupId((cur) => (cur === UNGROUPED ? null : cur))}
        onDrop={(e) => {
          e.preventDefault();
          void dropHostOnGroup(null);
        }}
      >
        {draggingHostId ? (
          <span className="host-count">Drop here to ungroup</span>
        ) : (
          <span className="host-count">
            {hosts.length} host{hosts.length === 1 ? "" : "s"}
          </span>
        )}
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

      {sshConfigImportOpen && (
        <SshConfigImportDialog
          onClose={() => setSshConfigImportOpen(false)}
          onImported={async () => {
            setSshConfigImportOpen(false);
            await loadAll();
          }}
        />
      )}

      <ContextMenu menu={menu} onClose={closeMenu} />
    </aside>
  );
}
