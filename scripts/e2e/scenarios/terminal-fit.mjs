export const name = "terminal-fit";

// The terminal's text grid must stay inside its pane (and clear of the status bar) at any window size:
// a last row that spills out sits under the status bar, hiding the shell prompt.
export async function run(t, start) {
  const app = await start();
  await app.until(() => app.q(".home"), 15_000);
  await app.newLocalShell();
  const PAD = 8;
  for (const [width, height] of [
    [1440, 900],
    [1280, 800],
    [1366, 768],
    [1600, 1000],
    [1920, 1080],
    [1024, 700],
  ]) {
    await app.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await app.sleep(800);
    const m = await app.evJson(`(() => {
      const pane = document.querySelector('.tab-pane-container[style*="flex"] .terminal-pane');
      const p = pane.getBoundingClientRect();
      const s = pane.querySelector('.xterm-screen').getBoundingClientRect();
      const sb = document.querySelector('.status-bar').getBoundingClientRect();
      return { paneBottom: p.bottom, paneRight: p.right, screenBottom: s.bottom, screenRight: s.right, statusTop: sb.top };
    })()`);
    t.ok(
      `at ${width}×${height} the text grid stays inside the pane's padding and above the status bar`,
      m.screenBottom <= m.paneBottom - PAD + 0.5 && m.screenRight <= m.paneRight - PAD + 0.5 && m.screenBottom <= m.statusTop,
      JSON.stringify(m),
    );
  }
  await app.send("Emulation.clearDeviceMetricsOverride");
  await app.run("echo fit-ok");
  t.ok("the terminal still works after resizing", /fit-ok/.test(await app.screen()));
}
