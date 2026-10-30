import { describe, expect, it } from "vitest";
import { buildCheckRows, describeUserAgent } from "../public/checks-view-model.js";
import { buildWorkerConsistencyRows } from "../public/report-view-model.js";
import Ajv2020 from "ajv/dist/2020.js";
import { readFileSync } from "node:fs";
import { normalizeCloudflareBotManagement } from "../src/server-signals.js";
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

const loadSchema = (name) => JSON.parse(readFileSync(new URL(`../schemas/${name}`, import.meta.url), "utf8"));
const ajv = new Ajv2020({ allErrors: true });
const validateRow = ajv.compile(loadSchema("check-row.schema.json"));
const validateBotManagement = ajv.compile(loadSchema("cloudflare-bot-management.schema.json"));

const placeholderBotManagement = { available: true, score: 99, verifiedBot: false, signedAgent: null, staticResource: false, ja3Hash: null, ja4: null, detectionIds: {}, jsDetection: { passed: false } };
const realBotManagement = { ...placeholderBotManagement, score: 87, ja3Hash: "e7d705a3286e19ea42f587b344ee6865", ja4: "t13d1516h2_8daaf6152771_02713d6af862" };

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

describe("Managed bot score and TLS fingerprint", () => {
  it("normalizes Cloudflare placeholder data to unavailable", () => {
    expect(normalizeCloudflareBotManagement(placeholderBotManagement)).toEqual({ available: false });
    expect(normalizeCloudflareBotManagement(undefined)).toEqual({ available: false });
  });

  it("keeps real Bot Management data with its score", () => {
    const bot = normalizeCloudflareBotManagement(realBotManagement);
    expect(bot).toMatchObject({ available: true, score: 87, ja4: realBotManagement.ja4 });
    expect(validateBotManagement(bot)).toBe(true);
    expect(validateBotManagement(normalizeCloudflareBotManagement(placeholderBotManagement))).toBe(true);
    expect(validateBotManagement({ available: true, score: 99 })).toBe(false);
  });

  it("shows both rows as not available for placeholder data", () => {
    const server = { cloudflareBotManagement: normalizeCloudflareBotManagement(placeholderBotManagement) };
    const rows = byName(buildCheckRows(report({ server })));
    expect(rows["Managed bot score"]).toMatchObject({ status: "na", label: "Not available", result: "Bot Management not active" });
    expect(rows["TLS fingerprint"]).toMatchObject({ status: "na", label: "Not available", result: "no JA4 or JA3 fingerprint" });
  });

  it("passes and fails with real data as before", () => {
    const server = { cloudflareBotManagement: normalizeCloudflareBotManagement(realBotManagement) };
    let rows = byName(buildCheckRows(report({ server })));
    expect(rows["Managed bot score"]).toMatchObject({ status: "pass", result: "score 87 of 99" });
    expect(rows["TLS fingerprint"]).toMatchObject({ status: "pass", result: `TLSv1.3 · JA4 ${realBotManagement.ja4}` });
    rows = byName(buildCheckRows(report({ server, reasons: [{ id: "managed_bot_score_low", severity: "high", message: "Managed bot score is below 30." }] })));
    expect(rows["Managed bot score"].status).toBe("fail");
  });

  it("validates every row against the check-row schema", () => {
    const cases = [
      ...knownGoodBrowserReports.map((entry) => report({ client: entry.client })),
      report({ server: { cloudflareBotManagement: { available: false } } }),
      report({ server: { cloudflareBotManagement: normalizeCloudflareBotManagement(realBotManagement) } }),
      report({ client: null })
    ];
    for (const entry of cases) {
      for (const row of buildCheckRows(entry)) expect(validateRow(row), JSON.stringify([row, validateRow.errors])).toBe(true);
    }
    const [sample] = buildCheckRows(report());
    expect(validateRow({ ...sample, status: "maybe" })).toBe(false);
    expect(validateRow({ ...sample, extra: 1 })).toBe(false);
  });
});

describe("Worker consistency on a clean browser", () => {
  const cleanWorkers = (webdriver) => ({
    webWorker: { ...goodClient.workers.webWorker, webdriver: null },
    iframe: { ...goodClient.workers.iframe, webdriver },
    serviceWorker: { ...goodClient.workers.serviceWorker, webdriver: undefined }
  });

  it("does not warn when only the workers lack navigator.webdriver", () => {
    const client = { ...goodClient, browser: { ...goodClient.browser, webdriver: false }, workers: cleanWorkers(false) };
    const webdriverRow = buildWorkerConsistencyRows({ client }).find((row) => row.label === "WebDriver");
    expect(webdriverRow.status).not.toBe("differs");
    expect(webdriverRow.values).toMatchObject({ Window: "false", Iframe: "false", "Web Worker": "not exposed", "Service Worker": "not exposed" });
    expect(byName(buildCheckRows(report({ client })))["Worker consistency"].status).toBe("pass");
  });

  it("still warns when window and iframe disagree", () => {
    const client = { ...goodClient, browser: { ...goodClient.browser, webdriver: false }, workers: cleanWorkers(true) };
    const webdriverRow = buildWorkerConsistencyRows({ client }).find((row) => row.label === "WebDriver");
    expect(webdriverRow.status).toBe("differs");
    expect(byName(buildCheckRows(report({ client })))["Worker consistency"].status).toBe("warn");
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
