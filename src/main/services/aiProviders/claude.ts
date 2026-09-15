import Anthropic from "@anthropic-ai/sdk";
import type { AiProviderConfig, AiSuggestRequest } from "../../../shared/types";
import { AI_SYSTEM_PROMPT, buildUserMessage, filterCompletions, type AiProviderAdapter } from "./types";

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
    if (err instanceof Anthropic.AuthenticationError) {
      throw new Error("AI suggestion failed: invalid API key — check it in Settings.");
    }
    if (err instanceof Anthropic.RateLimitError) {
      throw new Error("AI suggestion failed: rate limited — try again shortly.");
    }
    if (err instanceof Anthropic.APIError) {
      // err.message is "<status> <raw JSON body>" — not fit to show a user.
      // The API's own nested error.message (e.g. "Your credit balance is
      // too low...") is the part actually worth surfacing.
      const body = err.error as { error?: { message?: string } } | null | undefined;
      const detail = body?.error?.message ?? err.message;
      if (err.status === 400 && /credit balance/i.test(detail)) {
        throw new Error(
          "AI suggestion failed: this Anthropic account has no API credit — add a payment method or " +
            "credits at console.anthropic.com under Plans & Billing.",
        );
      }
      throw new Error(`AI suggestion failed: ${detail}`);
    }
    throw err;
  }

  let completions: unknown[] = [];
  for (const block of response.content) {
    if (block.type === "tool_use" && block.name === "suggest_completions") {
      const input = block.input as { completions?: unknown };
      if (Array.isArray(input.completions)) completions = input.completions;
    }
  }
  return filterCompletions(request.currentLine, completions);
}

const claudeAdapter: AiProviderAdapter = { suggest };
export default claudeAdapter;
