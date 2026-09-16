import type { AiExplainFailureRequest, AiGenerateCommandRequest, AiProviderConfig, AiSuggestRequest } from "../../../shared/types";

/**
 * Every provider adapter (claude.ts, openai.ts, gemini.ts, ollama.ts)
 * implements the same three operations against that provider's own SDK/API,
 * sharing the prompt text and defensive output validation below so the
 * behavior (not just the shape) is consistent across providers.
 *
 * `apiKey` is null for Ollama (a local server, no key involved) and always
 * a real string for the three cloud providers by the time any of these is
 * called (aiSuggest.ts checks for a configured key before dispatching).
 */
export interface AiProviderAdapter {
  /** Up to 3 likely completions of the current line, raw (no validation here). */
  suggest(apiKey: string | null, config: AiProviderConfig, request: AiSuggestRequest): Promise<string[]>;
  /** Why a failed command likely failed, and a corrected command if there's a confident one. */
  explainFailure(apiKey: string | null, config: AiProviderConfig, request: AiExplainFailureRequest): Promise<{ explanation: string; suggestedFix?: string }>;
  /** One real shell command generated from a plain-English description, raw (no validation here). */
  generateCommand(apiKey: string | null, config: AiProviderConfig, request: AiGenerateCommandRequest): Promise<string>;
}

// ---------------------------------------------------------------------------
// suggest() — terminal autocomplete
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// explainFailure() — Command Blocks "Explain / Fix" action
// ---------------------------------------------------------------------------

export const AI_EXPLAIN_FAILURE_SYSTEM_PROMPT = `You are a shell debugging assistant embedded in an SSH/local-shell terminal client. You'll be given a command that failed, its captured output (stdout and stderr interleaved, as the terminal actually showed it — may be truncated if long), its real exit code, the host name, and the OS platform.

Explain concisely (2-4 sentences, plain text, no markdown) why the command most likely failed, grounded in the actual output shown — don't speculate about causes the output doesn't support. If you're confident about a corrected command that would fix the problem, provide it as a complete, directly runnable replacement (not a fragment or a description). If you aren't confident in a specific fix, omit it rather than guessing.`;

export function buildExplainFailureUserMessage(request: AiExplainFailureRequest): string {
  const MAX_OUTPUT = 4000;
  const output = request.output.length > MAX_OUTPUT ? `…(truncated)…\n${request.output.slice(-MAX_OUTPUT)}` : request.output;
  return [
    `Platform: ${request.platform}`,
    `Host: ${request.hostName}`,
    `Exit code: ${request.exitCode}`,
    `Command: ${request.command}`,
    `Output:`,
    output || "(no output captured)",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// generateCommand() — natural language -> command
// ---------------------------------------------------------------------------

export const AI_GENERATE_COMMAND_SYSTEM_PROMPT = `You are a shell command generation assistant embedded in an SSH/local-shell terminal client. You'll be given a plain-English description of what the user wants to do, their recent commands in this session (for context/consistency — e.g. matching a container/file name they already used), the host name, and the OS platform.

Return exactly ONE complete, directly runnable shell command that accomplishes the description — a single line, no explanations, no markdown formatting, no alternatives. If the request is ambiguous, make the single most reasonable interpretation rather than asking for clarification.`;

export function buildGenerateCommandUserMessage(request: AiGenerateCommandRequest): string {
  const historyBlock = request.recentCommands.length
    ? request.recentCommands.map((c, i) => `${i + 1}. ${c}`).join("\n")
    : "(none yet this session)";
  return [
    `Platform: ${request.platform}`,
    `Host: ${request.hostName}`,
    `Recent commands (most recent last):`,
    historyBlock,
    ``,
    `Description: ${request.description}`,
  ].join("\n");
}

/** A generated command is trusted enough to insert into a real pty, so it
 * goes through the same spirit of defensive validation as filterCompletions:
 * only the first line is ever used (a model that returns multiple lines —
 * accidentally or, for a local Ollama model, adversarially — can never get
 * more than one line inserted, so it can't smuggle in a second command that
 * would auto-submit if the terminal doesn't respect bracketed paste). */
export function sanitizeGeneratedCommand(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const firstLine = raw.split(/\r?\n/, 1)[0]?.trim() ?? "";
  return firstLine;
}
