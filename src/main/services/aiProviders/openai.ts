import OpenAI from "openai";
import type { AiProviderConfig, AiSuggestRequest } from "../../../shared/types";
import { AI_SYSTEM_PROMPT, buildUserMessage, filterCompletions, type AiProviderAdapter } from "./types";

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
    if (err instanceof OpenAI.AuthenticationError) {
      throw new Error("AI suggestion failed: invalid API key — check it in Settings.");
    }
    if (err instanceof OpenAI.RateLimitError) {
      // OpenAI returns 429 for both "too many requests" and "no quota left"
      // — the nested message (extracted below) distinguishes them, so this
      // is just a safety-net wording if that nested message is missing.
      const body = err.error as { error?: { message?: string } } | null | undefined;
      throw new Error(`AI suggestion failed: ${body?.error?.message ?? "rate limited — try again shortly."}`);
    }
    if (err instanceof OpenAI.APIError) {
      // err.message is "<status> <raw JSON body>" — not fit to show a user;
      // the API's own nested error.message is the part worth surfacing.
      const body = err.error as { error?: { message?: string } } | null | undefined;
      throw new Error(`AI suggestion failed: ${body?.error?.message ?? err.message}`);
    }
    throw err;
  }

  const toolCall = response.choices[0]?.message.tool_calls?.find(
    (c): c is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall =>
      "function" in c && c.function.name === "suggest_completions",
  );
  let completions: unknown[] = [];
  if (toolCall) {
    try {
      const parsed = JSON.parse(toolCall.function.arguments) as { completions?: unknown };
      if (Array.isArray(parsed.completions)) completions = parsed.completions;
    } catch {
      // Malformed JSON from the model — filterCompletions below yields [] for a non-array, which is the right outcome.
    }
  }
  return filterCompletions(request.currentLine, completions);
}

const openaiAdapter: AiProviderAdapter = { suggest };
export default openaiAdapter;
