import type { UpdateCheckResult } from "../../shared/types";

export const UPDATE_REPO = "jagjitphull/wharf";

const PARSE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

interface ParsedVersion {
  core: [number, number, number];
  pre: string[] | null;
}

function parseVersion(version: string): ParsedVersion | null {
  const m = PARSE.exec(version.trim());
  if (!m) return null;
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split(".") : null };
}

function comparePrerelease(a: string[], b: string[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined) return -1; // a shorter set of identifiers sorts first
    if (y === undefined) return 1;
    const xNum = /^\d+$/.test(x);
    const yNum = /^\d+$/.test(y);
    if (xNum && yNum) {
      if (Number(x) !== Number(y)) return Number(x) < Number(y) ? -1 : 1;
    } else if (xNum !== yNum) {
      return xNum ? -1 : 1; // numeric identifiers sort before alphanumeric ones
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

/**
 * Semver ordering (a leading "v" is allowed, build metadata ignored): -1 if
 * `a` is older than `b`, 1 if newer, 0 if equal, null if either isn't a
 * parseable version. A pre-release sorts before its own release (1.0.0-rc.1
 * < 1.0.0).
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 | null {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) {
    if (pa.core[i] !== pb.core[i]) return pa.core[i] < pb.core[i] ? -1 : 1;
  }
  if (!pa.pre && !pb.pre) return 0;
  if (!pa.pre) return 1;
  if (!pb.pre) return -1;
  return comparePrerelease(pa.pre, pb.pre) as -1 | 0 | 1;
}

type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

/**
 * Asks GitHub for the repository's latest published release (drafts and
 * pre-releases are excluded by that endpoint) and compares it to the running
 * version. Never throws — every failure (offline, no release yet, rate
 * limit, unexpected response) comes back as `{ latestVersion: null, error }`
 * so the caller can decide how loudly to report it: a manual check shows it,
 * a background check at launch just stays quiet.
 */
export async function checkForUpdate(
  currentVersion: string,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
  repo: string = UPDATE_REPO,
  timeoutMs = 10_000,
): Promise<UpdateCheckResult> {
  const fallbackUrl = `https://github.com/${repo}/releases`;
  const failed = (error: string): UpdateCheckResult => ({
    currentVersion,
    latestVersion: null,
    updateAvailable: false,
    releaseUrl: null,
    error,
  });

  let response;
  try {
    response = await fetchImpl(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "Wharf-update-check" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    return failed(`Couldn't reach GitHub (${err instanceof Error ? err.message : String(err)})`);
  }

  if (response.status === 404) return failed("No release has been published yet");
  if (!response.ok) return failed(`GitHub answered ${response.status}`);

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return failed("GitHub sent a response that couldn't be read");
  }
  const tag = typeof (body as { tag_name?: unknown })?.tag_name === "string" ? (body as { tag_name: string }).tag_name : null;
  if (!tag || !parseVersion(tag)) return failed("The latest release has no recognizable version");

  // Only ever hand back a link on GitHub itself: this URL is later opened in
  // the user's browser, and it came from a network response.
  const rawUrl = (body as { html_url?: unknown }).html_url;
  const releaseUrl = typeof rawUrl === "string" && rawUrl.startsWith(`https://github.com/${repo}/`) ? rawUrl : fallbackUrl;

  const latestVersion = tag.replace(/^v/, "");
  return {
    currentVersion,
    latestVersion,
    updateAvailable: compareVersions(latestVersion, currentVersion) === 1,
    releaseUrl,
  };
}
