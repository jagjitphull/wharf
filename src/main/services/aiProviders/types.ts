import type { AiProviderConfig, AiSuggestRequest } from "../../../shared/types";

/**
 * Every provider adapter (claude.ts, openai.ts, gemini.ts, ollama.ts)
 * implements this one function: given the request and this provider's
 * config (model override, and for Ollama a base URL), ask the model for up
 * to 3 completions and return them raw — no validation here.
 *
 * `apiKey` is null for Ollama (a local server, no key involved) and always
 * a real string for the three cloud providers by the time this is called
 * (aiSuggest.ts checks for a configured key before dispatching).
 */
export interface AiProviderAdapter {
  suggest(apiKey: string | null, config: AiProviderConfig, request: AiSuggestRequest): Promise<string[]>;
}

/** Shared system prompt text, identical in spirit across providers — the
 * exact wording each adapter sends may differ slightly to fit that
 * provider's prompting conventions, but the rules are the same everywhere. */
export const AI_SYSTEM_PROMPT = `You are a shell command autocomplete assistant embedded in an SSH/local-shell terminal client. You'll be given the command the user is currently typing (possibly empty), their recent command history in this session, the remote host's name, and the OS platform.

Suggest up to 3 likely completions of the CURRENT line. Rules:
- Each completion MUST start with the exact characters already typed, unchanged, and extend them into one complete, runnable shell command.
- Ground suggestions in the user's own recent history where relevant (e.g. repeating a recent command, or a natural next step after one) rather than generic guesses.
- Order suggestions most-likely first.
- If nothing sensible comes to mind, return an empty list — do not force a guess.
- Never include explanations or extra text outside the completions themselves.`;

export function buildUserMessage(request: AiSuggestRequest): string {
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

/** Every adapter's raw output goes through this before the renderer ever
 * sees it: only trust completions that actually extend what the user
 * typed, so a model that ignores the prompt (or a misconfigured/malicious
 * local Ollama model) can never inject arbitrary text into a real pty. */
export function filterCompletions(currentLine: string, completions: unknown): string[] {
  if (!Array.isArray(completions)) return [];
  return completions
    .filter((c): c is string => typeof c === "string" && c.startsWith(currentLine) && c.length > currentLine.length)
    .slice(0, 3);
}
