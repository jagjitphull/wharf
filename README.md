# Wharf

A personal SSH/SFTP terminal client, Termius-style.

- **Desktop app:** Electron + React + TypeScript
- **Terminal:** [xterm.js](https://xtermjs.org/) over a live SSH shell ([ssh2](https://github.com/mscdex/ssh2))
- **SFTP:** full file browser (list/upload/download/mkdir/rmdir/rename/delete) over the same `ssh2` connection
- **Storage:** local JSON store (`electron-store`) for hosts/groups/tunnels; secrets (passwords, key passphrases) encrypted at rest via Electron's `safeStorage` (OS keychain)

## Features

- Save hosts, organize them into (nested) groups
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
- Built-in remote file editor — double-click a text file in the SFTP
  browser (or right-click → Edit…) to edit it in place and save straight
  back over SFTP, no download/re-upload round trip (plain text, capped at
  ~2 MB — larger files still need a real download)
- Reconnect on drop — an SSH session that dies unexpectedly (network blip,
  etc.) auto-retries with backoff instead of just going dead, reusing the
  same tab; a deliberate disconnect never triggers this
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

- Connection multiplexing only applies at connect time. If a shared
  connection drops, every session/SFTP-browse/tunnel that was using it
  reconnects independently rather than being re-multiplexed with each
  other — each just gets its own connection back. A later new session to
  that host can still multiplex with whichever one happened to reconnect
  first.
- Secrets fall back to a weaker (base64, clearly marked) storage format on
  Linux systems with no OS keychain/secret-service available, since
  Electron's `safeStorage.isEncryptionAvailable()` can return false there.
- `knownHosts.ts` supports exact-host and simple `*`/`?` glob patterns plus
  hashed (`HashKnownHosts`) entries, but not the full OpenSSH known_hosts
  spec (no `!negation`, CIDR ranges, or `@cert-authority`/`@revoked`
  markers).
- Local shell tabs use [`node-pty`](https://github.com/microsoft/node-pty),
  a native addon that must be compiled against Electron's own Node ABI (not
  your system Node's). `npm install` does this automatically via
  `postinstall` (`npm run rebuild-native`, which shells out to
  `electron-rebuild`); if that step fails — no network access, no build
  toolchain — Local Shell tabs fail with a clear error instead of crashing
  the app, and everything else keeps working. Re-run
  `npm run rebuild-native` after fixing whatever blocked it, or after
  upgrading Electron.

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
