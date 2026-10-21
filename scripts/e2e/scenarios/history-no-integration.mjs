export const name = "history-no-integration";

// With Command Blocks off the shell reports nothing about its prompts, so the only
// clue that a typed line is a password is the program's own prompt text.
export async function run(t, start) {
  const app = await start();
  await app.until(() => app.q(".home"), 15_000);
  await app.ev(`window.wharf.commandBlocks.setEnabled(false)`);
  const history = async () =>
    (await app.evJson(`window.wharf.commandHistory.list().then((l) => l.map((e) => e.command))`)).map((c) => c.trim());

  await app.newLocalShell();
  await app.run("echo plain-before");
  await app.run("read -s -p 'Enter passphrase: ' pw", { wait: false });
  await app.waitScreen(/Enter passphrase:/);
  await app.type("correct-horse-battery\n");
  await app.until(async () => !/passphrase:\s*$/.test(await app.screen()), 5000);
  await app.run("echo plain-after");
  await app.sleep(500);
  const h = await history();
  t.info(`history: ${JSON.stringify(h)}`);
  t.ok(
    "without integration: the answer to a passphrase prompt is not recorded",
    !h.some((c) => c.includes("correct-horse")),
    JSON.stringify(h),
  );
  t.ok("…and ordinary commands still are", h.includes("echo plain-before") && h.includes("echo plain-after"));
  t.ok("no command blocks were drawn (integration really was off)", !(await app.q(".cmd-block")));
}
