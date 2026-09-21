# Wharf

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
- Split-pane terminals — right-click a terminal → Split Right/Split Down to
  divide a tab into independent panes (each its own session, nestable by
  splitting again), click a pane to focus it, right-click → Close Pane to
  collapse back down
- Quick Connect (`Ctrl/Cmd+K`) — jump straight to a host from anywhere;
  the sidebar also has an inline filter box
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
  from a Tunnels panel
- Host-key verification against `~/.ssh/known_hosts` (trust-on-first-use,
  with a strong warning if a host's key changes)
- Status bar showing the active session's connection state and duration
- Export/import hosts & groups to/from a JSON file (secrets excluded)
- Custom title bar with working minimize/maximize/close on every platform;
  remembers window size and position between launches
- Right-click context menus throughout (hosts, groups, tabs, terminal, SFTP)
- Light/dark/system theme with an accent-color picker
- Terminal font size/family controls, a sidebar collapse toggle, and 9
  built-in terminal color themes (Solarized, Nord, Gruvbox, Dracula, and
  more) — settable globally or per-tab, independent of the app's own theme
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
  iTerm2/VS Code/Warp use) sent to bash/zsh sessions on connect — see Known
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
  Toggle it off in Settings → Inline Suggestions

## Keyboard shortcuts

The full list is also available in-app: click the **?** icon in the title bar, or press `Ctrl/Cmd+/` (works even while a terminal has focus).

| Shortcut | Action |
| --- | --- |
| `Ctrl/Cmd+K` | Quick Connect — jump to a host from anywhere |
| `Ctrl/Cmd+B` | Show/hide the sidebar |
| `Ctrl/Cmd+1` … `Ctrl/Cmd+9` | Switch to tab 1 through 9 |
| `Ctrl/Cmd+Tab` | Next tab |
| `Ctrl/Cmd+Shift+Tab` | Previous tab |
| `Ctrl/Cmd+/` | Show the keyboard shortcuts reference |
| `Ctrl/Cmd+F` | Find in the terminal |
| `Esc` | Close find, or dismiss the AI suggestions popup |
| `Ctrl/Cmd+Space` | Ask the AI for autocomplete suggestions |
| `Ctrl/Cmd+Shift+Space` | Ask the AI to generate a command from a plain-English description |
| `Tab` / `Enter` | Accept the top AI suggestion |
| `1` … `9` | Accept AI suggestion N (while the popup is open) |
| `→` / `End` | Accept the dimmed inline suggestion showing after the cursor, if any |
| `Ctrl/Cmd+=` / `Ctrl/Cmd+-` | Increase / decrease terminal font size |
| `Ctrl/Cmd+0` | Reset terminal font size |
| Right-click (terminal) | Copy/paste/select all/clear, split pane, insert snippet, theme, logging |
| `Ctrl/Cmd+S` (file editor) | Save the file |
| `Esc` (file editor) | Close (asks first if there are unsaved changes) |
| `↑` / `↓` (pickers) | Move the selection in Quick Connect, snippets, etc. |

All of these work the same whether focus is on the sidebar or inside a terminal — a handful of these key combinations (e.g. `Ctrl+3` through `Ctrl+8`, `Ctrl+K`) are also real terminal control characters that `xterm.js` would otherwise send straight to the shell, so Wharf explicitly intercepts them before that happens.

## Getting started

```bash
npm install
npm run dev        # starts Vite (renderer) + Electron together, with hot reload
```

Other scripts:

```bash
npm run typecheck  # tsc --noEmit for both renderer and main
npm run build      # production build of renderer + main into dist-electron/
npm run package    # build + electron-builder (produces installers in release/)
```

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

## Project structure

```
src/
  main/                  Electron main process (Node)
    index.ts             App entry: window creation, IPC registration
    preload.ts            contextBridge: exposes window.wharf to the renderer
                           (bundled to a single file via esbuild — see below)
    ipc/                  One module per IPC surface (hosts, groups, ssh, sftp, tunnels, window,
                          clipboard, backup, snippets)
    services/
      store.ts             electron-store wrapper (hosts/groups/tunnels/snippets/window bounds)
      secretStore.ts        safeStorage-backed secret storage (passwords/passphrases)
      sshManager.ts          ssh2 connection + shell session manager (incl. jump-host chaining,
                              reconnect-on-drop with backoff)
      localShellManager.ts    node-pty local shell session manager (Local Shell tabs)
      sftpManager.ts         ssh2 SFTP subsystem wrapper, pooled per host
      tunnelManager.ts       local/remote SSH port forwarding
      knownHosts.ts           ~/.ssh/known_hosts-compatible host-key verification (TOFU)
      sshConfigParser.ts      ~/.ssh/config parser for the import dialog
  renderer/               React UI (Vite)
    components/            TitleBar, Sidebar, HostDialog, GroupDialog, Terminal, SftpBrowser,
                            Tunnels, Settings, QuickConnect, ContextMenu, SnippetPicker,
                            StatusBar, Icons
    state/
      store.ts              zustand store (hosts, groups, tunnels, snippets, open terminal tabs)
      themeStore.ts           theme mode + accent color, persisted to localStorage
    api/wharf.ts             Thin wrapper over window.wharf
  shared/                 Types shared between main & renderer (no Node/DOM APIs)
    types.ts                Domain types + IPC channel name constants
    api.ts                   window.wharf contract (WharfApi interface)
```

## Known limitations

- When a shared connection drops, every session/SFTP-browse/tunnel that
  was using it reconnects independently and through the same shared pool
  — so a session that reconnects quickly can end up sharing its new
  connection with others reconnecting to the same host afterward (or with
  a brand new tab opened to that host during the outage), but two
  sessions that both drop and start reconnecting at essentially the same
  instant will usually each dial their own fresh connection rather than
  perfectly re-grouping onto one, since neither's dial is done yet when
  the other starts (the same inherent race as two simultaneous first-time
  connects to a host that was never pooled before).
- Secrets fall back to a weaker (base64, clearly marked) storage format on
  Linux systems with no OS keychain/secret-service available, since
  Electron's `safeStorage.isEncryptionAvailable()` can return false there.
- `knownHosts.ts` supports exact-host and `*`/`?` glob patterns (including
  `!negation`), hashed (`HashKnownHosts`) entries, and `@revoked` (a
  revoked key is always refused, with no "trust anyway" option, even if
  it matches the host), but not the full OpenSSH known_hosts spec — no
  CIDR ranges or `@cert-authority` (CA-signed host certificates).
- Local shell tabs use [`node-pty`](https://github.com/microsoft/node-pty),
  a native addon that must be compiled against Electron's own Node ABI (not
  your system Node's). `npm install` does this automatically via
  `postinstall` (`npm run rebuild-native`, which shells out to
  `electron-rebuild`); if that step fails — no network access, no build
  toolchain — Local Shell tabs fail with a clear error instead of crashing
  the app, and everything else keeps working. Re-run
  `npm run rebuild-native` after fixing whatever blocked it, or after
  upgrading Electron.
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
  bash and zsh only; any other shell (fish, a restricted shell, etc.) just
  never emits the block-boundary sequences, so the panel stays empty and
  nothing else about the session is affected. For a local shell tab the
  integration script loads invisibly (via `--rcfile`/`ZDOTDIR`); for SSH and
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
  plaintext; only their `secretId` reference lives on the `HostRecord`.
- `will-navigate` and `setWindowOpenHandler` are locked down so a
  compromised or malicious remote shell can't pivot into opening arbitrary
  URLs inside the app.
