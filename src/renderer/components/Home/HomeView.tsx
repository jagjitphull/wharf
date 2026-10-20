import { useMemo, useState } from "react";
import type { HostRecord } from "@shared/types";
import { useAppStore } from "../../state/store";
import { ipcErrorMessage, wharf } from "../../api/wharf";
import { HostDialog } from "../HostDialog/HostDialog";
import { GroupDialog } from "../GroupDialog/GroupDialog";
import { SshConfigImportDialog } from "../SshConfigImport/SshConfigImportDialog";
import { ContextMenu, useContextMenu } from "../ContextMenu/ContextMenu";
import { IconFolder, IconPencil, IconPlus, IconSearch, IconServer, IconTerminal } from "../Icons/Icons";
import { REACHABILITY_LABEL, useReachability } from "../../state/useReachability";
import { buildSections, greeting, hostGlyph, type HomeFilter } from "./homeModel";
import "./HomeView.css";

/** Host colours are free hex values; a translucent tint of one makes the tile. */
function tint(color: string): string {
  return `color-mix(in srgb, ${color} 18%, transparent)`;
}

export function HomeView() {
  const { hosts, groups, paneMeta, openTerminal, setContextHostId, setActiveView, loadAll } = useAppStore();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<HomeFilter>("all");
  const [error, setError] = useState<string | null>(null);
  const [hostDialog, setHostDialog] = useState<{ host: HostRecord | null; groupId: string | null } | null>(null);
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const { menu, open: openMenu, close: closeMenu } = useContextMenu();

  // Live sessions per host — the only status Wharf actually knows, so it's the only one shown.
  const sessions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of Object.values(paneMeta)) {
      if (m.hostId && !m.closed) counts.set(m.hostId, (counts.get(m.hostId) ?? 0) + 1);
    }
    return counts;
  }, [paneMeta]);
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
        className={`host-card ${live ? "live" : ""}`}
        role="button"
        tabIndex={0}
        onClick={() => void connect(host)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void connect(host);
        }}
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
        <div className="host-card-top">
          <span className="host-card-tile" style={{ background: tint(color), color }}>
            {hostGlyph(host.name)}
          </span>
          <span className="host-card-id">
            <span className="host-card-name">{host.name}</span>
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
          {(host.tags ?? []).map((t) => (
            <span key={t} className="host-card-tag">
              {t}
            </span>
          ))}
        </div>
        <div className="host-card-actions" onClick={(e) => e.stopPropagation()}>
          <button className="primary" title="Open terminal" onClick={() => void connect(host)}>
            <IconTerminal size={15} />
          </button>
          <button title="Browse files" onClick={() => openFiles(host)}>
            <IconFolder size={15} />
          </button>
          <button title="Edit host" onClick={() => setHostDialog({ host, groupId: host.groupId })}>
            <IconPencil size={15} />
          </button>
        </div>
      </div>
    );
  }

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
            {chips.map((c) => (
              <button key={c.id} className={`home-chip ${activeFilter === c.id ? "active" : ""}`} onClick={() => setFilter(c.id)}>
                {c.label}
              </button>
            ))}
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
            <section key={sec.id} className="home-section">
              <h3>
                {sec.title}
                <span className="home-section-count">{sec.hosts.length}</span>
              </h3>
              <div className="home-grid">{sec.hosts.map(card)}</div>
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
