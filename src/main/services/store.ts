import Store from "electron-store";
import type {
  AiProvider,
  AiProviderConfig,
  CommandHistoryEntry,
  GroupRecord,
  HostRecord,
  SnippetRecord,
  TunnelRecord,
} from "../../shared/types";

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Schema {
  hosts: HostRecord[];
  groups: GroupRecord[];
  tunnels: TunnelRecord[];
  snippets: SnippetRecord[];
  commandHistory: CommandHistoryEntry[];
  /** secretId -> base64-encoded ciphertext produced by Electron's safeStorage. */
  secrets: Record<string, string>;
  /** Which AI autocomplete backend is active. */
  aiProvider: AiProvider;
  /** Per-cloud-provider API key id in `secrets` (same encrypted-at-rest storage as host passwords) — Ollama has no key, so it never appears here. */
  aiApiKeySecretIds: Partial<Record<Exclude<AiProvider, "ollama">, string>>;
  /** Per-provider settings beyond the key: an optional model override for the cloud providers, and Ollama's base URL + model. */
  aiProviderConfig: Partial<Record<AiProvider, AiProviderConfig>>;
  windowBounds: WindowBounds | null;
}

const defaults: Schema = {
  hosts: [],
  groups: [],
  tunnels: [],
  snippets: [],
  commandHistory: [],
  secrets: {},
  aiProvider: "claude",
  aiApiKeySecretIds: {},
  aiProviderConfig: {},
  windowBounds: null,
};

/**
 * Single persisted JSON store (via electron-store, which writes to the OS
 * user-data directory) for everything that isn't a raw secret. Deliberately
 * avoids a native-module database (e.g. sqlite) to keep the starter easy to
 * build/package across platforms; swap for a real DB if data volume grows.
 */
export const store = new Store<Schema>({
  name: "wharf-data",
  defaults,
});

// One-time migration from the pre-multi-provider single Claude key field
// (`aiApiKeySecretId`, now removed from Schema) into the new per-provider
// map, so upgrading doesn't silently drop an already-configured Claude key.
// Reads/writes the legacy field via an untyped cast since it no longer
// exists on Schema; safe because electron-store's underlying store is just
// a plain JSON file, and `store.delete` on a since-removed key is a no-op
// if it's already gone (e.g. on every later launch, once migrated).
{
  const legacy = (store as unknown as { get(key: string): unknown }).get("aiApiKeySecretId") as string | null | undefined;
  if (legacy) {
    const ids = store.get("aiApiKeySecretIds");
    if (!ids.claude) store.set("aiApiKeySecretIds", { ...ids, claude: legacy });
  }
  (store as unknown as { delete(key: string): void }).delete("aiApiKeySecretId");
}

export function getHosts(): HostRecord[] {
  return store.get("hosts");
}

export function setHosts(hosts: HostRecord[]): void {
  store.set("hosts", hosts);
}

export function getGroups(): GroupRecord[] {
  return store.get("groups");
}

export function setGroups(groups: GroupRecord[]): void {
  store.set("groups", groups);
}

export function getTunnels(): TunnelRecord[] {
  return store.get("tunnels");
}

export function setTunnels(tunnels: TunnelRecord[]): void {
  store.set("tunnels", tunnels);
}

export function getSnippets(): SnippetRecord[] {
  return store.get("snippets");
}

export function setSnippets(snippets: SnippetRecord[]): void {
  store.set("snippets", snippets);
}

// Caps the persisted log so a long-lived install doesn't grow this file
// unboundedly — oldest entries are dropped first (FIFO) once past the cap.
const COMMAND_HISTORY_MAX = 2000;

export function getCommandHistory(): CommandHistoryEntry[] {
  return store.get("commandHistory");
}

export function addCommandHistoryEntry(entry: CommandHistoryEntry): void {
  const next = [...store.get("commandHistory"), entry];
  if (next.length > COMMAND_HISTORY_MAX) next.splice(0, next.length - COMMAND_HISTORY_MAX);
  store.set("commandHistory", next);
}

export function clearCommandHistory(): void {
  store.set("commandHistory", []);
}

export function getAiProvider(): AiProvider {
  return store.get("aiProvider");
}

export function setAiProvider(provider: AiProvider): void {
  store.set("aiProvider", provider);
}

export function getAiApiKeySecretId(provider: Exclude<AiProvider, "ollama">): string | null {
  return store.get("aiApiKeySecretIds")[provider] ?? null;
}

export function setAiApiKeySecretId(provider: Exclude<AiProvider, "ollama">, secretId: string | null): void {
  const ids = { ...store.get("aiApiKeySecretIds") };
  if (secretId) ids[provider] = secretId;
  else delete ids[provider];
  store.set("aiApiKeySecretIds", ids);
}

export function getAiProviderConfig(provider: AiProvider): AiProviderConfig {
  return store.get("aiProviderConfig")[provider] ?? {};
}

export function setAiProviderConfig(provider: AiProvider, config: AiProviderConfig): void {
  store.set("aiProviderConfig", { ...store.get("aiProviderConfig"), [provider]: config });
}

export function getWindowBounds(): WindowBounds | null {
  return store.get("windowBounds");
}

export function setWindowBounds(bounds: WindowBounds): void {
  store.set("windowBounds", bounds);
}
