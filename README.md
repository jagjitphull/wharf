# Wharf

[![CI](https://github.com/jagjitphull/wharf/actions/workflows/ci.yml/badge.svg)](https://github.com/jagjitphull/wharf/actions/workflows/ci.yml)

A personal SSH/SFTP terminal client, Termius-style.

- **Desktop app:** Electron + React + TypeScript
- **Terminal:** [xterm.js](https://xtermjs.org/) over a live SSH shell ([ssh2](https://github.com/mscdex/ssh2))
- **SFTP:** full file browser (list/upload/download/mkdir/rmdir/rename/delete) over the same `ssh2` connection
- **Storage:** local JSON store (`electron-store`) for hosts/groups/tunnels; secrets (passwords, key passphrases) encrypted at rest via Electron's `safeStorage` (OS keychain)

## Features

- Save hosts, organize them into (nested) groups — drag a host onto a group
  to move it there, or onto the host count at the bottom of the sidebar to
  ungroup it
- Connect via password, private key, or SSH agent auth
- Multiple concurrent terminal sessions (tabbed) — duplicate a tab, drag to
  reorder, switch with `Ctrl/Cmd+1..9` or `Ctrl/Cmd+Tab`, and open multiple
  independent app windows (each with their own tabs)
- Chrome-style tab groups — right-click a tab → New Tab Group… (or "Add to
  ⟨name⟩" once one exists) to cluster tabs under a named, colored label;
  click the label to collapse/expand the group, right-click it to rename,
  recolor, ungroup (keeps the tabs, just removes the label), or close the
  whole group at once
- Split-pane terminals — right-click a terminal → Split Right/Split Down to
  divide a tab into independent panes (each its own session, nestable by
  splitting again), click a pane to focus it; drag the divider between two
  panes to resize them, or hit the × in a pane's corner (or right-click →
  Close Pane) to close just that one and collapse the split back down
- Quick Connect (`Ctrl/Cmd+K`) — jump straight to a host from anywhere;
  the sidebar also has an inline filter box. Each row shows a live
  online/offline dot (a raw TCP probe against that host's port, no SSH
  handshake) so you can see what's actually reachable before connecting
- Restore tabs on launch (Settings → Startup, on by default) — reopens
  whatever hosts and local shells were open last time, reconnecting each
  automatically. Each pane also replays its recent scrollback above a
  "Previous session…" divider, Warp/browser-tab-restore style, so a restart
  feels like resuming rather than a blank prompt — a periodically-refreshed
  snapshot (capped per pane), not a full transcript
- In-terminal find (`Ctrl/Cmd+F`), right-click copy/paste/select-all/clear
- Snippets library — save frequent commands, insert into any terminal via
  right-click → Insert Snippet
- Dual-pane SFTP (local + remote side by side) — transfer either direction
  via a row's send button or by dragging it onto the other pane, drag-and-
  drop upload from the OS still works too; recursive filename search under
  a remote folder with "reveal in folder" on a result
- Server-to-server SFTP — the "Other side" picker above the left pane swaps
  it from the local machine to any other saved host, turning the browser
  into two remote panes; transfers between them (send button, right-click,
  or drag-and-drop, same as local↔remote) stream directly between the two
  SFTP sessions in the main process — the file never touches local disk
- Built-in remote file editor — double-click a text file in the SFTP
  browser (or right-click → Edit…) to edit it in place and save straight
  back over SFTP, no download/re-upload round trip (plain text, capped at
  ~2 MB — larger files still need a real download)
- Reconnect on drop — an SSH session that dies unexpectedly (network blip,
  etc.) auto-retries with backoff instead of just going dead, reusing the
  same tab; a deliberate disconnect never triggers this
- Mosh support — an opt-in per host ("Connect via Mosh" in the host editor)
  that survives network changes/drops with no visible reconnect at all
  (roaming IP, sleep/wake, switching wifi to cellular) and keeps typing
  responsive over high-latency links via local echo — the real `mosh`
  client, not a reimplementation, so it needs `mosh` installed locally and
  `mosh-server` on the remote
- SSH jump hosts — connect through another saved host as a bastion, for
  terminal sessions, SFTP, and tunnels alike
- Connection multiplexing — a second terminal tab, an SFTP browse, or a
  tunnel against a host you're already connected to reuses that one
  connection instead of opening a fresh one, same practical benefit as
  OpenSSH's ControlMaster (fewer logins on the server, instant extra
  sessions), implemented natively since this app talks SSH directly
  rather than shelling out to the system `ssh`
- Port forwarding — local, remote & dynamic (SOCKS5) SSH tunnels, managed
  from a Tunnels panel. Tick **On launch** on a tunnel and Wharf starts it by itself every time
  the app opens (one that can't start, say because the port is taken, shows its error in the panel
  and doesn't hold up the others; tunnels to the same host share one connection).
- Host-key verification against `~/.ssh/known_hosts` (trust-on-first-use,
  with a strong warning if a host's key changes)
- Status bar showing the active session's connection state and duration
- Export/import hosts & groups to/from a JSON file (secrets excluded)
- Custom title bar with working minimize/maximize/close on every platform;
  remembers window size and position between launches
- Right-click context menus throughout (hosts, groups, tabs, terminal, SFTP)
- Light/dark/system theme with an accent-color picker, plus an interface
  size control (Settings → Appearance) that scales the app's own chrome —
  sidebar, tabs, every panel — independently of terminal font size
- Terminal font size/family controls — 8 real coding fonts (JetBrains Mono,
  Fira Code, Cascadia Code, IBM Plex Mono, Source Code Pro, Roboto Mono,
  Inconsolata, Space Mono) are bundled directly rather than just named in
  CSS, so they render correctly regardless of what's installed on the host
  OS, alongside a few system-font options for anyone who prefers matching
  their platform — a sidebar collapse toggle, and 21 built-in terminal
  color themes, roughly split between soothing low-contrast light palettes
  (Solarized, Gruvbox, One, Catppuccin, Everforest, Ayu, GitHub, PaperColor)
  and balanced dark ones spanning gentle-to-vibrant (Nord, Sepia, Dracula,
  Tokyo Night, Monokai, Rosé Pine, plus the deliberately softer "dimmed"/
  "mirage" dark variants of GitHub and Ayu) — settable globally or per-tab,
  independent of the app's own theme; Settings shows a live preview
- Drag the sidebar's right edge to resize it (double-click to reset,
  drag it nearly shut to collapse — same as the explicit toggle)
- The Hosts/Tunnels/Workspaces/History/Settings switcher lives in the title
  bar, collapsible via the chevron next to it — the sidebar itself is just
  the host list, unaffected by whichever of those is open
- Import hosts straight from `~/.ssh/config` (`Include` and `Host *`
  defaults supported), reviewable before importing
- Per-session logging — record a terminal's raw output to a file, toggled
  from its right-click menu
- Keyword highlighting — built-in Error/Warning/OK/Info/Debug/IP-and-MAC
  categories plus custom regex rules, each with its own color, live in every
  terminal
- Local shell tabs — open a real local shell (your OS default shell, via a
  pty) as its own tab, no SSH or saved host involved; it's a first-class tab
  alongside SSH sessions (duplicate, logging, keyword highlighting, themes,
  all work the same)
- Command history / audit panel — a searchable log of commands typed into
  any terminal session, filterable by command or host (best-effort —
  reconstructed from keystrokes, so shell history recall and tab
  completion aren't captured exactly as run), with one-click copy and a
  Clear History button
- AI-powered autocomplete — press `Ctrl/Cmd+Space` in any terminal to ask
  your choice of **Claude, OpenAI (ChatGPT), Gemini, or a local Ollama
  server** for up to 3 completions of the command you're typing, grounded in
  your recent commands from that session; accept one with a click,
  `Tab`/`Enter`, or `1`-`3`, or dismiss with `Esc`. Pick the provider and
  add its API key in Settings → AI Autocomplete — a no-op until one is
  configured; keys are stored encrypted at rest the same way host passwords
  are, and switching providers keeps every other provider's key/settings
  intact, so you can flip back without re-entering anything. Ollama needs
  no key at all — just a base URL (defaults to `http://localhost:11434`)
  and the name of a model you've already pulled there, so autocomplete can
  run fully offline/local if you'd rather not send anything to a cloud
  provider. Every provider has an optional model override in Settings.
  Nothing is sent until you trigger a suggestion, and each request includes
  only the current line, recent command history, the host name, and your
  OS — never full command output
- Command Blocks — each command you run gets grouped with its own output as
  a distinct block in a right-side panel (right-click a terminal → Show
  Command Blocks), color-coded by real exit code (green/red), with a
  timestamp and a per-block menu: copy the command, copy just its output,
  re-run it, bookmark it, or (on a failed command) "Explain & Fix…". Driven
  by a small, standard shell-integration script (OSC 133, the same protocol
  iTerm2/VS Code/Warp use) sent to bash/zsh/fish sessions on connect — see Known
  limitations below for what that means for other shells and for SSH/Mosh.
  Toggle it off in Settings → Command Blocks if you'd rather not have it
  sent to new sessions
- AI: natural language → command — `Ctrl/Cmd+Shift+Space` in any terminal
  opens a small prompt; describe what you want in plain English and the
  configured AI provider inserts the actual shell command (pasted, never
  auto-submitted, so you can review it first)
- AI: explain & fix failed commands — from a red (non-zero exit) Command
  Block's menu, "Explain & Fix…" sends the command, its output, and exit
  code to the AI and shows a plain-English explanation plus, when it has a
  confident one, a corrected command you can insert with a click
- Workflows — a Snippet whose command contains `{{placeholder}}` tokens
  (e.g. `docker logs -f {{container}}`) becomes a small fill-in form on
  insert instead of pasting immediately; fill in the values once per use,
  same Insert Snippet flow as any other snippet
- Inline Suggestions — fish/zsh-autosuggestions-style ghost text: as you
  type, the rest of the most recent matching command from that host's
  history is shown dimmed right after the cursor; press `→` or `End` to
  accept it into the line, or keep typing to ignore it. Pure local history
  matching, no AI involved and nothing sent anywhere — instant and free.
  At an empty prompt it also predicts the next command Warp-style — whatever
  historically follows the command you just ran — for bash/zsh with Command
  Blocks enabled. Toggle it off in Settings → Inline Suggestions
- Clickable links — URLs printed to a terminal (`ls` output, logs, `git`
  remotes, anything) are clickable, opening in your default browser
- Desktop notifications — get notified when a command that ran at least
  10s finishes on a pane you're not currently looking at; click the
  notification to jump straight back to that tab. Needs Command Blocks
  (above) to know when a command finishes; toggle it off in Settings →
  Notifications
- Tags — label hosts with free-form tags in the host editor, shown as small
  pills under each host in the sidebar; click one (or just type it into the
  filter box) to filter to every host sharing it
- Broadcast Input — right-click a pane → "Broadcast Input to All Panes" to
  mirror every keystroke typed into it to every other pane in that same tab
  (a gold outline + a small icon on the tab show it's on) — handy for
  running the same command across several hosts split side by side
- Workspaces — save the tabs (and their splits) you currently have open as
  a named layout from the Workspaces panel; each pane remembers which host
  it connects to, not a live session, so opening a saved workspace later
  reconnects everything fresh with one click
- Host stats — the status bar shows live load average, memory, and disk
  usage for whichever SSH pane currently has focus, polled every 5s over a
  lightweight `exec` on its existing connection (never the interactive
  shell itself); Linux remotes only, and any field a remote doesn't support
  is just left out rather than shown as an error
- Update check — Settings → About shows the installed version and a **Check for updates** button; a
  newer release also shows as a small "Update available" pill in the status bar, which opens its
  download page. The **AppImage** build can then update itself in place: **Download and install**
  fetches the new AppImage from the GitHub release, checks it against the SHA-512 published in the
  release's `latest-linux.yml` (a mismatch is refused and nothing is replaced), swaps it in for the
  running file and restarts on **Restart to install**. Nothing downloads or installs without that
  click. A `.deb` install is owned by your package manager, so it only gets the link. A check is a
  single request to GitHub's public releases API (nothing about you or your hosts is sent); an
  installed build makes one quiet check shortly after launch unless you turn **Check on launch** off,
  and a failed background check (offline, no release yet) is only logged
- Crash recovery and logging — an unhandled renderer error shows a reload
  screen instead of a blank window, a crashed renderer reloads itself
  automatically (capped after repeated crashes in a row), and both main-
  and renderer-process activity/errors are persisted to a rotating log
  file (via [`electron-log`](https://github.com/megahertz/electron-log)) —
  "Open logs folder" in Settings → About gives you a quick way to find and
  share it if something goes wrong

## Keyboard shortcuts

The full list is also available in-app: click the **?** icon in the title bar, or press `Ctrl/Cmd+/` (works even while a terminal has focus).

| Shortcut                    | Action                                                                  |
| --------------------------- | ----------------------------------------------------------------------- |
| `Ctrl/Cmd+K`                | Quick Connect — jump to a host from anywhere                            |
| `Ctrl/Cmd+B`                | Show/hide the sidebar                                                   |
| `Ctrl/Cmd+1` … `Ctrl/Cmd+9` | Switch to tab 1 through 9                                               |
| `Ctrl/Cmd+Tab`              | Next tab                                                                |
| `Ctrl/Cmd+Shift+Tab`        | Previous tab                                                            |
| `Ctrl/Cmd+/`                | Show the keyboard shortcuts reference                                   |
| `Ctrl/Cmd+F`                | Find in the terminal                                                    |
| `Esc`                       | Close find, or dismiss the AI suggestions popup                         |
| `Ctrl/Cmd+Space`            | Ask the AI for autocomplete suggestions                                 |
| `Ctrl/Cmd+Shift+Space`      | Ask the AI to generate a command from a plain-English description       |
| `Tab` / `Enter`             | Accept the top AI suggestion                                            |
| `1` … `9`                   | Accept AI suggestion N (while the popup is open)                        |
| `→` / `End`                 | Accept the dimmed inline suggestion showing after the cursor, if any    |
| `Ctrl/Cmd+=` / `Ctrl/Cmd+-` | Increase / decrease terminal font size                                  |
| `Ctrl/Cmd+0`                | Reset terminal font size                                                |
| Right-click (terminal)      | Copy/paste/select all/clear, split pane, insert snippet, theme, logging |
| `Ctrl/Cmd+S` (file editor)  | Save the file                                                           |
| `Esc` (file editor)         | Close (asks first if there are unsaved changes)                         |
| `↑` / `↓` (pickers)         | Move the selection in Quick Connect, snippets, etc.                     |

All of these work the same whether focus is on the sidebar or inside a terminal — a handful of these key combinations (e.g. `Ctrl+3` through `Ctrl+8`, `Ctrl+K`) are also real terminal control characters that `xterm.js` would otherwise send straight to the shell, so Wharf explicitly intercepts them before that happens.

## Getting started

```bash
npm install
npm run dev        # starts Vite (renderer) + Electron together, with hot reload
```

Requires Node 20.19 or newer (or 22.12+) — Vite 8 needs it. `npm install` also compiles `node-pty` (Local Shell / Mosh) and then
verifies it loads — if that fails the install stops with instructions (usually missing build tools);
skip the check with `WHARF_SKIP_PTY_CHECK=1 npm install` if you don't need Local Shell or Mosh.

Other scripts:

```bash
npm run typecheck     # tsc --noEmit for both renderer and main
npm test              # vitest unit tests (src/**/*.test.ts)
npm run lint          # eslint
npm run format:check  # prettier --check (npm run format fixes in place)
npm run build         # production build of renderer + main into dist-electron/
npm run package       # build + electron-builder (produces installers in release/; never publishes)
npm run smoke         # launch the packaged app and check it works (needs a display; see below)
```

### Tests and CI

Unit tests live next to the code they cover (`*.test.ts`) and run on plain Node — no Electron needed.
They currently cover the security- and data-sensitive modules: `knownHosts.ts` (host-key
verification), `secretStore.ts` (encrypt/decrypt and the decrypt-failure error), `sshConfigParser.ts`
(`~/.ssh/config` import), `shellIntegration.ts` (the OSC 133 hooks, which are exercised against
real `bash`, `fish` and, when installed, `zsh`), `dataFileRecovery.ts` (moving a corrupt data file aside),
`windowBounds.ts` (is a saved window position still on a connected display), `dataFilePermissions.ts`
(owner-only data file), `security.ts`
(which URLs may be opened and which permissions are granted) `updateCheck.ts`
(version comparison and the release-check responses) and `selfUpdate.ts` (the in-place update's
states and guards, with the updater stubbed).

The SSH stack is tested end to end against a **real SSH server running inside the test process**
(`src/main/testing/sshTestServer.ts`, built on `ssh2`'s `Server`), not mocks: `sshManager.test.ts`
(shell sessions, resize, wrong password, rejected host key, one connection shared by several
sessions, jump hosts, reconnect after a dropped connection), `sftpManager.test.ts` (listing, editing,
file operations, upload/download with progress, server-to-server copy, search limits) and
`tunnelManager.test.ts` (local, remote and SOCKS5 forwarding, port conflicts, restart after a drop,
starting marked tunnels at launch).
Only Electron's windows, the saved-host and secret stores and the interactive host-key prompt are
stubbed. Test files and the test server are excluded from the packaged app, but `npm run typecheck`
still type-checks them.

The renderer's plain-TypeScript logic is tested too, on Node with a small fake of xterm.js's
terminal (`src/renderer/testing/fakeXterm.ts`): Command Blocks' OSC 133 state machine, keyword
highlighting, keystroke capture, inline history/next-command suggestions, the local-path helpers and
the SFTP drag payload. The React components themselves have no automated tests yet.

**Launch smoke test.** `npm run smoke` (`scripts/smoke-test.mjs`) starts the packaged app from
`release/linux-unpacked/wharf` with a throwaway profile and drives it over the Chrome DevTools
Protocol. It checks that the UI mounts, the preload bridge and an IPC round trip work, a local
shell (node-pty) runs a command, nothing threw in the renderer, a log file was written, and the app
quits cleanly, and that the binary's security fuses are set. These are the failures the Node-based
tests can't see, such as a file missing from the asar or a native module that doesn't load in the
packaged build. It needs a display: on a headless
machine run `xvfb-run -a npm run smoke`. Set `SMOKE_NO_SANDBOX=1` where the unpacked `chrome-sandbox`
isn't setuid root (containers, CI; it's applied automatically as root) and `SMOKE_SCREENSHOT=file.png`
to save a screenshot.

GitHub Actions (`.github/workflows/ci.yml`) runs lint, format check, typecheck, tests, build and a
full Linux `npm run package` on every pull request and every push to `main`, then runs the smoke
test against the unpacked build and uploads the `.AppImage` and `.deb` as build artifacts. It runs
with a read-only `GITHUB_TOKEN`, and fails if `npm audit --omit=dev` reports a high or critical
advisory in a runtime dependency. Dependabot (`.github/dependabot.yml`) opens a weekly PR for npm and
GitHub Actions updates, with minor and patch updates grouped.

## Installing on Ubuntu / Debian

`npm run package` builds both a `.deb` and a portable `AppImage` into `release/` (run this on the
Ubuntu machine you want to install on — it produces a native x64 Linux build, it doesn't cross-compile):

```bash
npm run package
```

**`.deb` (recommended — integrates with the app menu, installs to `/opt/Wharf`):**

```bash
sudo apt install ./release/wharf_0.1.0_amd64.deb
# or: sudo dpkg -i release/wharf_0.1.0_amd64.deb && sudo apt-get install -f
```

Launch it from your app menu ("Wharf") or by running `wharf` in a terminal. Uninstall with
`sudo apt remove wharf`.

**AppImage (no install, no root needed):**

```bash
chmod +x release/Wharf-0.1.0.AppImage
./release/Wharf-0.1.0.AppImage
```

If it fails to start with a `SUID sandbox helper binary` error, your kernel restricts
unprivileged user namespaces (the default on some newer distros) and the AppImage has no install
step to fix that itself the way the `.deb` package does — run it with `--no-sandbox` instead:
`./release/Wharf-0.1.0.AppImage --no-sandbox`.

## Releasing

Releases are cut by pushing a version tag; `.github/workflows/release.yml` does the rest. It builds on
Linux, Windows and macOS in parallel (each runs the same audit, lint, format, typecheck and tests as CI,
then `npm run package` and the launch smoke test on the packaged build), and only if all three pass does
one job publish a single GitHub Release containing:

| Platform | Files                                                                                |
| -------- | ------------------------------------------------------------------------------------ |
| Linux    | `Wharf-x.y.z.AppImage`, the `.deb`, `latest-linux.yml`                               |
| Windows  | `Wharf-Setup-x.y.z.exe`, `latest.yml`                                                |
| macOS    | `Wharf-x.y.z-arm64.dmg` (Apple Silicon), `Wharf-x.y.z.dmg` (Intel), `latest-mac.yml` |
| All      | `SHA256SUMS`                                                                         |

```bash
npm version 0.2.0 --no-git-tag-version   # bumps package.json and the lockfile
git commit -am "Release 0.2.0"           # merge this to main first
git tag v0.2.0 && git push origin v0.2.0
```

The workflow refuses to publish if the tag doesn't match `package.json`'s version, uses only the
built-in `GITHUB_TOKEN` (no personal access token), and treats a tag with a hyphen (`v0.2.0-rc.1`) as a
pre-release — which the in-app update check ignores. `latest-linux.yml` is what the AppImage's in-place
update reads to find the new file and its checksum (Windows and macOS builds don't update themselves yet).
To rehearse without publishing, run it by hand from the Actions tab (**Release → Run workflow**, pick the
branch): it builds all three and uploads the files as workflow artifacts only. Downloaders can check a
file with `sha256sum -c SHA256SUMS`.

### Code signing (optional, off until you add secrets)

Without any secrets the Windows and macOS packages are **unsigned**: they run, but Windows SmartScreen
says "Windows protected your PC" and macOS Gatekeeper refuses the DMG until the user right-clicks → Open.
The workflow signs automatically once these exist. Store them as secrets of a GitHub
[Environment](https://docs.github.com/actions/deployment/targeting-different-environments) named
`release` (tag builds run in it, so you can require reviewers; rehearsals can't reach them):

| Secret                                                     | What                                                                                   |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`                     | Windows Authenticode certificate (`.pfx`, base64-encoded) and its password             |
| `CSC_LINK`, `CSC_KEY_PASSWORD`                             | macOS "Developer ID Application" certificate (`.p12`, base64-encoded) and its password |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | Notarization (needs the Apple Developer Program)                                       |

A signed build is then verified (`codesign`/`spctl` on macOS, `Get-AuthenticodeSignature` on Windows) and
the job fails if the signature isn't valid. macOS is notarized when the `APPLE_*` secrets are present; the
hardened-runtime entitlements Electron and node-pty need are electron-builder's defaults. The signing
paths have not been exercised yet (no certificates were available when this was written), so rehearse
with a pre-release tag and install the result on a clean machine before relying on it. Azure Trusted
Signing for Windows would need a few extra lines under `win:` in `electron-builder.yml`.

## Data, logs, and recovery

On Linux everything lives in `~/.config/Wharf/`:

- `wharf-data.json` — hosts, groups, tunnels, snippets, workspaces, settings and the (encrypted)
  secrets. Passwords and key passphrases are encrypted with the OS keychain via Electron's
  `safeStorage`; see the known limitation below for systems without one. The file and this folder
  are readable and writable by your user only (mode 600 / 700); earlier versions created the file
  world-readable, and Wharf tightens an existing one on launch.
- `logs/main.log` — a log of app activity and errors from both the main process and the renderer's
  console, rotated at 1 MB (the previous file is kept as `main.old.log`). **Settings → About → Open
  logs folder** opens it — attach this file when reporting a problem.

What Wharf does when things go wrong, instead of failing silently or crashing:

- **Corrupted data file** (e.g. a crash or full disk mid-write): it is moved aside to
  `wharf-data.json.corrupted-<timestamp>`, Wharf starts with defaults, and a dialog tells you where the
  original is so nothing is silently discarded.
- **A saved password can't be decrypted** (e.g. the data was copied to another machine or user, or the
  Linux keyring was reset): connecting shows "Couldn't decrypt the saved password/passphrase … re-enter
  it by editing the host"; the underlying error is in the log.
- **Window saved on a monitor that's gone**: the saved position is ignored if it isn't on any connected
  display (the saved size is kept), so the window can't open unreachably off-screen.
- **Renderer crash or unhandled UI error**: the window reloads itself (up to 3 times in a row before
  asking you to restart), and an error screen offers Reload / Copy details. Failing to save the window
  position (e.g. disk full) is logged and ignored rather than crashing the app.
- **Launching Wharf a second time** focuses the already-running window instead of starting a second
  process, because two instances would write the same data file.

## Project structure

```
src/
  main/                  Electron main process (Node)
    index.ts             App entry: single-instance lock, crash/log handlers, window creation,
                          IPC registration
    preload.ts            contextBridge: exposes window.wharf to the renderer
                           (bundled to a single file via esbuild — see below)
    ipc/                  One module per IPC surface (hosts, groups, ssh, sftp, tunnels, window,
                          clipboard, backup, snippets, shell, ai, ...)
    services/
      store.ts             electron-store wrapper (hosts/groups/tunnels/snippets/window bounds),
                            with corrupt-data-file recovery
      secretStore.ts        safeStorage-backed secret storage (passwords/passphrases)
      sshManager.ts          ssh2 connection + shell session manager (incl. jump-host chaining,
                              reconnect-on-drop with backoff)
      connectionPool.ts       shared SSH connections (sessions, SFTP and tunnels to a host reuse one)
      localShellManager.ts    node-pty local shell session manager (Local Shell tabs)
      moshManager.ts          Mosh sessions via the system `mosh` client
      sftpManager.ts         ssh2 SFTP subsystem wrapper, pooled per host
      tunnelManager.ts       local/remote/dynamic SSH port forwarding
      knownHosts.ts           ~/.ssh/known_hosts-compatible host-key verification (TOFU)
      sshConfigParser.ts      ~/.ssh/config parser for the import dialog
      updateCheck.ts          GitHub releases "is there a newer version" check
      selfUpdate.ts           in-place update for the AppImage build (electron-updater)
      shellIntegration.ts     OSC 133 bash/zsh/fish hooks behind Command Blocks and exit codes
      dataFileRecovery.ts     moves a corrupt wharf-data.json aside before the store loads it
      windowBounds.ts         is a saved window position still on a connected display
      dataFilePermissions.ts  makes the data file and folder owner-only
      security.ts             allowed external URLs and web permissions (deny by default)
      aiSuggest.ts            AI autocomplete / explain / generate (provider SDKs loaded lazily)
      *.test.ts               vitest tests, next to the module they cover
  renderer/               React UI (Vite)
    testing/               fakeXterm.ts, a test-only stand-in for xterm.js's Terminal
    components/            TitleBar, Sidebar, HostDialog, GroupDialog, Terminal, SftpBrowser,
                            Tunnels, Settings, QuickConnect, ContextMenu, SnippetPicker,
                            ErrorBoundary, StatusBar, Icons, ...
    state/
      store.ts              zustand store (hosts, groups, tunnels, snippets, open terminal tabs)
      themeStore.ts           theme mode + accent color, persisted to localStorage
    api/wharf.ts             Thin wrapper over window.wharf
  shared/                 Types shared between main & renderer (no Node/DOM APIs)
    types.ts                Domain types + IPC channel name constants
    api.ts                   window.wharf contract (WharfApi interface)
src/main/testing/
  sshTestServer.ts        in-process SSH/SFTP/port-forwarding server for the integration tests
scripts/
  verify-pty.js          postinstall check that node-pty actually loads under Electron
  smoke-test.mjs         launches the packaged app and checks it works (npm run smoke)
.github/workflows/ci.yml  audit, lint, format, typecheck, test, build, package and smoke test on every PR
.github/dependabot.yml    weekly npm and GitHub Actions update PRs
```

## Known limitations

- When a shared connection drops, every session/SFTP-browse/tunnel that
  was using it reconnects independently, each through the same shared
  pool. Anything that asks for the host while a dial to it is already in
  progress waits for that dial and shares it, so they end up back on one
  connection; the catch is that each one decides to reconnect on its own
  backoff schedule, so a session whose retry comes later than the others'
  simply joins the connection they re-established.
- Secrets fall back to a weaker (base64, clearly marked) storage format on
  Linux systems with no OS keychain/secret-service available, since
  Electron's `safeStorage.isEncryptionAvailable()` can return false there.
  This is no longer silent: Settings shows a warning (and the host dialog a note next to the
  password field) whenever it applies, `wharf-data.json` and its folder are owner-only, and the
  next launch after you install and unlock a keyring re-encrypts what was saved. What Wharf
  doesn't have is a master password for machines that will never have a keyring; an SSH agent or
  a key without a passphrase avoids storing anything.
- `knownHosts.ts` supports exact-host and `*`/`?` glob patterns (including
  `!negation`), `[host]:port`, hashed (`HashKnownHosts`) entries, and `@revoked`
  (a revoked key is always refused, with no "trust anyway" option, even if
  it matches the host). CIDR ranges aren't part of the known_hosts format
  (OpenSSH only uses them for `Match Address` and `from=`), so there is
  nothing to add there. `@cert-authority` (CA-signed host certificates) is
  recognized but can't be used: checking a host certificate means negotiating
  the `*-cert-v01@openssh.com` host-key algorithms, which the SSH library
  (ssh2, including its latest release) doesn't offer, so the server only ever
  sends its plain key. A host covered by such a line is treated as unknown and
  gets the normal trust prompt, with a note saying why; the CA's key is never
  accepted as the host's own.
- Local shell tabs use [`node-pty`](https://github.com/microsoft/node-pty),
  a native addon that has to compile during `npm install` (it has no
  prebuilt binary for Linux). `postinstall` (`scripts/verify-pty.js`) checks
  right away whether it actually loads under Electron's own runtime and
  fails the install loudly if not, rather than silently shipping a broken
  Local Shell/Mosh discovered later at runtime. A failure almost always
  means missing build tools — install them (`sudo apt install build-essential python3` on Debian/Ubuntu,
  `sudo dnf groupinstall "Development Tools" && sudo dnf install python3` on Fedora/RHEL) and
  reinstall (`rm -rf node_modules/node-pty && npm install`). If you're
  working on SSH/SFTP only and don't need Local Shell or Mosh right now,
  skip the check with `WHARF_SKIP_PTY_CHECK=1 npm install`. If it does fail
  at runtime anyway (e.g. after the check was skipped), Local Shell/Mosh
  tabs show a clear error instead of crashing the app, and everything else
  keeps working.
- AI autocomplete requires your own API key for whichever cloud provider
  you pick (Claude, OpenAI, or Gemini) plus outbound network access to
  that provider's API — Ollama is the exception, running fully local
  against a server you start yourself (`ollama serve`) with a model you've
  pulled (`ollama pull <model>`). Cloud providers cost a small amount of
  API usage per suggestion you trigger (nothing runs automatically). The
  built-in default model per provider is a reasonable, fast/cheap choice
  as of this app's release, but provider model lineups change — override
  it in Settings if a default ever 404s or is deprecated. Suggestions are
  only as good as the model's read of your current line and recent
  commands — always review a suggestion before accepting it, the same as
  you would tab-completion.
- Mosh support spawns the real `mosh` CLI as a pty (not a reimplementation
  of its UDP-based protocol) — so it requires `mosh` installed on this
  machine and `mosh-server` installed on the remote host; Wharf can't
  install either for you. Auth still goes through Mosh's own SSH bootstrap:
  an SSH agent or an unencrypted private key is fully transparent, a saved
  password or key passphrase is auto-filled the first time such a prompt
  appears (falls back to typing it yourself if that's ever missed), and
  host-key verification for a never-before-seen host is the real `ssh`
  binary's own interactive prompt shown live in the terminal — not Wharf's
  own TOFU dialog, and not (yet) `-J`-chained through Wharf's own jump-host
  known_hosts handling. Jump hosts and non-default ports ARE passed through
  to the underlying ssh command, same as a direct connection would use.
- Command Blocks (and the AI's "Explain & Fix…") need the session's shell
  to support the OSC 133 shell-integration hooks Wharf sends — currently
  bash, zsh and fish; any other shell (a restricted shell, dash, PowerShell, etc.) just
  never emits the block-boundary sequences, so the panel stays empty and
  nothing else about the session is affected. fish 4 and later write these sequences
  themselves, so Wharf installs nothing there (the block's command text then comes from
  what was typed rather than from the shell, since fish's own marker doesn't carry it);
  on fish 3 Wharf's hooks wrap your own `fish_prompt`. A remote fish older than 3.4
  can't parse the one-line bootstrap (no `$(…)` syntax) and prints a syntax error once
  at connect. For a local shell tab the
  integration script loads invisibly (via `--rcfile`/`ZDOTDIR`/`--init-command`); for SSH and
  Mosh sessions — where Wharf doesn't control how the remote shell starts —
  it's delivered as one base64 line of real typed input shortly after
  connect, so it's visible once in the terminal/scrollback by design (hiding
  it risked eating real output like a MOTD). A block's output is read live
  from the terminal's own scrollback between its start/end markers — once
  either marker scrolls out of the retained scrollback, the block still
  shows its command and exit code, just without recoverable output text.
- Re-running a block, or inserting an AI-generated/explained-fix command,
  pastes it into the terminal rather than typing it keystroke-by-keystroke
  — a re-run auto-submits (it's a command you already ran once), but a
  generated or suggested-fix command is only ever pasted for you to review,
  never auto-submitted.
- Inline Suggestions match against this host's own command history only
  (never across unrelated hosts, same scoping the AI features' "recent
  commands" context already uses) and only while the cursor is genuinely at
  the end of the current line — same best-effort limits as command-history
  capture generally (arrow-key history recall, Tab completion): moving the
  cursor with an arrow key clears the suggestion rather than risk it landing
  in the wrong spot. For a remote session, the suggestion updates in the
  same lockstep as your own typed characters already do (both wait on the
  shell's echo), so it can lag slightly on a high-latency connection.
- Server-to-server SFTP transfers one file at a time (same as local↔remote
  — dragging/sending a folder isn't recursive); progress shows in the
  destination pane only, and both hosts' connections go through the same
  known_hosts/jump-host handling normal browsing already uses.

## Security notes

- Dependency audit: `npm audit --omit=dev` (what ships in the packaged app) reports **0** vulnerabilities.
  `npm audit` still lists 8 moderate findings, all in the build-time `electron-builder` chain, all one
  flaw: `sprintf-js` (a denial of service via unbounded precision specifiers), pulled in through
  `@electron/get → global-agent → roarr`. Every released `sprintf-js` version is affected, so there is
  nothing to upgrade to, and npm's suggested "fix" is a downgrade of `electron-builder` that doesn't
  remove it. It only runs on a developer or CI machine while downloading Electron, never in the app.
  Re-check after `electron-builder` updates; the Vite, Vitest and esbuild findings that used to appear
  here were resolved by upgrading those tools.
- SSH host keys are checked against `~/.ssh/known_hosts` on every connection
  (shell, jump-host, SFTP, tunnels all share this via `buildConnectConfig`).
  A new host prompts a trust-on-first-use dialog; a key that has changed
  since last time shows a strong "possible MITM" warning instead of
  silently reconnecting.
- Renderer runs with `contextIsolation: true`, `nodeIntegration: false`,
  `sandbox: true`; all filesystem/SSH/SFTP access happens in the main
  process behind the typed `window.wharf` bridge in `preload.ts`.
- Because the renderer is sandboxed, `preload.ts` can't `require()` local
  project files the normal Node way — it's bundled into a single
  self-contained file with esbuild (`npm run build:preload`) so it has no
  relative imports left to resolve at runtime.
- Host passwords and key passphrases are never written to disk in
  plaintext; only their `secretId` reference lives on the `HostRecord`. Without an OS keyring they
  are only base64-encoded, and Wharf says so in Settings (see Known limitations).
- The data file is created owner-only (mode 600, folder 700). The store library's default is
  world-readable, which would have exposed every saved host (and any base64-stored password) to
  other users of the machine and let them rewrite it. The launch smoke test fails if the packaged
  app ever leaves it looser.
- `will-navigate` and `setWindowOpenHandler` are locked down so a
  compromised or malicious remote shell can't pivot into opening arbitrary
  URLs inside the app. Links that do open in the browser (terminal links, the update
  pill) must be `http(s)`: `file:`, `smb:` and other schemes the OS would hand to some
  registered program are refused (`src/main/security.ts`).
- Web permissions are denied by default. Electron otherwise grants everything Chromium
  asks for (location, camera, microphone, MIDI, ...), and Wharf needs none of it except
  desktop notifications for finished commands, which are allowed for the app's own page
  only. The launch smoke test checks this against the packaged app.
- The packaged binary has Electron fuses flipped (`electronFuses` in `electron-builder.yml`):
  `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` and `--inspect` are ignored, so the installed `wharf`
  executable can't be reused as a general-purpose Node.js runtime or debugged from outside, and
  it only loads the app from `app.asar`. Two are left at their defaults on purpose: file-protocol
  privileges (the UI is loaded from `file://`) and ASAR integrity validation (not supported on
  Linux). The smoke test fails if any of this is switched back.
- The log file captures the renderer's `console.*` output as well as the main process's, so nothing
  that touches a password, key passphrase, API key or terminal content should ever be passed to
  `console.*` or `log.*`. Today's log calls are limited to error objects and event descriptions.
- The only network request Wharf makes on its own is the optional launch-time update check described
  above (to `api.github.com`, through the system's proxy settings). Downloading an update happens only
  when you click it. It trusts the same thing downloading the file by hand does, the release on this
  repository's GitHub page, plus the checksum in `latest-linux.yml`; there is no code signature to
  check on Linux, so anyone who can publish a release can ship an update; hosts you connect to, AI providers
  you configure, and your Ollama server are contacted only when you use those features. The returned
  release link is only ever opened if it points at this repository on github.com.
- Only one Wharf process may run per user (single-instance lock), so the data file never has two
  concurrent writers.
