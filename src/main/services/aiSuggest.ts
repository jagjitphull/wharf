import type {
  AiExplainFailureRequest,
  AiExplainFailureResult,
  AiGenerateCommandRequest,
  AiProvider,
  AiProviderConfig,
  AiSuggestRequest,
} from "../../shared/types";
import { deleteSecret, readSecret, saveSecret, updateSecret } from "./secretStore";
import {
  getAiApiKeySecretId,
  getAiProvider,
  getAiProviderConfig,
  setAiApiKeySecretId,
  setAiProvider,
  setAiProviderConfig,
} from "./store";
import type { AiProviderAdapter } from "./aiProviders/types";

/**
 * AI-powered terminal autocomplete: given the command the user is currently
 * typing plus recent command history, asks the active provider for up to 3
 * likely full commands to complete it into. Cloud provider API keys live in
 * the same encrypted-at-rest secret store used for host passwords/
 * passphrases — never in localStorage, never sent anywhere but directly to
 * that provider's own API from this process. Ollama is local and needs no
 * key at all.
 */

const CLOUD_PROVIDERS: Exclude<AiProvider, "ollama">[] = ["claude", "openai", "gemini"];

// Each cloud provider's adapter module pulls in that provider's own SDK
// (@anthropic-ai/sdk, openai, @google/genai — the latter also drags in
// rxjs) — heavy, and a given install only ever uses the one provider
// actually configured in Settings. A static import of every adapter would
// load all three SDKs at app startup regardless of which one (if any) is
// in use. Importing dynamically, only for the provider actually being
// called, means the other two never get loaded at all — and caching the
// resolved adapter means that cost is paid at most once per provider per
// run, not on every suggest() call (autocomplete fires on every keystroke).
const adapterCache = new Map<AiProvider, AiProviderAdapter>();

async function loadAdapter(provider: AiProvider): Promise<AiProviderAdapter> {
  const cached = adapterCache.get(provider);
  if (cached) return cached;

  let adapter: AiProviderAdapter;
  switch (provider) {
    case "claude":
      adapter = (await import("./aiProviders/claude")).default;
      break;
    case "openai":
      adapter = (await import("./aiProviders/openai")).default;
      break;
    case "gemini":
      adapter = (await import("./aiProviders/gemini")).default;
      break;
    case "ollama":
      adapter = (await import("./aiProviders/ollama")).default;
      break;
  }
  adapterCache.set(provider, adapter);
  return adapter;
}

function isCloudProvider(provider: AiProvider): provider is Exclude<AiProvider, "ollama"> {
  return (CLOUD_PROVIDERS as AiProvider[]).includes(provider);
}

export function getProvider(): AiProvider {
  return getAiProvider();
}

export function setProvider(provider: AiProvider): void {
  setAiProvider(provider);
}

/** Always true for "ollama" — it has no key, so "configured" isn't a meaningful question; the renderer doesn't show a key field for it in the first place. */
export function hasApiKey(provider: AiProvider): boolean {
  if (!isCloudProvider(provider)) return true;
  return readSecret(getAiApiKeySecretId(provider)) !== null;
}

export function setApiKey(provider: AiProvider, key: string): void {
  if (!isCloudProvider(provider)) return;
  const existing = getAiApiKeySecretId(provider);
  if (existing) updateSecret(existing, key);
  else setAiApiKeySecretId(provider, saveSecret(key));
}

export function clearApiKey(provider: AiProvider): void {
  if (!isCloudProvider(provider)) return;
  const existing = getAiApiKeySecretId(provider);
  if (!existing) return;
  deleteSecret(existing);
  setAiApiKeySecretId(provider, null);
}

export function getProviderConfig(provider: AiProvider): AiProviderConfig {
  return getAiProviderConfig(provider);
}

export function setProviderConfig(provider: AiProvider, config: AiProviderConfig): void {
  setAiProviderConfig(provider, config);
}

export async function suggest(request: AiSuggestRequest): Promise<string[]> {
  const provider = getAiProvider();
  const apiKey = isCloudProvider(provider) ? readSecret(getAiApiKeySecretId(provider)) : null;
  const config = getAiProviderConfig(provider);
  const adapter = await loadAdapter(provider);
  return adapter.suggest(apiKey, config, request);
}

export async function explainFailure(request: AiExplainFailureRequest): Promise<AiExplainFailureResult> {
  const provider = getAiProvider();
  const apiKey = isCloudProvider(provider) ? readSecret(getAiApiKeySecretId(provider)) : null;
  const config = getAiProviderConfig(provider);
  const adapter = await loadAdapter(provider);
  return adapter.explainFailure(apiKey, config, request);
}

export async function generateCommand(request: AiGenerateCommandRequest): Promise<string> {
  const provider = getAiProvider();
  const apiKey = isCloudProvider(provider) ? readSecret(getAiApiKeySecretId(provider)) : null;
  const config = getAiProviderConfig(provider);
  const adapter = await loadAdapter(provider);
  return adapter.generateCommand(apiKey, config, request);
}
