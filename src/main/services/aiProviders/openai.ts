import OpenAI from "openai";
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

// A small, fast, cheap model is the right fit for a latency-sensitive
// autocomplete request — overridable in Settings if a different model is
// preferred (e.g. a newer release than what shipped with this app).
const DEFAULT_MODEL = "gpt-4o-mini";

const SUGGEST_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "suggest_completions",
    description: "Return up to 3 likely completions for the shell command the user is currently typing.",
    parameters: {
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
    },
  },
};

const EXPLAIN_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "explain_failure",
    description: "Explain why a shell command failed, and optionally provide a corrected command.",
    parameters: {
      type: "object",
      properties: {
        explanation: { type: "string", description: "2-4 sentences, plain text, why the command likely failed." },
        suggestedFix: { type: "string", description: "A complete, directly runnable corrected command. Omit if not confident." },
      },
      required: ["explanation"],
    },
  },
};

const GENERATE_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "generate_command",
    description: "Return one complete, directly runnable shell command for the described task.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "One complete shell command, no explanations or markdown." },
      },
      required: ["command"],
    },
  },
};

/** Every OpenAI call in this adapter fails the same way for the same
 * reasons, so the translation to a user-facing message is shared across
 * suggest/explainFailure/generateCommand rather than tripled. `action`
 * names what failed in the resulting message. */
function translateOpenAiError(err: unknown, action: string): Error {
  if (err instanceof OpenAI.AuthenticationError) {
    return new Error(`${action} failed: invalid API key — check it in Settings.`);
  }
  if (err instanceof OpenAI.RateLimitError) {
    // OpenAI returns 429 for both "too many requests" and "no quota left" —
    // the nested message (extracted below) distinguishes them, so this is
    // just a safety-net wording if that nested message is missing.
    const body = err.error as { error?: { message?: string } } | null | undefined;
    return new Error(`${action} failed: ${body?.error?.message ?? "rate limited — try again shortly."}`);
  }
  if (err instanceof OpenAI.APIError) {
    // err.message is "<status> <raw JSON body>" — not fit to show a user;
    // the API's own nested error.message is the part worth surfacing.
    const body = err.error as { error?: { message?: string } } | null | undefined;
    return new Error(`${action} failed: ${body?.error?.message ?? err.message}`);
  }
  return err instanceof Error ? err : new Error(String(err));
}

function toolArgs(response: OpenAI.Chat.Completions.ChatCompletion, toolName: string): Record<string, unknown> | null {
  const call = response.choices[0]?.message.tool_calls?.find(
    (c): c is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall => "function" in c && c.function.name === toolName,
  );
  if (!call) return null;
  try {
    return JSON.parse(call.function.arguments) as Record<string, unknown>;
  } catch {
    return null; // malformed JSON from the model — callers treat a null return as "nothing usable"
  }
}

async function suggest(apiKey: string | null, config: AiProviderConfig, request: AiSuggestRequest): Promise<string[]> {
  if (!apiKey) throw new Error("No AI API key configured — add one in Settings to use autocomplete.");
  const client = new OpenAI({ apiKey });
  const model = config.model?.trim() || DEFAULT_MODEL;

  let response: OpenAI.Chat.Completions.ChatCompletion;
  try {
    response = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: AI_SYSTEM_PROMPT },
        { role: "user", content: buildUserMessage(request) },
      ],
      tools: [SUGGEST_TOOL],
      tool_choice: { type: "function", function: { name: "suggest_completions" } },
    });
  } catch (err) {
    throw translateOpenAiError(err, "AI suggestion");
  }

  const args = toolArgs(response, "suggest_completions");
  return filterCompletions(request.currentLine, args?.completions);
}

async function explainFailure(
  apiKey: string | null,
  config: AiProviderConfig,
  request: AiExplainFailureRequest,
): Promise<{ explanation: string; suggestedFix?: string }> {
  if (!apiKey) throw new Error("No AI API key configured — add one in Settings to use autocomplete.");
  const client = new OpenAI({ apiKey });
  const model = config.model?.trim() || DEFAULT_MODEL;

  let response: OpenAI.Chat.Completions.ChatCompletion;
  try {
    response = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: AI_EXPLAIN_FAILURE_SYSTEM_PROMPT },
        { role: "user", content: buildExplainFailureUserMessage(request) },
      ],
      tools: [EXPLAIN_TOOL],
      tool_choice: { type: "function", function: { name: "explain_failure" } },
    });
  } catch (err) {
    throw translateOpenAiError(err, "Explain failed");
  }

  const args = toolArgs(response, "explain_failure");
  const explanation = typeof args?.explanation === "string" ? args.explanation : "";
  const suggestedFix = typeof args?.suggestedFix === "string" ? sanitizeGeneratedCommand(args.suggestedFix) : undefined;
  if (!explanation) throw new Error("Explain failed: the model didn't return an explanation.");
  return suggestedFix ? { explanation, suggestedFix } : { explanation };
}

async function generateCommand(apiKey: string | null, config: AiProviderConfig, request: AiGenerateCommandRequest): Promise<string> {
  if (!apiKey) throw new Error("No AI API key configured — add one in Settings to use autocomplete.");
  const client = new OpenAI({ apiKey });
  const model = config.model?.trim() || DEFAULT_MODEL;

  let response: OpenAI.Chat.Completions.ChatCompletion;
  try {
    response = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: AI_GENERATE_COMMAND_SYSTEM_PROMPT },
        { role: "user", content: buildGenerateCommandUserMessage(request) },
      ],
      tools: [GENERATE_TOOL],
      tool_choice: { type: "function", function: { name: "generate_command" } },
    });
  } catch (err) {
    throw translateOpenAiError(err, "Generate command");
  }

  const args = toolArgs(response, "generate_command");
  return sanitizeGeneratedCommand(args?.command);
}

const openaiAdapter: AiProviderAdapter = { suggest, explainFailure, generateCommand };
export default openaiAdapter;
