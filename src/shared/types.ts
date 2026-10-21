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
  /** Connect via Mosh (mobile shell) instead of a plain SSH session — see moshManager.ts. */
  mosh?: boolean;
  /** When a session to this host last connected (ms since the epoch); unset until it first does. */
  lastConnectedAt?: number;
  /** Kept at the top of Home as a favourite. */
  pinned?: boolean;
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
  mosh?: boolean;
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

export type { BackupImportResult, BackupPart, BackupPreview } from "./backupFormat";
export type { GenerateKeyRequest, InstallKeyResult, SshKeyInfo, SshKeyType } from "./sshKeys";

// ---------------------------------------------------------------------------
// Snippets
// ---------------------------------------------------------------------------

export interface SnippetRecord {
  id: string;
  name: string;
  command: string;
  /** Press Enter after inserting, so the command runs at once (default: it is only typed, for you to check and run). */
  run?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface SnippetInput {
  name: string;
  command: string;
  run?: boolean;
}

// ---------------------------------------------------------------------------
// Workspaces — a saved set of tabs (each possibly split into panes), each
// pane referencing a saved host (or null for a local shell) rather than a
// live session id, so it can be reopened fresh any time.
// ---------------------------------------------------------------------------

export type WorkspaceNode =
  | {
      type: "leaf";
      hostId: string | null;
      /** Serialized terminal content (ANSI-formatted, via xterm's
       * SerializeAddon) captured right before this pane last closed —
       * replayed into the fresh terminal on restore so a restart feels like
       * resuming, not a blank prompt. Only ever populated for the automatic
       * "last session" snapshot (see restoreLastSession in state/store.ts),
       * never for a named, explicitly-saved Workspace — reopening one of
       * those is meant to start clean every time, not replay however the
       * pane looked the one time it was saved. */
      scrollback?: string;
      /** When `scrollback` was captured (Date.now()) — shown in the restore
       * banner ("Previous session from ..."), same spirit as Warp's. */
      scrollbackCapturedAt?: number;
    }
  | { type: "split"; direction: "row" | "column"; children: WorkspaceNode[] };

export interface WorkspaceTab {
  layout: WorkspaceNode;
}

export interface WorkspaceRecord {
  id: string;
  name: string;
  tabs: WorkspaceTab[];
  createdAt: number;
}

export interface WorkspaceInput {
  name: string;
  tabs: WorkspaceTab[];
}

// ---------------------------------------------------------------------------
// Host stats — periodic, lightweight CPU/memory/disk readout for the
// currently-focused SSH pane, polled via `exec` on its already-open
// connection (never the interactive shell channel itself).
// ---------------------------------------------------------------------------

export interface HostStatsSnapshot {
  loadAvg: [number, number, number] | null;
  memTotalMb: number | null;
  memUsedMb: number | null;
  diskUsePercent: number | null;
}

export interface HostStatsUpdateEvent {
  sessionId: string;
  stats: HostStatsSnapshot | null;
  /** Set when the poll itself failed (e.g. session just closed) — stats is null in that case. */
  error?: string;
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

export type { HistorySettings } from "./historyFilter";
export type {
  TranscriptContent,
  TranscriptInfo,
  TranscriptLine,
  TranscriptMatch,
  TranscriptSearchResult,
  TranscriptSettings,
} from "./transcripts";

// ---------------------------------------------------------------------------
// AI autocomplete
// ---------------------------------------------------------------------------

/** Sent to the active AI provider for one autocomplete request — the current
 * unsent line plus enough context (recent commands, host, platform) for the
 * suggestion to be grounded in what the user's actually doing, not a generic
 * guess. */
export interface AiSuggestRequest {
  currentLine: string;
  /** Most-recent-last, capped client-side before sending. */
  recentCommands: string[];
  hostName: string;
  /** "darwin" | "win32" | "linux" | ... — from window.wharf.window.platform. */
  platform: string;
}

/** Which backend answers autocomplete requests. Claude/OpenAI/Gemini are
 * cloud providers authenticated with an API key (stored encrypted at rest,
 * same as host passwords); Ollama talks to a local server (no key, just a
 * base URL) — whatever model the user already has pulled there. */
export type AiProvider = "claude" | "openai" | "gemini" | "ollama";

/** Per-provider settings beyond the API key: an optional model override for
 * the cloud providers (each has a sensible built-in default), and the
 * base URL + required model name for Ollama (no universal default — depends
 * entirely on what the user has pulled locally). */
export interface AiProviderConfig {
  model?: string;
  baseUrl?: string;
}

/** Sent when the user asks the AI to explain why a command failed (and
 * suggest a fix) — from a Command Block whose real exit code (via shell
 * integration) was non-zero. */
export interface AiExplainFailureRequest {
  command: string;
  /** The block's captured output — capped client-side before sending, same spirit as recentCommands. */
  output: string;
  exitCode: number;
  hostName: string;
  platform: string;
}

export interface AiExplainFailureResult {
  explanation: string;
  /** A corrected command to offer as one-click "Insert fix", if the AI has one. */
  suggestedFix?: string;
}

/** Sent when the user describes what they want in plain English and asks
 * the AI to turn it into one real shell command. */
export interface AiGenerateCommandRequest {
  description: string;
  recentCommands: string[];
  hostName: string;
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
  /** Start this tunnel by itself each time Wharf launches. */
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

/** Where an in-place update (AppImage builds only) currently stands. */
export interface SelfUpdateState {
  phase: "idle" | "checking" | "downloading" | "ready" | "error";
  /** The version being downloaded, or waiting to be installed. */
  version?: string;
  /** 0-100, while downloading. */
  percent?: number;
  error?: string;
}

/** The optional master password: not set, set but not entered yet this run, or entered. */
export type MasterPasswordState = "none" | "locked" | "unlocked";

export interface SecretStorageStatus {
  /** True when saved passwords and key passphrases are encrypted: with the OS keyring, or with the master password. */
  encrypted: boolean;
  masterPassword: MasterPasswordState;
  /** True when this machine has an OS keyring, so removing the master password returns secrets to it rather than to base64. */
  keyringAvailable: boolean;
  /** How many saved secrets are currently stored only base64-encoded. */
  unencryptedCount: number;
}

/** "reconnecting": the SSH connection dropped and Wharf is retrying; `error` says why and when. */
export type TunnelStatus = "stopped" | "starting" | "running" | "reconnecting" | "error";

export interface TunnelStateEvent {
  tunnelId: string;
  status: TunnelStatus;
  error?: string;
}

// ---------------------------------------------------------------------------
// Update check
// ---------------------------------------------------------------------------

export interface UpdateCheckResult {
  currentVersion: string;
  /** null when the latest version couldn't be determined — see `error`. */
  latestVersion: string | null;
  updateAvailable: boolean;
  /** Page for the newer release (always on github.com); null when latestVersion is null. */
  releaseUrl: string | null;
  /** Why latestVersion is null (offline, no release published yet, rate limited, …). */
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
    checkReachable: "hosts:check-reachable",
    setPinned: "hosts:set-pinned",
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
    transferBetweenHosts: "sftp:transfer-between-hosts",
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
    setAutoStart: "tunnels:set-auto-start",
    statuses: "tunnels:statuses",
    onState: "tunnels:state",
  },
  window: {
    minimize: "window:minimize",
    toggleMaximize: "window:toggle-maximize",
    close: "window:close",
    isMaximized: "window:is-maximized",
    newWindow: "window:new",
    onMaximizedChange: "window:maximized-changed",
    /** Main-process-initiated reload, so a packaged build's will-navigate
     * guard (main/index.ts) doesn't block it the way it would an in-page
     * location.reload() — see ErrorBoundary's use of this. */
    reload: "window:reload",
  },
  clipboard: {
    writeText: "clipboard:write-text",
    readText: "clipboard:read-text",
  },
  shell: {
    openExternal: "shell:open-external",
    openLogsFolder: "shell:open-logs-folder",
  },
  secrets: {
    status: "secrets:status",
    setMasterPassword: "secrets:set-master-password",
    changeMasterPassword: "secrets:change-master-password",
    removeMasterPassword: "secrets:remove-master-password",
    unlock: "secrets:unlock",
    lock: "secrets:lock",
    getAutoLock: "secrets:get-auto-lock",
    setAutoLock: "secrets:set-auto-lock",
    /** Fire-and-forget from a window: the user did something (typed, clicked). */
    activity: "secrets:activity",
    /** Main -> windows: the master password just locked, show the lock screen. */
    onLocked: "secrets:on-locked",
    /** Main -> windows: it was unlocked (maybe from another window), so a lock screen still showing can go. */
    onUnlocked: "secrets:on-unlocked",
    reset: "secrets:reset",
  },
  update: {
    check: "update:check",
    getVersion: "update:get-version",
    getAvailable: "update:get-available",
    getAutoCheck: "update:get-auto-check",
    setAutoCheck: "update:set-auto-check",
    /** Main -> renderer: the launch-time check found a newer release. */
    onAvailable: "update:available",
    canSelfUpdate: "update:can-self-update",
    selfUpdateState: "update:self-update-state",
    downloadUpdate: "update:download",
    installUpdate: "update:install",
    /** Main -> renderer: the in-place update moved to a new phase, or made progress. */
    onSelfUpdateState: "update:self-update-state-changed",
  },
  backup: {
    export: "backup:export",
    pick: "backup:pick",
    apply: "backup:apply",
  },
  sshKeys: {
    list: "ssh-keys:list",
    generate: "ssh-keys:generate",
    publicKey: "ssh-keys:public-key",
    remove: "ssh-keys:remove",
    install: "ssh-keys:install",
  },
  snippets: {
    list: "snippets:list",
    create: "snippets:create",
    update: "snippets:update",
    remove: "snippets:remove",
  },
  workspaces: {
    list: "workspaces:list",
    create: "workspaces:create",
    remove: "workspaces:remove",
  },
  session: {
    getLast: "session:get-last",
    saveLast: "session:save-last",
    /** Main -> renderer: "this window is closing — persist right now and
     * ack" (see the window's "close" handler in main/index.ts). Not a
     * request/response IPC pair since the renderer's flush itself goes
     * through saveLast — this is just the "go" signal and its ack. */
    flushRequest: "session:flush-request",
    flushed: "session:flushed",
  },
  hostStats: {
    start: "host-stats:start",
    stop: "host-stats:stop",
    onUpdate: "host-stats:on-update",
  },
  commandHistory: {
    add: "command-history:add",
    list: "command-history:list",
    clear: "command-history:clear",
    shellText: "command-history:shell-text",
    getSettings: "command-history:get-settings",
    setSettings: "command-history:set-settings",
  },
  transcripts: {
    list: "transcripts:list",
    read: "transcripts:read",
    search: "transcripts:search",
    remove: "transcripts:remove",
    clear: "transcripts:clear",
    saveAs: "transcripts:save-as",
    getSettings: "transcripts:get-settings",
    setSettings: "transcripts:set-settings",
  },
  ai: {
    suggest: "ai:suggest",
    getProvider: "ai:get-provider",
    setProvider: "ai:set-provider",
    hasApiKey: "ai:has-api-key",
    setApiKey: "ai:set-api-key",
    clearApiKey: "ai:clear-api-key",
    getProviderConfig: "ai:get-provider-config",
    setProviderConfig: "ai:set-provider-config",
    explainFailure: "ai:explain-failure",
    generateCommand: "ai:generate-command",
  },
  commandBlocks: {
    getEnabled: "command-blocks:get-enabled",
    setEnabled: "command-blocks:set-enabled",
  },
} as const;
