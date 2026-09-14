/**
 * Shape of the `window.wharf` bridge exposed by preload.ts via
 * contextBridge. Shared (type-only usage) so the renderer and preload
 * agree on the contract without the renderer importing any Node APIs.
 */
import type {
  GroupInput,
  GroupRecord,
  HostInput,
  HostRecord,
  LicenseKey,
  LicenseState,
  SessionClosedEvent,
  SessionStartResult,
  SftpEntry,
  SftpTransferProgress,
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
  };
  sftp: {
    list(hostId: string, remotePath: string): Promise<SftpEntry[]>;
    mkdir(hostId: string, remotePath: string): Promise<void>;
    rmdir(hostId: string, remotePath: string): Promise<void>;
    unlink(hostId: string, remotePath: string): Promise<void>;
    rename(hostId: string, oldPath: string, newPath: string): Promise<void>;
    upload(hostId: string, remoteDir: string): Promise<string | null>;
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
  license: {
    getState(): Promise<LicenseState>;
    activate(licenseKey: LicenseKey): Promise<LicenseState>;
    deactivate(): Promise<LicenseState>;
  };
}
