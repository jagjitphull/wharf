import type { AiProviderConfig, AiSuggestRequest } from "../../../shared/types";
import { AI_SYSTEM_PROMPT, buildUserMessage, filterCompletions, type AiProviderAdapter } from "./types";

const DEFAULT_BASE_URL = "http://localhost:11434";

// Ollama's /api/chat supports structured outputs via `format` set to a JSON
// schema (not just the looser `format: "json"`) — same schema shape as the
// other providers' structured-output modes.
const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    completions: {
      type: "array",
      description:
        "0 to 3 completions, most likely first. Each MUST start with the exact currentLine text and extend it into a full command.",
      items: { type: "string" },
      maxItems: 3,
    },
  },
  required: ["completions"],
};

interface OllamaChatResponse {
  message?: { content?: string };
}

/** Node's fetch (undici) collapses every network-level failure into the
 * unhelpful top-level message "fetch failed" — the actual reason lives in
 * `err.cause`, a regular Node/OpenSSL error with its own `.code`. This pulls
 * that out, and specifically recognizes the signature of sending an
 * `https://` request at a server that's actually speaking plain HTTP (the
 * OpenSSL handshake fails oddly rather than just refusing the connection) —
 * a very easy mistake since Ollama serves plain HTTP by default and the
 * error otherwise gives no hint what's wrong. */
function describeFetchFailure(err: unknown, baseUrl: string): string {
  const cause = err instanceof Error && "cause" in err ? (err.cause as { code?: string; message?: string } | undefined) : undefined;
  const code = cause?.code;
  const causeMessage = cause?.message ?? (cause as unknown as Error | undefined)?.toString();

  const looksLikeTlsMismatch =
    baseUrl.startsWith("https://") &&
    (code?.startsWith("ERR_SSL_") || code === "EPROTO" || /wrong version number|ssl routines/i.test(causeMessage ?? ""));
  if (looksLikeTlsMismatch) {
    return (
      `couldn't reach Ollama at ${baseUrl} — got a TLS/SSL error talking to it over https://, but Ollama serves ` +
      `plain HTTP by default. Try http:// instead of https:// in the base URL.`
    );
  }

  const detail = causeMessage || (err instanceof Error ? err.message : String(err));
  return `couldn't reach Ollama at ${baseUrl} (${detail}) — is it running (\`ollama serve\`)?`;
}

/**
 * Ollama runs locally with no API key — just a base URL (default
 * http://localhost:11434) and whatever model the user has already pulled
 * there (`ollama pull <model>`). Talked to over its plain HTTP API rather
 * than an SDK — it's a handful of well-documented endpoints, not worth a
 * dependency for.
 */
async function suggest(_apiKey: string | null, config: AiProviderConfig, request: AiSuggestRequest): Promise<string[]> {
  const model = config.model?.trim();
  if (!model) throw new Error("No Ollama model configured — set one in Settings (e.g. a model you've already run `ollama pull` for).");
  const baseUrl = (config.baseUrl?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        format: RESPONSE_SCHEMA,
        messages: [
          { role: "system", content: AI_SYSTEM_PROMPT },
          { role: "user", content: buildUserMessage(request) },
        ],
      }),
    });
  } catch (err) {
    throw new Error(`AI suggestion failed: ${describeFetchFailure(err, baseUrl)}`);
  }

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) detail = body.error;
    } catch {
      /* non-JSON error body — fall back to the bare status */
    }
    throw new Error(`AI suggestion failed: ${detail}`);
  }

  const body = (await res.json()) as OllamaChatResponse;
  const content = body.message?.content;
  if (!content) return [];

  let completions: unknown;
  try {
    completions = (JSON.parse(content) as { completions?: unknown }).completions;
  } catch {
    return []; // malformed JSON from the model — filterCompletions would reject it anyway
  }
  return filterCompletions(request.currentLine, completions);
}

const ollamaAdapter: AiProviderAdapter = { suggest };
export default ollamaAdapter;
