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
- Quick Connect (`Ctrl/Cmd+K`) — jump straight to a host from anywhere;
  the sidebar also has an inline filter box
- In-terminal find (`Ctrl/Cmd+F`), right-click copy/paste/select-all/clear
- Snippets library — save frequent commands, insert into any terminal via
  right-click → Insert Snippet
- Full SFTP file browser per host, with drag-and-drop upload from the OS
- SSH jump hosts — connect through another saved host as a bastion
- Port forwarding — local & remote SSH tunnels, managed from a Tunnels panel
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
      sshManager.ts          ssh2 connection + shell session manager (incl. jump-host chaining)
      sftpManager.ts         ssh2 SFTP subsystem wrapper, pooled per host
      tunnelManager.ts       local/remote SSH port forwarding
      knownHosts.ts           ~/.ssh/known_hosts-compatible host-key verification (TOFU)
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

- **Dynamic (SOCKS5) tunnels** are defined in the data model (`TunnelType`)
  but `tunnelManager.start()` throws for them — only `local` and `remote`
  forwarding are implemented. A SOCKS5 listener is a reasonable next step.
- **SFTP doesn't chain through jump hosts** — it opens a direct connection
  to the target host. Shell sessions do support jump hosts via
  `client.forwardOut`; extending that to `sftpManager` is a small follow-up
  (reuse `sshManager.getClientForSession`-style plumbing).
- Secrets fall back to a weaker (base64, clearly marked) storage format on
  Linux systems with no OS keychain/secret-service available, since
  Electron's `safeStorage.isEncryptionAvailable()` can return false there.
- `knownHosts.ts` supports exact-host and simple `*`/`?` glob patterns plus
  hashed (`HashKnownHosts`) entries, but not the full OpenSSH known_hosts
  spec (no `!negation`, CIDR ranges, or `@cert-authority`/`@revoked`
  markers).

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
