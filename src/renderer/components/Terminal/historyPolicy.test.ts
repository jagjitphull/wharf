import { describe, expect, it } from "vitest";
import { appendOutputTail, looksLikeSecretPrompt, shouldRecordTypedLine } from "./historyPolicy";

describe("looksLikeSecretPrompt", () => {
  it.each([
    "Password: ",
    "[sudo] password for admin: ",
    "admin@10.0.1.11's password: ",
    "Enter passphrase for key '/home/me/.ssh/id_ed25519': ",
    "Enter passphrase (empty for no passphrase): ",
    "Verification code: ",
    "Enter PIN: ",
    "Please enter your token:",
    "Password:",
    "MySQL password? ",
  ])("recognises %j", (tail) => expect(looksLikeSecretPrompt(tail)).toBe(true));

  it.each([
    "root@vm:~# ",
    "$ ",
    "Do you want to continue? [Y/n] ",
    "Last login: Mon Oct 19 from 10.0.0.2\n",
    "password updated successfully\n",
    "Enter your name: ",
    "",
  ])("does not mistake %j for one", (tail) => expect(looksLikeSecretPrompt(tail)).toBe(false));
});

describe("appendOutputTail", () => {
  it("strips colour and other control sequences, so a coloured prompt is still seen", () => {
    const tail = appendOutputTail("", "\x1b[1m\x1b[31mPassword\x1b[0m: \x1b]0;title\x07");
    expect(tail).toBe("Password: ");
    expect(looksLikeSecretPrompt(tail)).toBe(true);
  });
  it("sees a prompt split across chunks", () => {
    let tail = appendOutputTail("", "[sudo] pass");
    tail = appendOutputTail(tail, "word for me: ");
    expect(looksLikeSecretPrompt(tail)).toBe(true);
  });
  it("keeps only the last 200 characters", () => {
    expect(appendOutputTail("", "x".repeat(500))).toHaveLength(200);
  });
  it("forgets a prompt once more output follows it", () => {
    expect(looksLikeSecretPrompt(appendOutputTail("Password: ", "\r\nroot@vm:~# "))).toBe(false);
  });
});

describe("shouldRecordTypedLine", () => {
  it("with integration, records only what is typed at the shell's own prompt", () => {
    expect(shouldRecordTypedLine({ integrationSeen: true, atPrompt: true, secretPromptShown: false })).toBe(true);
    expect(shouldRecordTypedLine({ integrationSeen: true, atPrompt: false, secretPromptShown: false })).toBe(false);
  });
  it("with integration, a lookalike prompt doesn't matter — the shell's word wins", () => {
    expect(shouldRecordTypedLine({ integrationSeen: true, atPrompt: true, secretPromptShown: true })).toBe(true);
  });
  it("without integration, falls back to the prompt text", () => {
    expect(shouldRecordTypedLine({ integrationSeen: false, atPrompt: false, secretPromptShown: false })).toBe(true);
    expect(shouldRecordTypedLine({ integrationSeen: false, atPrompt: false, secretPromptShown: true })).toBe(false);
  });
});
