import { GoogleGenAI, ApiError } from "@google/genai";
import type { AiExplainFailureRequest, AiGenerateCommandRequest, AiProviderConfig, AiSuggestRequest } from "../../../shared/types";
import {
  AI_SYSTEM_PROMPT,
  AI_EXPLAIN_FAILURE_SYSTEM_PROMPT,
  AI_GENERATE_COMMAND_SYSTEM_PROMPT,
  buildUserMessage,
  buildExplainFailureUserMessage,
  buildGenerateCommandUserMessage,
  filterCompletions,
  sanitizeGeneratedCommand,
  type AiProviderAdapter,
} from "./types";

const DEFAULT_MODEL = "gemini-2.5-flash";

// Gemini has no forced-tool-call equivalent as clean as Claude/OpenAI's
// tool_choice, so every call here uses structured JSON output
// (responseJsonSchema + responseMimeType) instead of function calling —
// simpler, and just as reliably parseable.
const SUGGEST_SCHEMA = {
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

const EXPLAIN_SCHEMA = {
  type: "object",
  properties: {
    explanation: { type: "string", description: "2-4 sentences, plain text, why the command likely failed." },
    suggestedFix: { type: "string", description: "A complete, directly runnable corrected command. Omit if not confident." },
  },
  required: ["explanation"],
};

const GENERATE_SCHEMA = {
  type: "object",
  properties: {
    command: { type: "string", description: "One complete shell command, no explanations or markdown." },
  },
  required: ["command"],
};

/** Every Gemini call in this adapter fails the same way for the same
 * reasons, so the translation to a user-facing message is shared across
 * suggest/explainFailure/generateCommand rather than tripled. `action`
 * names what failed in the resulting message. Unlike the Claude/OpenAI
 * SDKs, ApiError.message here is already the API's own human-readable
 * text, not a raw JSON dump — usable as-is. */
function translateGeminiError(err: unknown, action: string): Error {
  if (err instanceof ApiError) {
    if (err.status === 429) {
      return new Error(`${action} failed: rate limited — ${err.message || "try again shortly."}`);
    }
    if (/api key/i.test(err.message) && /(invalid|not valid|expired)/i.test(err.message)) {
      return new Error(`${action} failed: invalid API key — check it in Settings.`);
    }
    return new Error(`${action} failed: ${err.message}`);
  }
  return err instanceof Error ? err : new Error(String(err));
}

async function suggest(apiKey: string | null, config: AiProviderConfig, request: AiSuggestRequest): Promise<string[]> {
  if (!apiKey) throw new Error("No AI API key configured — add one in Settings to use autocomplete.");
  const client = new GoogleGenAI({ apiKey });
  const model = config.model?.trim() || DEFAULT_MODEL;

  let text: string | undefined;
  try {
    const response = await client.models.generateContent({
      model,
      contents: buildUserMessage(request),
      config: { systemInstruction: AI_SYSTEM_PROMPT, responseMimeType: "application/json", responseJsonSchema: SUGGEST_SCHEMA },
    });
    text = response.text;
  } catch (err) {
    throw translateGeminiError(err, "AI suggestion");
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

async function explainFailure(
  apiKey: string | null,
  config: AiProviderConfig,
  request: AiExplainFailureRequest,
): Promise<{ explanation: string; suggestedFix?: string }> {
  if (!apiKey) throw new Error("No AI API key configured — add one in Settings to use autocomplete.");
  const client = new GoogleGenAI({ apiKey });
  const model = config.model?.trim() || DEFAULT_MODEL;

  let text: string | undefined;
  try {
    const response = await client.models.generateContent({
      model,
      contents: buildExplainFailureUserMessage(request),
      config: {
        systemInstruction: AI_EXPLAIN_FAILURE_SYSTEM_PROMPT,
        responseMimeType: "application/json",
        responseJsonSchema: EXPLAIN_SCHEMA,
      },
    });
    text = response.text;
  } catch (err) {
    throw translateGeminiError(err, "Explain failed");
  }

  let parsed: { explanation?: unknown; suggestedFix?: unknown } = {};
  try {
    if (text) parsed = JSON.parse(text);
  } catch {
    /* malformed JSON — treated as "no explanation" below */
  }
  const explanation = typeof parsed.explanation === "string" ? parsed.explanation : "";
  const suggestedFix = typeof parsed.suggestedFix === "string" ? sanitizeGeneratedCommand(parsed.suggestedFix) : undefined;
  if (!explanation) throw new Error("Explain failed: the model didn't return an explanation.");
  return suggestedFix ? { explanation, suggestedFix } : { explanation };
}

async function generateCommand(apiKey: string | null, config: AiProviderConfig, request: AiGenerateCommandRequest): Promise<string> {
  if (!apiKey) throw new Error("No AI API key configured — add one in Settings to use autocomplete.");
  const client = new GoogleGenAI({ apiKey });
  const model = config.model?.trim() || DEFAULT_MODEL;

  let text: string | undefined;
  try {
    const response = await client.models.generateContent({
      model,
      contents: buildGenerateCommandUserMessage(request),
      config: {
        systemInstruction: AI_GENERATE_COMMAND_SYSTEM_PROMPT,
        responseMimeType: "application/json",
        responseJsonSchema: GENERATE_SCHEMA,
      },
    });
    text = response.text;
  } catch (err) {
    throw translateGeminiError(err, "Generate command");
  }

  if (!text) return "";
  try {
    return sanitizeGeneratedCommand((JSON.parse(text) as { command?: unknown }).command);
  } catch {
    return "";
  }
}

const geminiAdapter: AiProviderAdapter = { suggest, explainFailure, generateCommand };
export default geminiAdapter;
