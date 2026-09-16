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
import claudeAdapter from "./aiProviders/claude";
import openaiAdapter from "./aiProviders/openai";
import geminiAdapter from "./aiProviders/gemini";
import ollamaAdapter from "./aiProviders/ollama";
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

const ADAPTERS: Record<AiProvider, AiProviderAdapter> = {
  claude: claudeAdapter,
  openai: openaiAdapter,
  gemini: geminiAdapter,
  ollama: ollamaAdapter,
};

const CLOUD_PROVIDERS: Exclude<AiProvider, "ollama">[] = ["claude", "openai", "gemini"];

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
  return ADAPTERS[provider].suggest(apiKey, config, request);
}

export async function explainFailure(request: AiExplainFailureRequest): Promise<AiExplainFailureResult> {
  const provider = getAiProvider();
  const apiKey = isCloudProvider(provider) ? readSecret(getAiApiKeySecretId(provider)) : null;
  const config = getAiProviderConfig(provider);
  return ADAPTERS[provider].explainFailure(apiKey, config, request);
}

export async function generateCommand(request: AiGenerateCommandRequest): Promise<string> {
  const provider = getAiProvider();
  const apiKey = isCloudProvider(provider) ? readSecret(getAiApiKeySecretId(provider)) : null;
  const config = getAiProviderConfig(provider);
  return ADAPTERS[provider].generateCommand(apiKey, config, request);
}
