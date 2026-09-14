import "./Settings.css";

export function Settings() {
  return (
    <div className="settings-panel">
      <h2>About</h2>
      <p className="hint">
        Wharf — a personal SSH/SFTP client. Save hosts and groups, connect via password, private key, or SSH agent,
        chain through jump hosts, and set up local/remote port forwarding.
      </p>
    </div>
  );
}
