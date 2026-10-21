import { describe, expect, it } from "vitest";
import {
  DEFAULT_HISTORY_SETTINGS,
  looksLikeInlineSecret,
  matchesIgnorePattern,
  normalizeHistorySettings,
  pruneByRetention,
  shouldRecordCommand,
} from "./historyFilter";

describe("looksLikeInlineSecret", () => {
  it.each([
    "export API_TOKEN=abc123",
    "DB_PASSWORD=hunter2 ./run.sh",
    "mytool --password=hunter2",
    "mytool --password hunter2",
    "mysql -u root -phunter2 mydb",
    "mysqldump -pSECRET db > out.sql",
    "sshpass -p hunter2 ssh me@host",
    "curl -u admin:hunter2 https://example.com",
    "curl --user admin:hunter2 https://example.com",
    'curl -H "Authorization: Bearer abcdef123456" https://x',
    "curl -H 'X-Api-Key: abc123' https://x",
    "echo me:pw | chpasswd",
    "aws configure set aws_access_key_id AKIAIOSFODNN7EXAMPLE",
    "git clone https://ghp_abcdefghijklmnopqrstuvwxyz0123@github.com/o/r",
    "export OPENAI=sk-abcdefghijklmnopqrstuvwxyz",
  ])("flags %j", (c) => expect(looksLikeInlineSecret(c)).toBe(true));

  it.each([
    "ls -la /var/log",
    "git commit -m 'fix password reset email'",
    "export PATH=$PATH:/opt/bin",
    "mysql -u root -p",
    "mysql -u root mydb",
    "ssh -p 2222 me@host",
    "sudo passwd me",
    "curl -u admin https://example.com",
    "grep -r token src/",
    "echo $TOKEN",
    "cat /etc/passwd",
  ])("lets %j through", (c) => expect(looksLikeInlineSecret(c)).toBe(false));
});

describe("matchesIgnorePattern", () => {
  it("matches the whole command, with * as a wildcard, ignoring case", () => {
    expect(matchesIgnorePattern("ls", ["ls"])).toBe(true);
    expect(matchesIgnorePattern("ls -la", ["ls"])).toBe(false);
    expect(matchesIgnorePattern("ls -la", ["ls *"])).toBe(true);
    expect(matchesIgnorePattern("SSH me@host", ["ssh *"])).toBe(true);
    expect(matchesIgnorePattern("echo a-b", ["*a-b"])).toBe(true);
  });
  it("treats everything else in a pattern literally", () => {
    expect(matchesIgnorePattern("a.b", ["a.b"])).toBe(true);
    expect(matchesIgnorePattern("axb", ["a.b"])).toBe(false);
    expect(matchesIgnorePattern("x(y", ["x(y"])).toBe(true);
  });
  it("ignores blank patterns", () => {
    expect(matchesIgnorePattern("ls", ["", "  "])).toBe(false);
  });
});

describe("shouldRecordCommand", () => {
  const on = DEFAULT_HISTORY_SETTINGS;
  it("records ordinary commands by default", () => {
    expect(shouldRecordCommand("ls -la", on)).toBe(true);
  });
  it("records nothing when switched off", () => {
    expect(shouldRecordCommand("ls", { ...on, enabled: false })).toBe(false);
  });
  it("skips secret-looking commands unless that is turned off", () => {
    expect(shouldRecordCommand("export TOKEN=abc", on)).toBe(false);
    expect(shouldRecordCommand("export TOKEN=abc", { ...on, skipSecretLooking: false })).toBe(true);
  });
  it("skips what the user's patterns match", () => {
    expect(shouldRecordCommand("history -c", { ...on, ignorePatterns: ["history *"] })).toBe(false);
  });
  it("never records an empty command", () => {
    expect(shouldRecordCommand("   ", on)).toBe(false);
  });
});

describe("normalizeHistorySettings", () => {
  it("falls back to defaults for junk", () => {
    expect(normalizeHistorySettings(null)).toEqual(DEFAULT_HISTORY_SETTINGS);
    expect(normalizeHistorySettings("x")).toEqual(DEFAULT_HISTORY_SETTINGS);
  });
  it("keeps valid values, trims patterns and drops bad ones", () => {
    expect(
      normalizeHistorySettings({ enabled: false, skipSecretLooking: false, ignorePatterns: [" ls ", "", 5, "cd *"], retentionDays: 30 }),
    ).toEqual({
      enabled: false,
      skipSecretLooking: false,
      ignorePatterns: ["ls", "cd *"],
      retentionDays: 30,
    });
  });
  it("clamps retention", () => {
    expect(normalizeHistorySettings({ retentionDays: -4 }).retentionDays).toBe(0);
    expect(normalizeHistorySettings({ retentionDays: 99999 }).retentionDays).toBe(3650);
    expect(normalizeHistorySettings({ retentionDays: "abc" }).retentionDays).toBe(0);
  });
});

describe("pruneByRetention", () => {
  const DAY = 86_400_000;
  const entries = [{ timestamp: 0 }, { timestamp: 5 * DAY }, { timestamp: 9 * DAY }];
  it("drops entries older than the limit", () => {
    expect(pruneByRetention(entries, 10 * DAY, 7)).toEqual([{ timestamp: 5 * DAY }, { timestamp: 9 * DAY }]);
  });
  it("keeps everything when retention is 0", () => {
    expect(pruneByRetention(entries, 10 * DAY, 0)).toBe(entries);
  });
});
