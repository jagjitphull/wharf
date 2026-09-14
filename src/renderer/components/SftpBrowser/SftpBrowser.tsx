import { useEffect, useState } from "react";
import { useAppStore } from "../../state/store";
import { ipcErrorMessage, wharf } from "../../api/wharf";
import { RemotePane } from "./RemotePane";
import { LocalPane } from "./LocalPane";
import "./SftpBrowser.css";

export function SftpBrowser() {
  const { hosts, contextHostId } = useAppStore();
  const host = hosts.find((h) => h.id === contextHostId) ?? null;

  const [remotePath, setRemotePath] = useState(".");
  const [localPath, setLocalPath] = useState<string | null>(null);
  const [transferError, setTransferError] = useState<string | null>(null);

  useEffect(() => {
    setRemotePath(".");
  }, [contextHostId]);

  useEffect(() => {
    wharf.localFs
      .homeDir()
      .then(setLocalPath)
      .catch(() => setLocalPath("/"));
  }, []);

  async function transferToRemote(sourceLocalPath: string) {
    if (!host) return;
    try {
      await wharf.sftp.uploadPath(host.id, sourceLocalPath, remotePath);
    } catch (err) {
      setTransferError(ipcErrorMessage(err));
    }
  }

  async function transferToLocal(sourceRemotePath: string) {
    if (!host || !localPath) return;
    try {
      await wharf.sftp.downloadToPath(host.id, sourceRemotePath, localPath);
    } catch (err) {
      setTransferError(ipcErrorMessage(err));
    }
  }

  if (!host) {
    return (
      <div className="sftp-empty">
        <p>Select a host in the sidebar and click its Files icon to browse its files.</p>
      </div>
    );
  }

  return (
    <div className="sftp-browser-split">
      {transferError && (
        <div className="sftp-transfer-error" onClick={() => setTransferError(null)}>
          {transferError}
        </div>
      )}
      {localPath !== null && (
        <LocalPane
          path={localPath}
          onPathChange={setLocalPath}
          onTransferToRemote={transferToRemote}
          onTransferFromRemote={transferToLocal}
        />
      )}
      <RemotePane
        host={host}
        path={remotePath}
        onPathChange={setRemotePath}
        onTransferToLocal={transferToLocal}
        onTransferFromLocal={transferToRemote}
      />
    </div>
  );
}
