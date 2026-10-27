import { useEffect, useMemo, useState } from "react";
import type { HostRecord } from "@shared/types";
import { useAppStore } from "../../state/store";
import { ipcErrorMessage, wharf } from "../../api/wharf";
import { HostDialog } from "../HostDialog/HostDialog";
import { GroupDialog } from "../GroupDialog/GroupDialog";
import { SshConfigImportDialog } from "../SshConfigImport/SshConfigImportDialog";
import { ContextMenu, useContextMenu } from "../ContextMenu/ContextMenu";
import {
  IconCards,
  IconFolder,
  IconList,
  IconPencil,
  IconPin,
  IconPlus,
  IconSearch,
  IconServer,
  IconTerminal,
  IconTunnel,
} from "../Icons/Icons";
import { TunnelDialog } from "../Tunnels/TunnelDialog";
import { isTunnelLive, useTunnelStatuses } from "../../state/useTunnelStatuses";
import { useUiPrefsStore } from "../../state/uiPrefsStore";
import { toast } from "../../state/toastStore";
import { REACHABILITY_LABEL, useReachability } from "../../state/useReachability";
import { buildSections, formatLastConnected, greeting, hostGlyph, isDropSection, sectionGroupId, type HomeFilter } from "./homeModel";
import "./HomeView.css";

/** Host colours are free hex values; a translucent tint of one makes the tile. */
function tint(color: string): string {
  return `color-mix(in srgb, ${color} 18%, transparent)`;
}

export function HomeView() {
  const { hosts, groups, paneMeta, tunnels, openTerminal, setContextHostId, setActiveView, loadAll, refreshHosts, moveHostToGroup } =
    useAppStore();
  const homeView = useUiPrefsStore((s) => s.homeView);
  const setHomeView = useUiPrefsStore((s) => s.setHomeView);
  const [query, setQuery] = useState("");
  // Coming back to Home (from a terminal you just opened, say) should show the host as just connected.
  useEffect(() => {
    void refreshHosts();
  }, [refreshHosts]);
  const now = Date.now();
  const [filter, setFilter] = useState<HomeFilter>("all");
  const [error, setError] = useState<string | null>(null);
  const [hostDialog, setHostDialog] = useState<{ host: HostRecord | null; groupId: string | null } | null>(null);
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [tunnelHost, setTunnelHost] = useState<HostRecord | null>(null);
  const tunnelStatuses = useTunnelStatuses();
  const { menu, open: openMenu, close: closeMenu } = useContextMenu();
  // Dragging a host to another group: what is being dragged, and which group is under it.
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  // Live sessions per host — the only status Wharf actually knows, so it's the only one shown.
  const sessions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of Object.values(paneMeta)) {
      if (m.hostId && !m.closed) counts.set(m.hostId, (counts.get(m.hostId) ?? 0) + 1);
    }
    return counts;
  }, [paneMeta]);
  // Tunnels that are up (or coming up), per host, for the "⇄ 2" mark on its card.
  const liveTunnels = useMemo(() => {
    const byHost = new Map<string, string[]>();
    for (const t of tunnels) {
      if (isTunnelLive(tunnelStatuses[t.id]?.status)) byHost.set(t.hostId, [...(byHost.get(t.hostId) ?? []), t.name]);
    }
    return byHost;
  }, [tunnels, tunnelStatuses]);
  const reachability = useReachability(hosts);
  const connectedIds = useMemo(() => new Set(sessions.keys()), [sessions]);
  const sections = useMemo(
    () => buildSections(hosts, groups, { query, filter, connectedHostIds: connectedIds }),
    [hosts, groups, query, filter, connectedIds],
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

  async function togglePin(host: HostRecord) {
    try {
      await wharf.hosts.setPinned(host.id, !host.pinned);
      await refreshHosts();
    } catch (err) {
      setError(ipcErrorMessage(err));
    }
  }

  function endDrag() {
    setDraggingId(null);
    setDropTarget(null);
  }

  /** `groupId` null = no group. Dropping a host on the group it is already in does nothing. */
  async function dropOn(groupId: string | null) {
    const host = hosts.find((h) => h.id === draggingId);
    endDrag();
    if (!host || host.groupId === groupId) return;
    try {
      await moveHostToGroup(host.id, groupId);
      const target = groupId ? groups.find((g) => g.id === groupId)?.name : null;
      toast.success(target ? `Moved ${host.name} to ${target}` : `Moved ${host.name} out of its group`);
    } catch (err) {
      setError(ipcErrorMessage(err));
    }
  }

  /** Props that make a drop target of an element standing for `groupId` (a group, or null for "no group"). */
  function dropProps(key: string, groupId: string | null) {
    if (!draggingId) return {};
    return {
      onDragOver: (e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (dropTarget !== key) setDropTarget(key);
      },
      onDragLeave: (e: React.DragEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null) && dropTarget === key) setDropTarget(null);
      },
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        void dropOn(groupId);
      },
    };
  }

  function hostMenu(host: HostRecord) {
    return [
      { label: "Connect", onClick: () => connect(host) },
      { label: "Files (SFTP)", onClick: () => openFiles(host) },
      { label: "Port forward…", onClick: () => setTunnelHost(host) },
      { label: host.pinned ? "Unpin" : "Pin to top", onClick: () => togglePin(host) },
      { separator: true as const },
      { label: "Edit…", onClick: () => setHostDialog({ host, groupId: host.groupId }) },
      { label: "Delete", danger: true, onClick: () => deleteHost(host) },
    ];
  }

  const dragProps = (host: HostRecord) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", host.name); // some platforms won't start a drag without data
      setDraggingId(host.id);
    },
    onDragEnd: endDrag,
  });

  const chips: { id: HomeFilter; label: string }[] = [
    { id: "all", label: "All" },
    ...groups.map((g) => ({ id: g.id, label: g.name })),
    ...(connectedIds.size > 0 ? [{ id: "connected", label: "Connected" }] : []),
  ];
  // A group chip can disappear (deleted, or "Connected" once everything closes) while selected.
  const activeFilter = chips.some((c) => c.id === filter) ? filter : "all";

  function card(host: HostRecord) {
    const color = host.color ?? "var(--accent)";
    const live = sessions.get(host.id) ?? 0;
    const reach = reachability[host.id] ?? "checking";
    return (
      <div
        key={host.id}
        className={`host-card ${live ? "live" : ""} ${draggingId === host.id ? "dragging" : ""}`}
        role="button"
        tabIndex={0}
        onClick={() => void connect(host)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void connect(host);
        }}
        onContextMenu={(e) => openMenu(e, hostMenu(host))}
        {...dragProps(host)}
      >
        <div className="host-card-top">
          <span className="host-card-tile" style={{ background: tint(color), color }}>
            {hostGlyph(host.name)}
          </span>
          <span className="host-card-id">
            <span className="host-card-name">
              {host.name}
              {host.pinned && <IconPin size={11} />}
            </span>
            <span className="host-card-addr">
              {host.username}@{host.hostname}:{host.port}
            </span>
          </span>
          {live > 0 ? (
            <span className="host-card-status">
              <span className="host-card-dot" />
              {live === 1 ? "connected" : `${live} sessions`}
            </span>
          ) : (
            <span className={`host-card-reach ${reach}`} title={REACHABILITY_LABEL[reach]}>
              <span className="host-card-dot" />
              {reach === "online" ? "online" : reach === "offline" ? "offline" : ""}
            </span>
          )}
        </div>
        <div className="host-card-meta">
          {host.mosh && <span className="host-card-tag">Mosh</span>}
          {liveTunnels.has(host.id) && (
            <span className="host-card-tag host-card-tunnels" title={`Tunnels up: ${liveTunnels.get(host.id)!.join(", ")}`}>
              ⇄ {liveTunnels.get(host.id)!.length}
            </span>
          )}
          {(host.tags ?? []).map((t) => (
            <span key={t} className="host-card-tag">
              {t}
            </span>
          ))}
          {host.lastConnectedAt ? (
            <span className="host-card-last" title={new Date(host.lastConnectedAt).toLocaleString()}>
              {formatLastConnected(host.lastConnectedAt, now)}
            </span>
          ) : null}
        </div>
        <div className="host-card-actions" onClick={(e) => e.stopPropagation()}>
          <button className="primary" title="Open terminal" onClick={() => void connect(host)}>
            <IconTerminal size={15} />
          </button>
          <button title="Browse files" onClick={() => openFiles(host)}>
            <IconFolder size={15} />
          </button>
          <button
            className={host.pinned ? "pinned" : ""}
            title={host.pinned ? "Unpin" : "Pin to top"}
            aria-label={host.pinned ? "Unpin" : "Pin"}
            aria-pressed={host.pinned === true}
            onClick={() => void togglePin(host)}
          >
            <IconPin size={15} />
          </button>
          <button title="Port forward…" aria-label="Port forward" onClick={() => setTunnelHost(host)}>
            <IconTunnel size={15} />
          </button>
          <button title="Edit host" onClick={() => setHostDialog({ host, groupId: host.groupId })}>
            <IconPencil size={15} />
          </button>
        </div>
      </div>
    );
  }

  /** The compact layout: one line per host. */
  function row(host: HostRecord) {
    const color = host.color ?? "var(--accent)";
    const live = sessions.get(host.id) ?? 0;
    const reach = reachability[host.id] ?? "checking";
    return (
      <div
        key={host.id}
        className={`home-row ${live ? "live" : ""} ${draggingId === host.id ? "dragging" : ""}`}
        role="button"
        tabIndex={0}
        onClick={() => void connect(host)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void connect(host);
        }}
        onContextMenu={(e) => openMenu(e, hostMenu(host))}
        {...dragProps(host)}
      >
        <span className="home-row-tile" style={{ background: tint(color), color }}>
          {hostGlyph(host.name)}
        </span>
        <span className="home-row-name">
          {host.name}
          {host.pinned && <IconPin size={11} />}
        </span>
        <span className="home-row-addr">
          {host.username}@{host.hostname}:{host.port}
        </span>
        <span className="home-row-tags">
          {host.mosh && <span className="host-card-tag">Mosh</span>}
          {liveTunnels.has(host.id) && (
            <span className="host-card-tag host-card-tunnels" title={`Tunnels up: ${liveTunnels.get(host.id)!.join(", ")}`}>
              ⇄ {liveTunnels.get(host.id)!.length}
            </span>
          )}
          {(host.tags ?? []).map((t) => (
            <span key={t} className="host-card-tag">
              {t}
            </span>
          ))}
        </span>
        <span className="home-row-last" title={host.lastConnectedAt ? new Date(host.lastConnectedAt).toLocaleString() : undefined}>
          {host.lastConnectedAt ? formatLastConnected(host.lastConnectedAt, now) : ""}
        </span>
        {live > 0 ? (
          <span className="host-card-status">
            <span className="host-card-dot" />
            {live === 1 ? "connected" : `${live} sessions`}
          </span>
        ) : (
          <span className={`host-card-reach ${reach}`} title={REACHABILITY_LABEL[reach]}>
            <span className="host-card-dot" />
            {reach === "online" ? "online" : reach === "offline" ? "offline" : ""}
          </span>
        )}
        <span className="home-row-actions" onClick={(e) => e.stopPropagation()}>
          <button
            className={host.pinned ? "pinned" : ""}
            title={host.pinned ? "Unpin" : "Pin to top"}
            aria-label={host.pinned ? "Unpin" : "Pin"}
            aria-pressed={host.pinned === true}
            onClick={() => void togglePin(host)}
          >
            <IconPin size={14} />
          </button>
          <button title="Open terminal" aria-label="Open terminal" onClick={() => void connect(host)}>
            <IconTerminal size={14} />
          </button>
          <button title="Browse files" aria-label="Browse files" onClick={() => openFiles(host)}>
            <IconFolder size={14} />
          </button>
          <button title="Port forward…" aria-label="Port forward" onClick={() => setTunnelHost(host)}>
            <IconTunnel size={14} />
          </button>
          <button title="Edit host" aria-label="Edit host" onClick={() => setHostDialog({ host, groupId: host.groupId })}>
            <IconPencil size={14} />
          </button>
        </span>
      </div>
    );
  }

  const hostItem = homeView === "list" ? row : card;

  const connectedCount = connectedIds.size;
  return (
    <div className="home view-enter">
      <div className="home-scroll">
        <header className="home-header">
          <div>
            <h1>{greeting(new Date().getHours())}</h1>
            <p className="home-sub">
              {hosts.length} host{hosts.length === 1 ? "" : "s"} · {connectedCount} connected
            </p>
          </div>
          <div className="home-header-actions">
            <label className="home-search">
              <IconSearch size={16} />
              <input
                value={query}
                placeholder="Search hosts, users, tags…"
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search hosts"
              />
            </label>
            <button className="btn primary home-new" onClick={() => setHostDialog({ host: null, groupId: null })}>
              <IconPlus size={15} /> New host
            </button>
          </div>
        </header>

        {error && <div className="home-error">{error}</div>}

        {hosts.length > 0 && (
          <div className="home-chips">
            {chips.map((c) => {
              const isGroup = groups.some((g) => g.id === c.id);
              return (
                <button
                  key={c.id}
                  className={`home-chip ${activeFilter === c.id ? "active" : ""} ${dropTarget === `chip:${c.id}` ? "drop-target" : ""}`}
                  onClick={() => setFilter(c.id)}
                  {...(isGroup ? dropProps(`chip:${c.id}`, c.id) : {})}
                >
                  {c.label}
                </button>
              );
            })}
            <span className="home-view-toggle" role="group" aria-label="Layout">
              <button
                className={homeView === "cards" ? "active" : ""}
                title="Cards"
                aria-label="Cards"
                aria-pressed={homeView === "cards"}
                onClick={() => setHomeView("cards")}
              >
                <IconCards size={15} />
              </button>
              <button
                className={homeView === "list" ? "active" : ""}
                title="Compact list"
                aria-label="List"
                aria-pressed={homeView === "list"}
                onClick={() => setHomeView("list")}
              >
                <IconList size={15} />
              </button>
            </span>
          </div>
        )}

        {hosts.length === 0 ? (
          <div className="home-empty">
            <span className="home-empty-icon">
              <IconServer size={30} />
            </span>
            <h2>Add your first host</h2>
            <p>Save a server once, then connect with a click — or import the ones you already have in ~/.ssh/config.</p>
            <div className="home-empty-actions">
              <button className="btn primary" onClick={() => setHostDialog({ host: null, groupId: null })}>
                <IconPlus size={14} /> New host
              </button>
              <button className="btn" onClick={() => setImportOpen(true)}>
                Import from ssh config
              </button>
              <button className="btn ghost" onClick={() => void useAppStore.getState().openLocalShell()}>
                Open local shell
              </button>
            </div>
          </div>
        ) : sections.length === 0 ? (
          <p className="home-none">No hosts match “{query}”.</p>
        ) : (
          sections.map((sec) => (
            <section
              key={sec.id}
              className={`home-section ${dropTarget === sec.id ? "drop-target" : ""}`}
              data-section={sec.id}
              {...(isDropSection(sec.id) ? dropProps(sec.id, sectionGroupId(sec.id)) : {})}
            >
              <h3>
                {sec.title}
                <span className="home-section-count">{sec.hosts.length + (sec.pinnedAbove ?? 0)}</span>
              </h3>
              {sec.hosts.length > 0 ? (
                <div className={homeView === "list" ? "home-list" : "home-grid"}>{sec.hosts.map(hostItem)}</div>
              ) : (
                <p className="home-section-note empty">Every host here is pinned above. Drop a host here to move it into {sec.title}.</p>
              )}
              {sec.hosts.length > 0 && sec.pinnedAbove ? (
                <p className="home-section-note">
                  {sec.pinnedAbove} more {sec.pinnedAbove === 1 ? "host is" : "hosts are"} pinned above.
                </p>
              ) : null}
            </section>
          ))
        )}

        {hosts.length > 0 && (
          <div className="home-footer-actions">
            <button className="btn ghost small" onClick={() => setGroupDialogOpen(true)}>
              <IconPlus size={12} /> New group
            </button>
            <button className="btn ghost small" onClick={() => setImportOpen(true)}>
              Import from ssh config…
            </button>
          </div>
        )}
      </div>

      {draggingId && (
        <div className="home-drop-bar" role="region" aria-label="Move to group">
          <span>Drop on a group to move it:</span>
          {groups.map((g) => (
            <span
              key={g.id}
              className={`home-drop-pill ${dropTarget === `bar:${g.id}` ? "active" : ""}`}
              {...dropProps(`bar:${g.id}`, g.id)}
            >
              {g.name}
            </span>
          ))}
          <span className={`home-drop-pill ${dropTarget === "bar:none" ? "active" : ""}`} {...dropProps("bar:none", null)}>
            No group
          </span>
        </div>
      )}

      {tunnelHost && <TunnelDialog host={tunnelHost} onClose={() => setTunnelHost(null)} />}

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
      {groupDialogOpen && (
        <GroupDialog
          group={null}
          groups={groups}
          onClose={() => setGroupDialogOpen(false)}
          onSaved={async () => {
            setGroupDialogOpen(false);
            await loadAll();
          }}
        />
      )}
      {importOpen && (
        <SshConfigImportDialog
          onClose={() => setImportOpen(false)}
          onImported={async () => {
            setImportOpen(false);
            await loadAll();
          }}
        />
      )}
      <ContextMenu menu={menu} onClose={closeMenu} />
    </div>
  );
}
