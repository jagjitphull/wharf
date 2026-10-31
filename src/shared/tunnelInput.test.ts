import { describe, expect, it } from "vitest";
import { validateTunnelInput } from "./tunnelInput";
import type { TunnelInput } from "./types";

const ok: TunnelInput = {
  hostId: "h",
  name: "db",
  type: "local",
  srcHost: "127.0.0.1",
  srcPort: 5432,
  dstHost: "127.0.0.1",
  dstPort: 5432,
};

describe("validateTunnelInput", () => {
  it("accepts a normal tunnel of each type", () => {
    expect(validateTunnelInput(ok)).toBeNull();
    expect(validateTunnelInput({ ...ok, type: "remote" })).toBeNull();
    expect(validateTunnelInput({ hostId: "h", name: "socks", type: "dynamic", srcHost: "127.0.0.1", srcPort: 1080 })).toBeNull();
  });

  it("needs a name, a host and a listen address", () => {
    expect(validateTunnelInput({ ...ok, name: "  " })).toMatch(/name/);
    expect(validateTunnelInput({ ...ok, hostId: "" })).toMatch(/host/);
    expect(validateTunnelInput({ ...ok, srcHost: "" })).toMatch(/listen/);
  });

  it("rejects ports outside 1–65535 and non-integers", () => {
    for (const port of [0, -1, 65536, 1.5, Number.NaN]) {
      expect(validateTunnelInput({ ...ok, srcPort: port })).toMatch(/listening port/);
      expect(validateTunnelInput({ ...ok, dstPort: port })).toMatch(/destination port/);
    }
  });

  it("doesn't ask a SOCKS tunnel for a destination", () => {
    expect(validateTunnelInput({ ...ok, type: "dynamic", dstHost: "", dstPort: 0 })).toBeNull();
  });

  it("rejects an unknown type", () => {
    expect(validateTunnelInput({ ...ok, type: "sideways" as never })).toMatch(/type/);
  });
});
