import { describe, expect, it } from "vitest";
import { describeTunnel, suggestLocalPort, suggestTunnelName } from "./tunnelPlan";

describe("suggestLocalPort", () => {
  it("keeps an ordinary port, shifts privileged ones", () => {
    expect(suggestLocalPort(5432, [])).toBe(5432);
    expect(suggestLocalPort(80, [])).toBe(8080);
    expect(suggestLocalPort(443, [])).toBe(8443);
    expect(suggestLocalPort(22, [])).toBe(8022);
  });

  it("steps past ports already used by saved tunnels", () => {
    expect(suggestLocalPort(5432, [5432])).toBe(5433);
    expect(suggestLocalPort(5432, [5432, 5433, 5434])).toBe(5435);
    expect(suggestLocalPort(80, [8080])).toBe(8081);
  });

  it("stops at the top of the range", () => {
    expect(suggestLocalPort(65535, [65535])).toBe(65535);
  });
});

describe("suggestTunnelName", () => {
  it("names each kind readably, leaving out a loopback destination host", () => {
    expect(suggestTunnelName("prod", "local", 5432, "127.0.0.1", 5432)).toBe("prod: 5432 → 5432");
    expect(suggestTunnelName("prod", "local", 15432, "db.internal", 5432)).toBe("prod: 15432 → db.internal:5432");
    expect(suggestTunnelName("prod", "remote", 9000, "localhost", 3000)).toBe("prod: remote 9000 → 3000");
    expect(suggestTunnelName("prod", "dynamic", 1080, "", 0)).toBe("prod: SOCKS proxy on 1080");
  });
});

describe("describeTunnel", () => {
  it("says what listens where", () => {
    expect(describeTunnel("local", "127.0.0.1", 5432, "10.0.0.2", 5432)).toBe("127.0.0.1:5432 → 10.0.0.2:5432");
    expect(describeTunnel("dynamic", "127.0.0.1", 1080, "", 0)).toBe("SOCKS5 proxy on 127.0.0.1:1080");
    expect(describeTunnel("remote", "0.0.0.0", 9000, "localhost", 3000)).toMatch(/^remote 0\.0\.0\.0:9000 → localhost:3000/);
  });
});
