import { GoogleGenAI, ApiError } from "@google/genai";
import type { AiProviderConfig, AiSuggestRequest } from "../../../shared/types";
import { AI_SYSTEM_PROMPT, buildUserMessage, filterCompletions, type AiProviderAdapter } from "./types";

const DEFAULT_MODEL = "gemini-2.5-flash";

// Gemini has no forced-tool-call equivalent as clean as Claude/OpenAI's
// tool_choice, so this uses structured JSON output (responseJsonSchema +
// responseMimeType) instead of function calling — simpler, and just as
// reliably parseable.
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

async function suggest(apiKey: string | null, config: AiProviderConfig, request: AiSuggestRequest): Promise<string[]> {
  if (!apiKey) throw new Error("No AI API key configured — add one in Settings to use autocomplete.");

  const client = new GoogleGenAI({ apiKey });
  const model = config.model?.trim() || DEFAULT_MODEL;

  let text: string | undefined;
  try {
    const response = await client.models.generateContent({
      model,
      contents: buildUserMessage(request),
      config: {
        systemInstruction: AI_SYSTEM_PROMPT,
        responseMimeType: "application/json",
        responseJsonSchema: RESPONSE_SCHEMA,
      },
    });
    text = response.text;
  } catch (err) {
    if (err instanceof ApiError) {
      // Unlike the Claude/OpenAI SDKs, ApiError.message here is already the
      // API's own human-readable text, not a raw JSON dump — usable as-is.
      if (err.status === 429) {
        throw new Error(`AI suggestion failed: rate limited — ${err.message || "try again shortly."}`);
      }
      if (/api key/i.test(err.message) && /(invalid|not valid|expired)/i.test(err.message)) {
        throw new Error("AI suggestion failed: invalid API key — check it in Settings.");
      }
      throw new Error(`AI suggestion failed: ${err.message}`);
    }
    throw err;
  }

  if (!text) return [];
  let completions: unknown;
  try {
    completions = (JSON.parse(text) as { completions?: unknown }).completions;
  } catch {
    return []; // malformed JSON from the model — filterCompletions would reject it anyway
  }
  return filterCompletions(request.currentLine, completions);
}

const geminiAdapter: AiProviderAdapter = { suggest };
export default geminiAdapter;
