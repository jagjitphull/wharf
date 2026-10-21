/**
 * Shape of the `window.wharf` bridge exposed by preload.ts via
 * contextBridge. Shared (type-only usage) so the renderer and preload
 * agree on the contract without the renderer importing any Node APIs.
 */
import type {
  BackupImportResult,
  GroupInput,
  GroupRecord,
  HostInput,
  HostRecord,
  SessionClosedEvent,
  SessionReconnectedEvent,
  SessionReconnectingEvent,
  SessionStartResult,
  SftpEntry,
  SftpTransferProgress,
  SnippetInput,
  SnippetRecord,
  WorkspaceInput,
  WorkspaceRecord,
  WorkspaceTab,
  HostStatsUpdateEvent,
  CommandHistoryEntry,
  CommandHistoryInput,
  HistorySettings,
  AiSuggestRequest,
  AiProvider,
  AiProviderConfig,
  AiExplainFailureRequest,
  AiExplainFailureResult,
  SecretStorageStatus,
  SelfUpdateState,
  UpdateCheckResult,
  AiGenerateCommandRequest,
  SshConfigCandidate,
  SshConfigImportResult,
  TerminalDataEvent,
  TunnelInput,
  TunnelRecord,
  TunnelStateEvent,
} from "./types";

export type Unsubscribe = () => void;

export interface WharfApi {
  hosts: {
    list(): Promise<HostRecord[]>;
    create(input: HostInput): Promise<HostRecord>;
    update(id: string, input: HostInput): Promise<HostRecord>;
    remove(id: string): Promise<void>;
    /** Raw TCP reachability probe against hostname:port — no SSH handshake, no auth, no host-key check. */
    checkReachable(hostname: string, port: number): Promise<boolean>;
  };
  groups: {
    list(): Promise<GroupRecord[]>;
    create(input: GroupInput): Promise<GroupRecord>;
    update(id: string, input: GroupInput): Promise<GroupRecord>;
    remove(id: string): Promise<void>;
  };
  ssh: {
    connect(hostId: string, cols: number, rows: number): Promise<SessionStartResult>;
    write(sessionId: string, data: string): void;
    resize(sessionId: string, cols: number, rows: number): void;
    disconnect(sessionId: string): Promise<void>;
    onData(cb: (event: TerminalDataEvent) => void): Unsubscribe;
    onClosed(cb: (event: SessionClosedEvent) => void): Unsubscribe;
    /** Fired when a session drops unexpectedly and an automatic reconnect attempt is about to run. */
    onReconnecting(cb: (event: SessionReconnectingEvent) => void): Unsubscribe;
    onReconnected(cb: (event: SessionReconnectedEvent) => void): Unsubscribe;
    /** Opens a save dialog and tees the session's raw output to that file from here on. Returns the chosen path, or null if canceled. */
    startLogging(sessionId: string): Promise<string | null>;
    stopLogging(sessionId: string): Promise<void>;
  };
  localShell: {
    /** Opens a real local shell (the user's default shell, via a pty) as its own tab — no host involved. write/resize/disconnect/logging/onData/onClosed are the same ssh.* calls, keyed by the returned sessionId. */
    connect(cols: number, rows: number): Promise<SessionStartResult>;
  };
  sshConfig: {
    /** Parses `~/.ssh/config` (including simple `Include` directives). Returns [] if the file doesn't exist. */
    parse(): Promise<SshConfigCandidate[]>;
    /** Creates saved hosts from the given aliases (re-parses the file fresh). ProxyJump links only apply between aliases imported in the same call. */
    import(aliases: string[]): Promise<SshConfigImportResult>;
  };
  sftp: {
    list(hostId: string, remotePath: string): Promise<SftpEntry[]>;
    mkdir(hostId: string, remotePath: string): Promise<void>;
    rmdir(hostId: string, remotePath: string): Promise<void>;
    unlink(hostId: string, remotePath: string): Promise<void>;
    rename(hostId: string, oldPath: string, newPath: string): Promise<void>;
    upload(hostId: string, remoteDir: string): Promise<string | null>;
    /** Uploads a file already on disk (e.g. from an OS drag-and-drop drop event) without showing a picker. */
    uploadPath(hostId: string, localPath: string, remoteDir: string): Promise<string>;
    download(hostId: string, remotePath: string): Promise<string | null>;
    /** Downloads straight into `localDir` (basename kept, no picker) — used by the dual-pane browser to transfer directly between panes. */
    downloadToPath(hostId: string, remotePath: string, localDir: string): Promise<string>;
    /** Transfers a file directly between two remote hosts (server-to-server) — streamed through the main process without ever touching local disk. Used by the dual-pane browser when both panes are remote. */
    transferBetweenHosts(sourceHostId: string, sourcePath: string, destHostId: string, destDir: string): Promise<string>;
    onProgress(cb: (event: SftpTransferProgress) => void): Unsubscribe;
    /** Recursively searches under `rootPath` for entries whose name contains `query` (case-insensitive), capped to a bounded scan. */
    search(hostId: string, rootPath: string, query: string): Promise<SftpEntry[]>;
    /** Reads a remote file's contents as UTF-8 text, for the built-in editor. Throws if the file is over ~2 MB — too large to edit here. */
    readFile(hostId: string, remotePath: string): Promise<string>;
    /** Overwrites a remote file with UTF-8 `content`, for the built-in editor's Save. */
    writeFile(hostId: string, remotePath: string, content: string): Promise<void>;
  };
  localFs: {
    list(dirPath: string): Promise<SftpEntry[]>;
    mkdir(dirPath: string): Promise<void>;
    rmdir(dirPath: string): Promise<void>;
    unlink(filePath: string): Promise<void>;
    rename(oldPath: string, newPath: string): Promise<void>;
    /** The user's home directory — the local pane's starting path. */
    homeDir(): Promise<string>;
  };
  tunnels: {
    list(): Promise<TunnelRecord[]>;
    create(input: TunnelInput): Promise<TunnelRecord>;
    remove(tunnelId: string): Promise<void>;
    start(tunnelId: string): Promise<void>;
    stop(tunnelId: string): Promise<void>;
    /** Turns "start when Wharf launches" on or off for a saved tunnel. */
    setAutoStart(tunnelId: string, enabled: boolean): Promise<void>;
    /** The latest known state of every tunnel that has started, stopped or failed since launch — so a panel opened later (or after an automatic start) doesn't have to wait for the next change event. */
    statuses(): Promise<TunnelStateEvent[]>;
    onState(cb: (event: TunnelStateEvent) => void): Unsubscribe;
  };
  window: {
    /** "darwin" | "win32" | "linux" | ... — process.platform, read at preload time. */
    platform: string;
    minimize(): void;
    toggleMaximize(): void;
    close(): void;
    isMaximized(): Promise<boolean>;
    newWindow(): void;
    onMaximizedChange(cb: (maximized: boolean) => void): Unsubscribe;
    /** Main-process-initiated reload — see the IPC channel's own doc comment. */
    reload(): void;
    /** Sets the page's zoom (the "Interface size" setting). Applied at launch by the preload itself from the stored value. */
    setZoomFactor(zoom: number): void;
  };
  clipboard: {
    writeText(text: string): void;
    readText(): Promise<string>;
  };
  shell: {
    openExternal(url: string): Promise<void>;
    /** Opens the OS file manager on the folder holding Wharf's persistent
     * log file (electron-log's default location) — so a user hitting a
     * crash or bug has a discoverable way to find and share it. */
    openLogsFolder(): Promise<void>;
  };
  secrets: {
    /** Whether saved passwords and key passphrases are encrypted with the OS keyring, or (on a machine without one) only base64-encoded. */
    status(): Promise<SecretStorageStatus>;
    /** Protects every saved secret with a master password (at least 8 characters) and leaves Wharf unlocked for this run. */
    setMasterPassword(password: string): Promise<void>;
    changeMasterPassword(current: string, next: string): Promise<void>;
    /** Turns the master password off; secrets go back to the system keyring. */
    removeMasterPassword(password: string): Promise<void>;
    /** Throws "Wrong master password." if it doesn't match. Starts any tunnels set to start at launch. */
    unlock(password: string): Promise<void>;
    lock(): Promise<void>;
    /** Minutes without activity before an unlocked master password locks itself (0 = never). */
    getAutoLock(): Promise<number>;
    setAutoLock(minutes: number): Promise<number>;
    /** Tells the main process the user is active, so auto-lock doesn't fire under them. Cheap; callers throttle. */
    reportActivity(): void;
    /** Fires when the master password locks, whether by auto-lock or "Lock now", so the lock screen can appear. */
    onLocked(cb: () => void): () => void;
    /** Fires when the master password is unlocked, from any window. */
    onUnlocked(cb: () => void): () => void;
    /** Forgotten password: erases every saved secret and the master password. */
    reset(): Promise<void>;
  };
  update: {
    /** Asks GitHub whether a newer release exists. Never rejects — failures come back in `error`. */
    check(): Promise<UpdateCheckResult>;
    getVersion(): Promise<string>;
    /** The newer release found by the launch-time check, if it found one. */
    getAvailable(): Promise<UpdateCheckResult | null>;
    getAutoCheck(): Promise<boolean>;
    setAutoCheck(enabled: boolean): Promise<void>;
    /** Fires when the launch-time check finds a newer release. */
    onAvailable(cb: (result: UpdateCheckResult) => void): Unsubscribe;
    /** Whether this install can replace itself (an installed AppImage). Other builds only get a link to the download page. */
    canSelfUpdate(): Promise<boolean>;
    selfUpdateState(): Promise<SelfUpdateState>;
    /** Checks for and downloads the newer version; progress arrives through onSelfUpdateState. Never rejects. */
    downloadUpdate(): Promise<void>;
    /** Restarts into the downloaded version. Rejects if nothing has been downloaded. */
    installUpdate(): Promise<void>;
    onSelfUpdateState(cb: (state: SelfUpdateState) => void): Unsubscribe;
  };
  backup: {
    /** Opens a save dialog and writes hosts+groups (no secrets) to JSON. Returns the written path, or null if the user canceled. */
    export(): Promise<string | null>;
    /** Opens an open dialog, validates and merges a previously exported file. Returns null if the user canceled; throws on an invalid file. */
    import(): Promise<BackupImportResult | null>;
  };
  snippets: {
    list(): Promise<SnippetRecord[]>;
    create(input: SnippetInput): Promise<SnippetRecord>;
    update(id: string, input: SnippetInput): Promise<SnippetRecord>;
    remove(id: string): Promise<void>;
  };
  workspaces: {
    list(): Promise<WorkspaceRecord[]>;
    create(input: WorkspaceInput): Promise<WorkspaceRecord>;
    remove(id: string): Promise<void>;
  };
  session: {
    getLast(): Promise<WorkspaceTab[]>;
    saveLast(tabs: WorkspaceTab[]): Promise<void>;
    /** Main is holding this window's close open waiting on a final persist —
     * call persistLastSession (or equivalent), await saveLast, then flushed(). */
    onFlushRequest(cb: () => void): () => void;
    flushed(): void;
  };
  hostStats: {
    start(sessionId: string): void;
    stop(sessionId: string): void;
    onUpdate(cb: (event: HostStatsUpdateEvent) => void): () => void;
  };
  commandHistory: {
    /** Offers one typed command for recording. Best-effort — see CommandHistoryEntry's doc comment.
     * Resolves to whether it was stored (not when history is off, or the command is filtered out).
     * `hidden` is for a line the user typed with a leading space: nothing is stored, and the
     * shell's report of the same command (see shellText) is dropped too. */
    add(input: CommandHistoryInput & { hidden?: boolean }): Promise<boolean>;
    list(): Promise<CommandHistoryEntry[]>;
    clear(): Promise<void>;
    /** The shell's own text for the command it is about to run (OSC 133;C — see commandCapture.ts's
     * doc comment): replaces the keystroke guess given to `add`, or is recorded on its own when
     * there was no guess. */
    shellText(input: Pick<CommandHistoryInput, "sessionId" | "hostId" | "hostName">, command: string): Promise<void>;
    getSettings(): Promise<HistorySettings>;
    setSettings(settings: HistorySettings): Promise<HistorySettings>;
  };
  ai: {
    /** Asks the active provider for up to 3 likely completions of the current line. Throws if that provider isn't configured. */
    suggest(request: AiSuggestRequest): Promise<string[]>;
    getProvider(): Promise<AiProvider>;
    setProvider(provider: AiProvider): Promise<void>;
    /** Not meaningful for "ollama" (no key) — always resolves true there. */
    hasApiKey(provider: AiProvider): Promise<boolean>;
    setApiKey(provider: AiProvider, key: string): Promise<void>;
    clearApiKey(provider: AiProvider): Promise<void>;
    getProviderConfig(provider: AiProvider): Promise<AiProviderConfig>;
    setProviderConfig(provider: AiProvider, config: AiProviderConfig): Promise<void>;
    /** Asks the active provider why a command failed, and for a corrected command if it has one. */
    explainFailure(request: AiExplainFailureRequest): Promise<AiExplainFailureResult>;
    /** Asks the active provider to turn a plain-English description into one real shell command. */
    generateCommand(request: AiGenerateCommandRequest): Promise<string>;
  };
  commandBlocks: {
    getEnabled(): Promise<boolean>;
    setEnabled(enabled: boolean): Promise<void>;
  };
  webUtils: {
    /** Replacement for the removed `File.path` (Electron 32+) — pass a File
     * object straight from a drop event's `dataTransfer.files`. */
    getPathForFile(file: File): string;
  };
}
