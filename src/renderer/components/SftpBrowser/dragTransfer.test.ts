import { describe, expect, it } from "vitest";
import { readTransferData, setTransferData, TRANSFER_MIME, type TransferPayload } from "./dragTransfer";

// Only dataTransfer's get/setData are used, so a map-backed fake is enough.
function fakeDragEvent(initial: Record<string, string> = {}): React.DragEvent {
  const data = new Map(Object.entries(initial));
  return {
    dataTransfer: {
      setData: (type: string, value: string) => void data.set(type, value),
      getData: (type: string) => data.get(type) ?? "",
    },
  } as unknown as React.DragEvent;
}

describe("dragTransfer", () => {
  it("round-trips a payload", () => {
    const payload: TransferPayload = { source: "remote", hostId: "h1", path: "/srv/a.txt", isDir: false };
    const e = fakeDragEvent();
    setTransferData(e, payload);
    expect(readTransferData(e)).toEqual(payload);
  });

  it("returns null for a native file drop (no custom payload)", () => {
    expect(readTransferData(fakeDragEvent({ Files: "x" }))).toBeNull();
  });

  it("returns null rather than throwing on a corrupt payload", () => {
    expect(readTransferData(fakeDragEvent({ [TRANSFER_MIME]: "{not json" }))).toBeNull();
  });
});
