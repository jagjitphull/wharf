export const name = "history";

export async function run(t, start) {
  const app = await start();
  await app.until(() => app.q(".home"), 15_000);
  const history = async () =>
    (await app.evJson(`window.wharf.commandHistory.list().then((l) => l.map((e) => e.command))`)).map((c) => c.trim());
  const settings = (patch) =>
    app.ev(
      `window.wharf.commandHistory.getSettings().then((s) => window.wharf.commandHistory.setSettings({ ...s, ...${JSON.stringify(patch)} }))`,
    );
  const settle = () => app.sleep(500); // history writes cross an IPC hop after the prompt returns

  // --- what is captured, with shell integration on (the default)
  await app.newLocalShell();
  await app.run("echo first");
  await app.run("echo a && echo b");
  await app.type("echo one \\\n");
  await app.type("two \\\n");
  await app.run("three");
  await app.run("");
  await app.run("true");
  await settle();
  let h = await history();
  t.info(`history: ${JSON.stringify(h)}`);
  t.ok(
    "typed commands are recorded once each, with the shell's own text",
    JSON.stringify(h) === JSON.stringify(["echo first", "echo a && echo b", "echo one two three", "true"]),
    JSON.stringify(h),
  );
  t.ok("no internal hook name leaks into history", !h.some((c) => c.includes("__wharf")));

  // --- passwords and other input to a running program
  await app.run("read -s -p 'Password: ' pw", { wait: false });
  await app.waitScreen(/Password:/);
  await app.type("hunter2-secret\n");
  await app.until(async () => !/Password:\s*$/.test(await app.screen()), 5000);
  await app.run("echo after-password");
  await settle();
  h = await history();
  t.ok("integration on: a password typed to a running program is not recorded", !h.some((c) => c.includes("hunter2")), JSON.stringify(h));
  t.ok("…while the commands around it are", h.includes("echo after-password") && h.some((c) => c.startsWith("read -s")));

  // --- typing ahead: a line typed while another command runs is recorded once, and nothing is overwritten
  await app.run("sleep 1.5", { wait: false });
  await app.sleep(300);
  await app.type("echo typed-ahead\n");
  await app.waitScreen(/typed-ahead\s*\n.*[#$]\s*$/s, 10_000);
  await settle();
  h = await history();
  t.ok(
    "a line typed ahead is recorded once, from the shell's text",
    h.filter((c) => c === "echo typed-ahead").length === 1,
    JSON.stringify(h.slice(-4)),
  );
  t.ok("…and the command it was typed behind is intact", h.includes("sleep 1.5"), JSON.stringify(h.slice(-4)));

  // --- a leading space keeps a command out
  await app.run(" echo hidden-by-space");
  await app.run("echo visible-after-hidden");
  await settle();
  h = await history();
  t.ok("a command typed with a leading space is not recorded", !h.some((c) => c.includes("hidden-by-space")), JSON.stringify(h.slice(-4)));
  t.ok("…and the one after it is", h.includes("echo visible-after-hidden"));

  // --- secret-looking commands
  await app.run("echo token-check API_TOKEN=abc123");
  await settle();
  t.ok("a secret-looking command is skipped by default", !(await history()).some((c) => c.includes("API_TOKEN")));
  await settings({ skipSecretLooking: false });
  await app.run("echo token-check2 API_TOKEN=abc123");
  await settle();
  t.ok(
    "…and recorded once that filter is off",
    (await history()).some((c) => c.includes("token-check2")),
  );
  await settings({ skipSecretLooking: true });

  // --- ignore patterns
  await settings({ ignorePatterns: ["echo ignore-me*"] });
  await app.run("echo ignore-me please");
  await app.run("echo keep-me");
  await settle();
  h = await history();
  t.ok("a command matching an ignore pattern is skipped", !h.some((c) => c.includes("ignore-me")), JSON.stringify(h.slice(-3)));
  t.ok("…others are not", h.includes("echo keep-me"));
  await settings({ ignorePatterns: [] });

  // --- switching it off
  const before = (await history()).length;
  await settings({ enabled: false });
  await app.run("echo while-off");
  await settle();
  t.ok("nothing is recorded while history is off", (await history()).length === before && !(await history()).includes("echo while-off"));
  await settings({ enabled: true });
  await app.run("echo back-on");
  await settle();
  t.ok("recording resumes when it is turned back on", (await history()).includes("echo back-on"));

  // --- the settings screen
  await app.rail("Settings");
  await app.until(() => app.q(".history-settings"), 5000);
  t.ok("Settings has a Command History section", await app.q(".history-settings"));
  await app.ev(`document.querySelector('.history-settings').scrollIntoView({ block: "start" })`);
  await app.sleep(300);
  await app.shot("history-settings");

  // --- retention applies to what is already stored
  await app.ev(`window.wharf.commandHistory.setSettings({ enabled: true, skipSecretLooking: true, ignorePatterns: [], retentionDays: 0 })`);
  t.ok("retention defaults to keeping everything", (await app.evJson(`window.wharf.commandHistory.getSettings()`)).retentionDays === 0);
  const saved = await app.evJson(
    `window.wharf.commandHistory.setSettings({ enabled: true, skipSecretLooking: true, ignorePatterns: [], retentionDays: 7 })`,
  );
  t.ok("a retention limit is saved", saved.retentionDays === 7);
  t.ok("recent entries survive it", (await history()).includes("echo back-on"));

  // --- it all survives a restart
  const { profile, home } = app;
  await app.ev(
    `window.wharf.commandHistory.setSettings({ enabled: true, skipSecretLooking: false, ignorePatterns: ["ls *"], retentionDays: 30 })`,
  );
  await app.sleep(500);
  await app.stop();
  const second = await start({ profile, home });
  await second.until(() => second.q(".home"), 15_000);
  const again = await second.evJson(`window.wharf.commandHistory.getSettings()`);
  t.ok(
    "settings persist across a restart",
    again.skipSecretLooking === false && again.retentionDays === 30 && again.ignorePatterns[0] === "ls *",
    JSON.stringify(again),
  );
}
