/**
 * Types shared between the Electron main process and the renderer.
 * Keep this file free of Node/DOM-only APIs so it can be imported from either side.
 */

// ---------------------------------------------------------------------------
// Hosts & groups
// ---------------------------------------------------------------------------

export type AuthMethod = "password" | "privateKey" | "agent";

export interface HostRecord {
  id: string;
  name: string;
  hostname: string;
  port: number;
  username: string;
  groupId: string | null;
  authMethod: AuthMethod;
  /** Id of the encrypted secret (password or private key passphrase) held in the OS-backed secret store. Never sent in plaintext to the renderer. */
  secretId: string | null;
  /** Path to a private key file on disk, only used when authMethod === "privateKey". */
  privateKeyPath?: string;
  color?: string;
  tags?: string[];
  /** Connect through another saved host as an SSH jump/bastion host. */
  jumpHostId?: string | null;
  createdAt: number;
  updatedAt: number;
}

/** Shape used when creating/editing a host from the UI; secret is plaintext here and only lives in memory + IPC in transit. */
export interface HostInput {
  name: string;
  hostname: string;
  port: number;
  username: string;
  groupId: string | null;
  authMethod: AuthMethod;
  secret?: string; // password, or private key passphrase
  privateKeyPath?: string;
  color?: string;
  tags?: string[];
  jumpHostId?: string | null;
}

export interface GroupRecord {
  id: string;
  name: string;
  parentId: string | null;
  color?: string;
  createdAt: number;
  updatedAt: number;
}

export interface GroupInput {
  name: string;
  parentId: string | null;
  color?: string;
}

/** Result of a successful backup:import; null return from the IPC call means the user canceled the file picker. */
export interface BackupImportResult {
  importedGroups: number;
  importedHosts: number;
}

// ---------------------------------------------------------------------------
// Snippets
// ---------------------------------------------------------------------------

export interface SnippetRecord {
  id: string;
  name: string;
  command: string;
  createdAt: number;
  updatedAt: number;
}

export interface SnippetInput {
  name: string;
  command: string;
}

// ---------------------------------------------------------------------------
// Command history / audit log
// ---------------------------------------------------------------------------

/** One command typed into a terminal session, for the history/audit panel.
 * Reconstructed client-side from raw keystrokes sent over the pty (see
 * Terminal.tsx) by buffering until Enter — best-effort, not a perfect
 * transcript: shell line-editing like arrow-key history recall, tab
 * completion, or a pasted multi-line block won't reproduce exactly what
 * the shell itself saw. Good enough for "what did I run, and where". */
export interface CommandHistoryEntry {
  id: string;
  sessionId: string;
  /** null for a local shell session — it isn't connected to any saved host. */
  hostId: string | null;
  hostName: string;
  command: string;
  timestamp: number;
}

export type CommandHistoryInput = Omit<CommandHistoryEntry, "id" | "timestamp">;

// ---------------------------------------------------------------------------
// AI autocomplete
// ---------------------------------------------------------------------------

/** Sent to Claude for one autocomplete request — the current unsent line
 * plus enough context (recent commands, host, platform) for the suggestion
 * to be grounded in what the user's actually doing, not a generic guess. */
export interface AiSuggestRequest {
  currentLine: string;
  /** Most-recent-last, capped client-side before sending. */
  recentCommands: string[];
  hostName: string;
  /** "darwin" | "win32" | "linux" | ... — from window.wharf.window.platform. */
  platform: string;
}

// ---------------------------------------------------------------------------
// SSH sessions / terminal
// ---------------------------------------------------------------------------

export interface SessionStartResult {
  sessionId: string;
}

export interface TerminalDataEvent {
  sessionId: string;
  chunk: string;
}

export interface SessionClosedEvent {
  sessionId: string;
  reason?: string;
  error?: string;
}

/** Fired when a session drops unexpectedly (not an explicit user
 * disconnect) and an automatic reconnect attempt is about to run. */
export interface SessionReconnectingEvent {
  sessionId: string;
  attempt: number;
  maxAttempts: number;
  delayMs: number;
}

export interface SessionReconnectedEvent {
  sessionId: string;
}

// ---------------------------------------------------------------------------
// SSH config import (~/.ssh/config)
// ---------------------------------------------------------------------------

/** One concrete (non-wildcard) `Host` block parsed out of an OpenSSH config
 * file, ready to review and optionally import as a saved host. */
export interface SshConfigCandidate {
  /** The `Host` alias itself — used as the imported host's name. */
  alias: string;
  hostname: string;
  port: number;
  username?: string;
  /** Path to a private key file (from `IdentityFile`), `~` already expanded. */
  identityFile?: string;
  /** Raw `ProxyJump` alias, unresolved — the importer links it to another
   * selected candidate by alias if (and only if) both are imported together. */
  proxyJump?: string;
  /** True if a host with the same hostname/username/port already exists in
   * Wharf, so the picker can default it to unchecked. */
  alreadyImported: boolean;
}

export interface SshConfigImportResult {
  importedHosts: number;
}

// ---------------------------------------------------------------------------
// SFTP
// ---------------------------------------------------------------------------

export type SftpEntryType = "file" | "directory" | "symlink" | "other";

/** Also reused as-is for local filesystem listings (the `localFs` API) —
 * the shapes are identical, so the dual-pane SFTP browser can share one
 * row-rendering component between its local and remote sides. */
export interface SftpEntry {
  name: string;
  path: string;
  type: SftpEntryType;
  size: number;
  modifiedAt: number;
  permissions: string;
}

export interface SftpTransferProgress {
  transferId: string;
  hostId: string;
  direction: "upload" | "download";
  fileName: string;
  bytesTransferred: number;
  totalBytes: number;
  done: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Port forwarding tunnels
// ---------------------------------------------------------------------------

export type TunnelType = "local" | "remote" | "dynamic";

export interface TunnelRecord {
  id: string;
  hostId: string;
  name: string;
  type: TunnelType;
  srcHost: string;
  srcPort: number;
  /** Not used for "dynamic" (SOCKS) tunnels. */
  dstHost?: string;
  dstPort?: number;
  autoStart?: boolean;
}

export interface TunnelInput {
  hostId: string;
  name: string;
  type: TunnelType;
  srcHost: string;
  srcPort: number;
  dstHost?: string;
  dstPort?: number;
  autoStart?: boolean;
}

export type TunnelStatus = "stopped" | "starting" | "running" | "error";

export interface TunnelStateEvent {
  tunnelId: string;
  status: TunnelStatus;
  error?: string;
}

// ---------------------------------------------------------------------------
// IPC channel names
// ---------------------------------------------------------------------------

export const IPC = {
  hosts: {
    list: "hosts:list",
    create: "hosts:create",
    update: "hosts:update",
    remove: "hosts:remove",
  },
  groups: {
    list: "groups:list",
    create: "groups:create",
    update: "groups:update",
    remove: "groups:remove",
  },
  ssh: {
    connect: "ssh:connect",
    write: "ssh:write",
    resize: "ssh:resize",
    disconnect: "ssh:disconnect",
    onData: "ssh:data",
    onClosed: "ssh:closed",
    onReconnecting: "ssh:reconnecting",
    onReconnected: "ssh:reconnected",
    startLogging: "ssh:log-start",
    stopLogging: "ssh:log-stop",
  },
  localShell: {
    connect: "local-shell:connect",
  },
  sshConfig: {
    parse: "ssh-config:parse",
    import: "ssh-config:import",
  },
  sftp: {
    list: "sftp:list",
    mkdir: "sftp:mkdir",
    rmdir: "sftp:rmdir",
    unlink: "sftp:unlink",
    rename: "sftp:rename",
    upload: "sftp:upload",
    uploadPath: "sftp:upload-path",
    download: "sftp:download",
    downloadToPath: "sftp:download-to-path",
    onProgress: "sftp:progress",
    search: "sftp:search",
    readFile: "sftp:read-file",
    writeFile: "sftp:write-file",
  },
  localFs: {
    list: "localfs:list",
    mkdir: "localfs:mkdir",
    rmdir: "localfs:rmdir",
    unlink: "localfs:unlink",
    rename: "localfs:rename",
    homeDir: "localfs:home-dir",
  },
  tunnels: {
    list: "tunnels:list",
    create: "tunnels:create",
    remove: "tunnels:remove",
    start: "tunnels:start",
    stop: "tunnels:stop",
    onState: "tunnels:state",
  },
  window: {
    minimize: "window:minimize",
    toggleMaximize: "window:toggle-maximize",
    close: "window:close",
    isMaximized: "window:is-maximized",
    newWindow: "window:new",
    onMaximizedChange: "window:maximized-changed",
  },
  clipboard: {
    writeText: "clipboard:write-text",
    readText: "clipboard:read-text",
  },
  backup: {
    export: "backup:export",
    import: "backup:import",
  },
  snippets: {
    list: "snippets:list",
    create: "snippets:create",
    update: "snippets:update",
    remove: "snippets:remove",
  },
  commandHistory: {
    add: "command-history:add",
    list: "command-history:list",
    clear: "command-history:clear",
  },
  ai: {
    suggest: "ai:suggest",
    hasApiKey: "ai:has-api-key",
    setApiKey: "ai:set-api-key",
    clearApiKey: "ai:clear-api-key",
  },
} as const;
