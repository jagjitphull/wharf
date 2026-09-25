import { useEffect, useState } from "react";
import { useAppStore } from "../../state/store";
import { ipcErrorMessage, wharf } from "../../api/wharf";
import { RemotePane } from "./RemotePane";
import { LocalPane } from "./LocalPane";
import { IconFolder } from "../Icons/Icons";
import { EmptyState } from "../EmptyState/EmptyState";
import "./SftpBrowser.css";

export function SftpBrowser() {
  const { hosts, contextHostId } = useAppStore();
  const host = hosts.find((h) => h.id === contextHostId) ?? null;

  const [remotePath, setRemotePath] = useState(".");
  const [localPath, setLocalPath] = useState<string | null>(null);
  const [transferError, setTransferError] = useState<string | null>(null);

  // The left pane defaults to the local machine, but can be swapped for a
  // second saved host instead — a null id means "local machine".
  const [secondHostId, setSecondHostId] = useState<string | null>(null);
  const secondHost = hosts.find((h) => h.id === secondHostId) ?? null;
  const [secondRemotePath, setSecondRemotePath] = useState(".");

  useEffect(() => {
    setRemotePath(".");
  }, [contextHostId]);

  useEffect(() => {
    wharf.localFs
      .homeDir()
      .then(setLocalPath)
      .catch(() => setLocalPath("/"));
  }, []);

  // Switching hosts (or the primary host itself changing) can leave the
  // second pane pointed at whatever's now the primary host — drop back to
  // local rather than showing a host transferring to itself.
  useEffect(() => {
    if (secondHostId && secondHostId === contextHostId) setSecondHostId(null);
  }, [contextHostId, secondHostId]);

  // "Primary" is always the host picked in the sidebar (right pane);
  // "second" is whichever the left pane is currently showing — local
  // machine by default, or another saved host once picked below.
  async function transferToPrimary(sourcePath: string) {
    if (!host) return;
    try {
      if (secondHost) await wharf.sftp.transferBetweenHosts(secondHost.id, sourcePath, host.id, remotePath);
      else if (localPath) await wharf.sftp.uploadPath(host.id, sourcePath, remotePath);
    } catch (err) {
      setTransferError(ipcErrorMessage(err));
    }
  }

  async function transferToSecond(sourcePath: string) {
    if (!host) return;
    try {
      if (secondHost) await wharf.sftp.transferBetweenHosts(host.id, sourcePath, secondHost.id, secondRemotePath);
      else if (localPath) await wharf.sftp.downloadToPath(host.id, sourcePath, localPath);
    } catch (err) {
      setTransferError(ipcErrorMessage(err));
    }
  }

  if (!host) {
    return (
      <EmptyState
        icon={<IconFolder size={40} />}
        title="No host selected"
        hint="Select a host in the sidebar and click its Files icon to browse its files."
      />
    );
  }

  // Every other saved host is a valid pick for the second pane — except
  // the one already open in the primary (right) pane.
  const otherHosts = hosts.filter((h) => h.id !== host.id);

  return (
    <div className="sftp-browser-split">
      {transferError && (
        <div className="sftp-transfer-error" onClick={() => setTransferError(null)}>
          {transferError}
        </div>
      )}
      <div className="sftp-pane-slot">
        <div className="sftp-second-pane-picker">
          <label>
            Other side:
            <select value={secondHostId ?? "local"} onChange={(e) => setSecondHostId(e.target.value === "local" ? null : e.target.value)}>
              <option value="local">Local machine</option>
              {otherHosts.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {secondHost ? (
          <RemotePane
            host={secondHost}
            path={secondRemotePath}
            onPathChange={setSecondRemotePath}
            otherPaneLabel={host.name}
            onTransferToOther={transferToPrimary}
            onTransferFromOther={transferToSecond}
          />
        ) : (
          localPath !== null && (
            <LocalPane path={localPath} onPathChange={setLocalPath} onTransferToRemote={transferToPrimary} onTransferFromRemote={transferToSecond} />
          )
        )}
      </div>
      <RemotePane
        host={host}
        path={remotePath}
        onPathChange={setRemotePath}
        otherPaneLabel={secondHost ? secondHost.name : "local pane"}
        onTransferToOther={transferToSecond}
        onTransferFromOther={transferToPrimary}
      />
    </div>
  );
}
