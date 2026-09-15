import Anthropic from "@anthropic-ai/sdk";
import type { AiSuggestRequest } from "../../shared/types";
import { deleteSecret, readSecret, saveSecret, updateSecret } from "./secretStore";
import { getAiApiKeySecretId, setAiApiKeySecretId } from "./store";

/**
 * AI-powered terminal autocomplete: given the command the user is currently
 * typing plus recent command history, asks Claude for up to 3 likely full
 * commands to complete it into. The API key lives in the same
 * encrypted-at-rest secret store as host passwords — never in localStorage,
 * never sent anywhere but directly to the Anthropic API from this process.
 */

const MODEL = "claude-opus-5";

export function hasApiKey(): boolean {
  return readSecret(getAiApiKeySecretId()) !== null;
}

export function setApiKey(key: string): void {
  const existing = getAiApiKeySecretId();
  if (existing) updateSecret(existing, key);
  else setAiApiKeySecretId(saveSecret(key));
}

export function clearApiKey(): void {
  const existing = getAiApiKeySecretId();
  if (!existing) return;
  deleteSecret(existing);
  setAiApiKeySecretId(null);
}

const SYSTEM_PROMPT = `You are a shell command autocomplete assistant embedded in an SSH/local-shell terminal client. You'll be given the command the user is currently typing (possibly empty), their recent command history in this session, the remote host's name, and the OS platform.

Suggest up to 3 likely completions of the CURRENT line by calling suggest_completions. Rules:
- Each completion MUST start with the exact characters already typed, unchanged, and extend them into one complete, runnable shell command.
- Ground suggestions in the user's own recent history where relevant (e.g. repeating a recent command, or a natural next step after one) rather than generic guesses.
- Order suggestions most-likely first.
- If nothing sensible comes to mind, call the tool with an empty array — do not force a guess.
- Never include explanations or extra text outside the tool call.`;

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

function buildUserMessage(request: AiSuggestRequest): string {
  const historyBlock = request.recentCommands.length
    ? request.recentCommands.map((c, i) => `${i + 1}. ${c}`).join("\n")
    : "(none yet this session)";
  return [
    `Platform: ${request.platform}`,
    `Host: ${request.hostName}`,
    `Recent commands (most recent last):`,
    historyBlock,
    ``,
    `Current line: ${JSON.stringify(request.currentLine)}`,
  ].join("\n");
}

export async function suggest(request: AiSuggestRequest): Promise<string[]> {
  const apiKey = readSecret(getAiApiKeySecretId());
  if (!apiKey) {
    throw new Error("No AI API key configured — add one in Settings to use autocomplete.");
  }

  const client = new Anthropic({ apiKey });

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      // Autocomplete is a simple, latency-sensitive task — low effort keeps
      // thinking (on by default on this model) brief rather than disabling
      // it outright, which has its own failure modes on this model.
      output_config: { effort: "low" },
      system: SYSTEM_PROMPT,
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

  let completions: string[] = [];
  for (const block of response.content) {
    if (block.type === "tool_use" && block.name === "suggest_completions") {
      const input = block.input as { completions?: unknown };
      if (Array.isArray(input.completions)) {
        // Defensive validation: only trust completions that actually extend
        // what the user typed, so a model that ignores the system prompt
        // can never inject arbitrary text into the terminal — the renderer
        // trusts this list enough to type it straight into the pty.
        completions = input.completions.filter(
          (c): c is string => typeof c === "string" && c.startsWith(request.currentLine) && c.length > request.currentLine.length,
        );
      }
    }
  }
  return completions.slice(0, 3);
}
