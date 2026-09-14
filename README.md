# Wharf

A Termius-like SSH/SFTP terminal client, built as a starter you can extend: a
free core plus a gated **Pro** tier with real licensing groundwork (not just
a UI stub).

- **Desktop app:** Electron + React + TypeScript
- **Terminal:** [xterm.js](https://xtermjs.org/) over a live SSH shell ([ssh2](https://github.com/mscdex/ssh2))
- **SFTP:** full file browser (list/upload/download/mkdir/rmdir/rename/delete) over the same `ssh2` connection
- **Storage:** local JSON store (`electron-store`) for hosts/groups/tunnels/license; secrets (passwords, key passphrases) encrypted at rest via Electron's `safeStorage` (OS keychain)
- **Licensing:** Ed25519-signed license keys, verified fully offline — no backend required to try Pro features

## Features

**Free (starter) tier**

- Save hosts, organize them into (nested) groups
- Connect via password, private key, or SSH agent auth
- Multiple concurrent terminal sessions (tabbed)
- Full SFTP file browser per host
- Free tier limits: up to **5 hosts** and **2 groups** (`src/shared/types.ts` → `FREE_TIER_LIMITS`)

**Pro tier** (gated behind a signed license — see [Licensing](#licensing))

- Unlimited hosts & groups
- **Jump hosts** — connect through another saved host as an SSH bastion
- **Port forwarding** — local & remote SSH tunnels, managed from a Tunnels panel
- (`teamSync` feature id reserved for a future team-sync feature — not implemented yet)

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
    ipc/                  One module per IPC surface (hosts, groups, ssh, sftp, tunnels, license)
    services/
      store.ts             electron-store wrapper (hosts/groups/tunnels/license)
      secretStore.ts        safeStorage-backed secret storage (passwords/passphrases)
      sshManager.ts          ssh2 connection + shell session manager (incl. jump-host chaining)
      sftpManager.ts         ssh2 SFTP subsystem wrapper, pooled per host
      tunnelManager.ts       Pro: local/remote SSH port forwarding
    licensing/
      keys.ts               Embedded Ed25519 public key (dev key — replace before shipping)
      license.ts             Signature + expiry verification
      featureFlags.ts         isPro() / hasFeature() / plan limits
      currentLicense.ts       Cached "what plan is active" accessor
  renderer/               React UI (Vite)
    components/            Sidebar, HostDialog, GroupDialog, Terminal, SftpBrowser, Tunnels, Settings
    state/store.ts          zustand store (hosts, groups, tunnels, license, open terminal tabs)
    api/wharf.ts             Thin wrapper over window.wharf
  shared/                 Types shared between main & renderer (no Node/DOM APIs)
    types.ts                Domain types + IPC channel name constants
    api.ts                   window.wharf contract (WharfApi interface)
scripts/
  generate-signing-keys.mjs  One-time: generate the Ed25519 keypair used to sign licenses
  generate-license.mjs        Issue a signed license key for local testing
```

## Licensing

License keys are self-contained, offline-verifiable tokens — no server call
required to activate Pro features. Format: `header.payload.signature`
(base64url segments), signed with Ed25519 — structurally similar to a JWT.

- `src/main/licensing/keys.ts` embeds the **public** key, used only to
  *verify* a pasted license key. Safe to ship in the app.
- The matching **private** key (used only to *issue* licenses) lives at
  `keys/license-signing-key.private.json` — gitignored, generated locally by
  `npm run license:generate-keys`. In a real product this key belongs on
  your license-issuance backend, not on any machine that ships the app.
- `getCurrentLicenseState()` re-verifies the stored license (signature +
  expiry) on every read, so a manually edited store file or a license that
  has since expired is always caught rather than trusted from a cached flag.
- Every Pro code path (`tunnelManager.start/create`, jump-host connections in
  `sshManager`) calls `requireFeature()` in the **main process**, not just
  the UI — so the gate holds even if a renderer-side check is bypassed.

### Testing Pro features locally

A dev signing keypair ships with this repo so licensing works out of the box:

```bash
npm run license:generate -- --email you@example.com --plan pro --days 365
```

This prints a license key — paste it into the app's **Settings → License →
Activate** field. Options: `--plan free|pro`, `--seats <n>`, `--days <n>`
(omit for a perpetual license), `--features <comma,separated,ids>`.

### Shipping a real release

1. `npm run license:generate-keys` on a machine you trust (ideally your
   license-issuance server, not a dev laptop).
2. Copy the printed public key into `src/main/licensing/keys.ts`
   (`LICENSE_PUBLIC_KEY_PEM`).
3. Keep the new private key off of any machine that builds/ships the app;
   use it (or equivalent signing logic) only where you actually issue
   licenses — e.g. triggered by a successful payment.

## Known limitations (starter scope)

- **Dynamic (SOCKS5) tunnels** are defined in the data model (`TunnelType`)
  but `tunnelManager.start()` throws for them — only `local` and `remote`
  forwarding are implemented. A SOCKS5 listener is a reasonable next step.
- **SFTP doesn't chain through jump hosts** — it opens a direct connection
  to the target host. Shell sessions do support jump hosts via
  `client.forwardOut`; extending that to `sftpManager` is a small follow-up
  (reuse `sshManager.getClientForSession`-style plumbing).
- **No team-sync yet** — `teamSync` exists as a reserved Pro feature id with
  no implementation behind it.
- Secrets fall back to a weaker (base64, clearly marked) storage format on
  Linux systems with no OS keychain/secret-service available, since
  Electron's `safeStorage.isEncryptionAvailable()` can return false there.

## Security notes

- Renderer runs with `contextIsolation: true`, `nodeIntegration: false`,
  `sandbox: true`; all filesystem/SSH/SFTP access happens in the main
  process behind the typed `window.wharf` bridge in `preload.ts`.
- Host passwords and key passphrases are never written to disk in
  plaintext; only their `secretId` reference lives on the `HostRecord`.
- `will-navigate` and `setWindowOpenHandler` are locked down so a
  compromised or malicious remote shell can't pivot into opening arbitrary
  URLs inside the app.
