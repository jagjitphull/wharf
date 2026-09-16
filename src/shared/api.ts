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
  CommandHistoryEntry,
  CommandHistoryInput,
  AiSuggestRequest,
  AiProvider,
  AiProviderConfig,
  AiExplainFailureRequest,
  AiExplainFailureResult,
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
  };
  clipboard: {
    writeText(text: string): void;
    readText(): Promise<string>;
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
  commandHistory: {
    /** Records one typed command. Best-effort — see CommandHistoryEntry's doc comment. */
    add(input: CommandHistoryInput): Promise<void>;
    list(): Promise<CommandHistoryEntry[]>;
    clear(): Promise<void>;
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
}
