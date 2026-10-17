import { useEffect, useState } from "react";
import type { SecretStorageStatus } from "@shared/types";
import { wharf } from "../../api/wharf";

/** Where saved passwords and key passphrases end up: encrypted with the OS
 * keyring, or — on a Linux machine without one — only base64-encoded, which
 * is worth saying out loud rather than leaving to the README. */
export function SecretStorageSettings() {
  const [status, setStatus] = useState<SecretStorageStatus | null>(null);

  useEffect(() => {
    void wharf.secrets.status().then(setStatus);
  }, []);

  if (!status) return null;

  if (status.encrypted && status.unencryptedCount === 0) {
    return <p className="hint">Saved passwords and key passphrases are encrypted with your system keyring.</p>;
  }

  return (
    <div className="secret-warning" role="alert">
      <strong>No system keyring found.</strong> Saved passwords and key passphrases are only base64-encoded in <code>wharf-data.json</code>{" "}
      — not encrypted. That file is readable by your user only, but anyone who can read it (or a backup of it) can recover them. Installing
      and unlocking a keyring (GNOME Keyring, KWallet, or anything that provides the Secret Service) fixes this: Wharf encrypts the ones
      already saved the next time it starts. Until then, an SSH agent or a key without a passphrase avoids storing a secret at all.
      {status.unencryptedCount > 0 && (
        <>
          {" "}
          Right now {status.unencryptedCount} saved {status.unencryptedCount === 1 ? "secret is" : "secrets are"} stored this way.
        </>
      )}
    </div>
  );
}
