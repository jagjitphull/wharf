/**
 * Warp-style "Workflows": a saved snippet's command can contain
 * `{{placeholder}}` tokens — filled in via a small form right before
 * insertion, rather than needing a separate data model. A plain snippet
 * (no `{{...}}`) behaves exactly as before: inserted immediately, no form.
 */

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z_][\w-]*)\s*\}\}/g;

/** Unique placeholder names, in first-appearance order. */
export function extractPlaceholders(command: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const match of command.matchAll(PLACEHOLDER_RE)) {
    const name = match[1];
    if (!seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}

export function fillPlaceholders(command: string, values: Record<string, string>): string {
  return command.replace(PLACEHOLDER_RE, (whole, name: string) => (name in values ? values[name] : whole));
}
