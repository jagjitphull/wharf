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
  SessionStartResult,
  SftpEntry,
  SftpTransferProgress,
  SnippetInput,
  SnippetRecord,
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
    /** Opens a save dialog and tees the session's raw output to that file from here on. Returns the chosen path, or null if canceled. */
    startLogging(sessionId: string): Promise<string | null>;
    stopLogging(sessionId: string): Promise<void>;
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
    onProgress(cb: (event: SftpTransferProgress) => void): Unsubscribe;
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
}
