import Anthropic from "@anthropic-ai/sdk";
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

const DEFAULT_MODEL = "claude-opus-5";

const SUGGEST_TOOL: Anthropic.Tool = {
  name: "suggest_completions",
  description: "Return up to 3 likely completions for the shell command the user is currently typing.",
  input_schema: {
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
};

const EXPLAIN_TOOL: Anthropic.Tool = {
  name: "explain_failure",
  description: "Explain why a shell command failed, and optionally provide a corrected command.",
  input_schema: {
    type: "object",
    properties: {
      explanation: { type: "string", description: "2-4 sentences, plain text, why the command likely failed." },
      suggestedFix: { type: "string", description: "A complete, directly runnable corrected command. Omit if not confident." },
    },
    required: ["explanation"],
  },
};

const GENERATE_TOOL: Anthropic.Tool = {
  name: "generate_command",
  description: "Return one complete, directly runnable shell command for the described task.",
  input_schema: {
    type: "object",
    properties: {
      command: { type: "string", description: "One complete shell command, no explanations or markdown." },
    },
    required: ["command"],
  },
};

/** Every Claude call in this adapter fails the same way for the same
 * reasons — auth, rate limit, or some other API error — so the translation
 * to a user-facing message is shared across suggest/explainFailure/
 * generateCommand rather than tripled. `action` names what failed in the
 * resulting message, e.g. "AI suggestion" or "Explain failed". */
function translateClaudeError(err: unknown, action: string): Error {
  if (err instanceof Anthropic.AuthenticationError) {
    return new Error(`${action} failed: invalid API key — check it in Settings.`);
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new Error(`${action} failed: rate limited — try again shortly.`);
  }
  if (err instanceof Anthropic.APIError) {
    // err.message is "<status> <raw JSON body>" — not fit to show a user.
    // The API's own nested error.message (e.g. "Your credit balance is too
    // low...") is the part actually worth surfacing.
    const body = err.error as { error?: { message?: string } } | null | undefined;
    const detail = body?.error?.message ?? err.message;
    if (err.status === 400 && /credit balance/i.test(detail)) {
      return new Error(
        `${action} failed: this Anthropic account has no API credit — add a payment method or credits at ` +
          "console.anthropic.com under Plans & Billing.",
      );
    }
    return new Error(`${action} failed: ${detail}`);
  }
  return err instanceof Error ? err : new Error(String(err));
}

function toolInput(response: Anthropic.Message, toolName: string): Record<string, unknown> | null {
  for (const block of response.content) {
    if (block.type === "tool_use" && block.name === toolName) return block.input as Record<string, unknown>;
  }
  return null;
}

async function suggest(apiKey: string | null, config: AiProviderConfig, request: AiSuggestRequest): Promise<string[]> {
  if (!apiKey) throw new Error("No AI API key configured — add one in Settings to use autocomplete.");
  const client = new Anthropic({ apiKey });
  const model = config.model?.trim() || DEFAULT_MODEL;

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model,
      max_tokens: 4096,
      // Autocomplete is a simple, latency-sensitive task — low effort keeps
      // thinking (on by default on this model) brief rather than disabling
      // it outright, which has its own failure modes on this model.
      output_config: { effort: "low" },
      system: AI_SYSTEM_PROMPT,
      tools: [SUGGEST_TOOL],
      tool_choice: { type: "tool", name: "suggest_completions" },
      messages: [{ role: "user", content: buildUserMessage(request) }],
    });
  } catch (err) {
    throw translateClaudeError(err, "AI suggestion");
  }

  const input = toolInput(response, "suggest_completions");
  return filterCompletions(request.currentLine, input?.completions);
}

async function explainFailure(
  apiKey: string | null,
  config: AiProviderConfig,
  request: AiExplainFailureRequest,
): Promise<{ explanation: string; suggestedFix?: string }> {
  if (!apiKey) throw new Error("No AI API key configured — add one in Settings to use autocomplete.");
  const client = new Anthropic({ apiKey });
  const model = config.model?.trim() || DEFAULT_MODEL;

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model,
      max_tokens: 1024,
      output_config: { effort: "low" },
      system: AI_EXPLAIN_FAILURE_SYSTEM_PROMPT,
      tools: [EXPLAIN_TOOL],
      tool_choice: { type: "tool", name: "explain_failure" },
      messages: [{ role: "user", content: buildExplainFailureUserMessage(request) }],
    });
  } catch (err) {
    throw translateClaudeError(err, "Explain failed");
  }

  const input = toolInput(response, "explain_failure");
  const explanation = typeof input?.explanation === "string" ? input.explanation : "";
  const suggestedFix = typeof input?.suggestedFix === "string" ? sanitizeGeneratedCommand(input.suggestedFix) : undefined;
  if (!explanation) throw new Error("Explain failed: the model didn't return an explanation.");
  return suggestedFix ? { explanation, suggestedFix } : { explanation };
}

async function generateCommand(apiKey: string | null, config: AiProviderConfig, request: AiGenerateCommandRequest): Promise<string> {
  if (!apiKey) throw new Error("No AI API key configured — add one in Settings to use autocomplete.");
  const client = new Anthropic({ apiKey });
  const model = config.model?.trim() || DEFAULT_MODEL;

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model,
      max_tokens: 1024,
      output_config: { effort: "low" },
      system: AI_GENERATE_COMMAND_SYSTEM_PROMPT,
      tools: [GENERATE_TOOL],
      tool_choice: { type: "tool", name: "generate_command" },
      messages: [{ role: "user", content: buildGenerateCommandUserMessage(request) }],
    });
  } catch (err) {
    throw translateClaudeError(err, "Generate command");
  }

  const input = toolInput(response, "generate_command");
  return sanitizeGeneratedCommand(input?.command);
}

const claudeAdapter: AiProviderAdapter = { suggest, explainFailure, generateCommand };
export default claudeAdapter;
