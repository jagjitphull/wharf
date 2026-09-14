#!/usr/bin/env node
/**
 * Generates an Ed25519 keypair used to sign/verify Wharf Pro license keys.
 *
 * Run once when setting up licensing for real:
 *   npm run license:generate-keys
 *
 * - The PRIVATE key is written to keys/license-signing-key.private.json.
 *   It is gitignored. NEVER commit it, NEVER ship it inside the app — it
 *   must only ever live on whatever issues licenses (a license server, or
 *   your own machine for manual issuance).
 * - The PUBLIC key is printed to stdout as a PEM string. Paste it into
 *   src/main/licensing/keys.ts (it is safe to ship in the app; the app only
 *   needs to verify licenses, never issue them).
 *
 * A dev keypair is already committed to keys.ts so `npm run license:generate`
 * works out of the box for local testing. Re-run this script and swap the
 * embedded key before shipping a real release.
 */
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const keysDir = path.join(__dirname, "..", "keys");
const privateKeyPath = path.join(keysDir, "license-signing-key.private.json");

if (existsSync(privateKeyPath)) {
  console.error(`Refusing to overwrite existing ${privateKeyPath}.`);
  console.error("Delete it first if you really want to rotate keys (this invalidates all issued licenses).");
  process.exit(1);
}

const { publicKey, privateKey } = generateKeyPairSync("ed25519");

const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

mkdirSync(keysDir, { recursive: true });
writeFileSync(
  privateKeyPath,
  JSON.stringify({ algorithm: "Ed25519", privateKeyPem, generatedAt: new Date().toISOString() }, null, 2),
  { mode: 0o600 },
);

console.log("Generated new Ed25519 signing keypair.\n");
console.log(`Private key written to: ${privateKeyPath} (gitignored, keep offline/secret)\n`);
console.log("Public key (paste into src/main/licensing/keys.ts as LICENSE_PUBLIC_KEY_PEM):\n");
console.log(publicKeyPem);
