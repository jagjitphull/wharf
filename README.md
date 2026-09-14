# Wharf

A personal SSH/SFTP terminal client, Termius-style.

- **Desktop app:** Electron + React + TypeScript
- **Terminal:** [xterm.js](https://xtermjs.org/) over a live SSH shell ([ssh2](https://github.com/mscdex/ssh2))
- **SFTP:** full file browser (list/upload/download/mkdir/rmdir/rename/delete) over the same `ssh2` connection
- **Storage:** local JSON store (`electron-store`) for hosts/groups/tunnels; secrets (passwords, key passphrases) encrypted at rest via Electron's `safeStorage` (OS keychain)

## Features

- Save hosts, organize them into (nested) groups
- Connect via password, private key, or SSH agent auth
- Multiple concurrent terminal sessions (tabbed)
- Full SFTP file browser per host
- SSH jump hosts — connect through another saved host as a bastion
- Port forwarding — local & remote SSH tunnels, managed from a Tunnels panel

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

## Project structure

```
src/
  main/                  Electron main process (Node)
    index.ts             App entry: window creation, IPC registration
    preload.ts            contextBridge: exposes window.wharf to the renderer
                           (bundled to a single file via esbuild — see below)
    ipc/                  One module per IPC surface (hosts, groups, ssh, sftp, tunnels)
    services/
      store.ts             electron-store wrapper (hosts/groups/tunnels)
      secretStore.ts        safeStorage-backed secret storage (passwords/passphrases)
      sshManager.ts          ssh2 connection + shell session manager (incl. jump-host chaining)
      sftpManager.ts         ssh2 SFTP subsystem wrapper, pooled per host
      tunnelManager.ts       local/remote SSH port forwarding
  renderer/               React UI (Vite)
    components/            Sidebar, HostDialog, GroupDialog, Terminal, SftpBrowser, Tunnels, Settings
    state/store.ts          zustand store (hosts, groups, tunnels, open terminal tabs)
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

## Security notes

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
