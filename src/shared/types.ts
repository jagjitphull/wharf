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
  /** Pro feature: connect through another saved host as an SSH jump/bastion host. */
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

// ---------------------------------------------------------------------------
// SFTP
// ---------------------------------------------------------------------------

export type SftpEntryType = "file" | "directory" | "symlink" | "other";

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
// Port forwarding tunnels (Pro feature)
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
// Licensing
// ---------------------------------------------------------------------------

export type LicensePlan = "free" | "pro";

/** The signed payload embedded in a license key. */
export interface LicensePayload {
  licenseId: string;
  email: string;
  plan: LicensePlan;
  seats: number;
  /** Unix ms. null means perpetual / no expiry. */
  issuedAt: number;
  expiresAt: number | null;
  /** Explicit feature grants, in case a plan is later split into add-ons. */
  features: FeatureId[];
}

/** A license key as distributed to users: base64url(payload json) + "." + base64url(signature). */
export type LicenseKey = string;

export type LicenseValidity = "unactivated" | "valid" | "expired" | "invalid" | "revoked";

export interface LicenseState {
  validity: LicenseValidity;
  plan: LicensePlan;
  licenseKey: LicenseKey | null;
  payload: LicensePayload | null;
  activatedAt: number | null;
}

// ---------------------------------------------------------------------------
// Feature flags
// ---------------------------------------------------------------------------

export type FeatureId =
  | "unlimitedHosts"
  | "unlimitedGroups"
  | "portForwarding"
  | "jumpHosts"
  | "teamSync";

export const FREE_TIER_LIMITS = {
  maxHosts: 5,
  maxGroups: 2,
} as const;

export const PRO_FEATURES: readonly FeatureId[] = [
  "unlimitedHosts",
  "unlimitedGroups",
  "portForwarding",
  "jumpHosts",
  "teamSync",
];

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
  },
  sftp: {
    list: "sftp:list",
    mkdir: "sftp:mkdir",
    rmdir: "sftp:rmdir",
    unlink: "sftp:unlink",
    rename: "sftp:rename",
    upload: "sftp:upload",
    download: "sftp:download",
    onProgress: "sftp:progress",
  },
  tunnels: {
    list: "tunnels:list",
    create: "tunnels:create",
    remove: "tunnels:remove",
    start: "tunnels:start",
    stop: "tunnels:stop",
    onState: "tunnels:state",
  },
  license: {
    getState: "license:getState",
    activate: "license:activate",
    deactivate: "license:deactivate",
  },
} as const;
