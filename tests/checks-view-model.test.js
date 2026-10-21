import { describe, expect, it } from "vitest";
import { buildCheckRows, describeUserAgent } from "../public/checks-view-model.js";
import { knownGoodBrowserReports } from "./e2e/fixtures/known-good-browsers.js";

const goodClient = knownGoodBrowserReports[0].client;
const goodHeaders = knownGoodBrowserReports[0].headers;

function report({ server = {}, client = goodClient, reasons = [] } = {}) {
  return {
    server: {
      userAgent: goodHeaders["user-agent"],
      headers: goodHeaders,
      cf: { httpProtocol: "HTTP/2", asOrganization: "Comcast Cable Communications", tlsVersion: "TLSv1.3", clientTcpRtt: 21 },
      datacenterHeuristic: { isLikelyDatacenter: false, organization: "Comcast Cable Communications" },
      proxyHeaders: {},
      ipIntel: { enabled: true, normalized: { isVpn: false, isProxy: false, isTor: false, isDatacenter: false } },
      ...server
    },
    client,
    verdict: { reasons }
  };
}

function byName(rows) {
  return Object.fromEntries(rows.map((row) => [row.name, row]));
}

describe("checks table rows", () => {
  it("states what was observed, not that a check ran", () => {
    const rows = byName(buildCheckRows(report()));
    expect(rows["Browser data"].result).toMatch(/^webdriver: false · \d+ plugins? · \d+ threads · screen \d+×\d+$/);
    expect(rows["Request profile"].result).toMatch(/^Chrome \d+ on macOS · HTTP\/2 · \d+ headers$/);
    expect(rows["Datacenter pattern"].result).toBe("Comcast Cable Communications: not a hosting name");
    expect(rows["VPN / proxy / Tor intelligence"].result).toBe("no VPN, proxy, Tor or hosting flags");
    expect(rows["Proxy indicators"].result).toBe("no forwarding headers");
    expect(rows["Remote-control tells"].result).toBe("no driver globals · native webdriver getter");
    expect(rows["Latency"].result).toContain("TCP 21 ms");
    expect(rows["Optional human check"].result).toBe("completed");
    for (const row of Object.values(rows)) expect(row.result).not.toMatch(/^(checked|recorded)$/i);
  });

  it("gives every row a symbol and an accessible label", () => {
    for (const row of buildCheckRows(report())) {
      expect(["pass", "warn", "fail", "na"]).toContain(row.status);
      expect(row.symbol).toMatch(/^[✓!✕–]$/);
      expect(row.label.length).toBeGreaterThan(2);
    }
  });

  it("fails a row on a high-severity reason and shows the finding", () => {
    const rows = byName(buildCheckRows(report({
      client: { ...goodClient, browser: { ...goodClient.browser, webdriver: true } },
      reasons: [
        { id: "navigator_webdriver", severity: "high", message: "navigator.webdriver is true." },
        { id: "notification_permission_default_state", severity: "low", message: "Notification permission is default." }
      ]
    })));
    expect(rows["Browser data"]).toMatchObject({ status: "fail", symbol: "✕", label: "Fail", finding: "navigator.webdriver is true. (+1 more)" });
    expect(rows["Browser data"].result).toMatch(/^webdriver: true/);
    expect(rows["Request profile"].status).toBe("pass");
  });

  it("warns on a medium reason", () => {
    const rows = byName(buildCheckRows(report({ reasons: [{ id: "timezone_mismatch", severity: "medium", message: "Timezone differs." }] })));
    expect(rows["Request profile"]).toMatchObject({ status: "warn", label: "Warning", finding: "Timezone differs." });
  });

  it("names only the extra forwarding headers the server flagged", () => {
    const rows = byName(buildCheckRows(report({
      server: { proxyHeaders: { "x-real-ip": "203.0.113.4", via: "1.1 squid" } },
      reasons: [{ id: "proxy_headers", severity: "medium", message: "Extra proxy headers.", data: { via: "1.1 squid" } }]
    })));
    expect(rows["Proxy indicators"]).toMatchObject({ status: "warn", result: "extra forwarding headers: via" });
  });

  it("marks checks with no data as not available, with the reason", () => {
    const client = { ...goodClient, challenge: { completed: false } };
    const rows = byName(buildCheckRows(report({ client, server: { ipIntel: { enabled: false } } })));
    expect(rows["VPN / proxy / Tor intelligence"]).toMatchObject({ status: "na", label: "Not available", result: "lookup off" });
    expect(rows["Optional human check"]).toMatchObject({ status: "na", result: "not taken" });
    expect(rows["Managed bot score"]).toBeUndefined();
  });

  it("lists flagged network types", () => {
    const rows = byName(buildCheckRows(report({
      server: { ipIntel: { enabled: true, normalized: { isVpn: true, isDatacenter: true } } },
      reasons: [{ id: "ip_vpn", severity: "high", message: "IP is a VPN exit." }]
    })));
    expect(rows["VPN / proxy / Tor intelligence"]).toMatchObject({ status: "fail", result: "flagged: VPN, hosting" });
  });

  it("works for a server-only report with no browser data", () => {
    const rows = byName(buildCheckRows(report({ client: null })));
    expect(rows["Browser data"].status).toBe("na");
    expect(rows["Request profile"].status).toBe("pass");
  });
});

describe("User-Agent description", () => {
  it("names the browser, version and system", () => {
    expect(describeUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1")).toBe("Safari 18 on iOS");
    expect(describeUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36 Edg/155.0.0.0")).toBe("Edge 155 on Windows");
    expect(describeUserAgent("curl/8.7.1")).toBe("curl");
    expect(describeUserAgent("")).toBe("no User-Agent");
  });
});
