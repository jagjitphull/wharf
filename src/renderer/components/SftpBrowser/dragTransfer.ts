/** Custom drag payload used to move a row between the local and remote
 * SFTP panes (as opposed to a native OS file drag, which uses the
 * standard "Files" type and is handled separately by each pane for
 * uploads dragged in from outside the app). */
export const TRANSFER_MIME = "application/x-wharf-transfer";

export interface TransferPayload {
  source: "local" | "remote";
  /** Which host a "remote" drag came from — lets a remote pane tell a drop
   * from a *different* remote host (a real cross-server transfer) apart
   * from a row dragged onto its own pane (a no-op). Unused for "local". */
  hostId?: string;
  path: string;
  isDir: boolean;
}

export function setTransferData(e: React.DragEvent, payload: TransferPayload): void {
  e.dataTransfer.setData(TRANSFER_MIME, JSON.stringify(payload));
}

/** Reads the payload back out on drop. Returns null if this drop isn't one
 * of our own cross-pane drags (e.g. it's a native OS file drop instead). */
export function readTransferData(e: React.DragEvent): TransferPayload | null {
  const raw = e.dataTransfer.getData(TRANSFER_MIME);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TransferPayload;
  } catch {
    return null;
  }
}
