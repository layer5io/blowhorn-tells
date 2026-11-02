import { describe, expect, it } from "vitest";
import { buildCheckRows, buildVerdictGroupLines, describeUserAgent, REASON_PLAIN } from "../public/checks-view-model.js";
import { buildWorkerConsistencyRows } from "../public/report-view-model.js";
import Ajv2020 from "ajv/dist/2020.js";
import { readFileSync } from "node:fs";
import { normalizeCloudflareBotManagement } from "../src/server-signals.js";
import { scoreReport } from "../src/report-verdict.js";
import { buildInteractionReport } from "../public/collect-interaction.js";
import { humanLike, scriptedElementClick } from "./fixtures/interaction-events.js";
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
const realBotManagement = { ...placeholderBotManagement, score: 87, signedAgent: false, ja3Hash: "e7d705a3286e19ea42f587b344ee6865", ja4: "t13d1516h2_8daaf6152771_02713d6af862" };

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
    expect(rows["Interaction"].result).toBe("not taken");
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
    const rows = byName(buildCheckRows(report({ client: goodClient, server: { ipIntel: { enabled: false } } })));
    expect(rows["VPN / proxy / Tor intelligence"]).toMatchObject({ status: "na", label: "Not available", result: "lookup off" });
    expect(rows["Interaction"]).toMatchObject({ status: "na", result: "not taken" });
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
    expect(bot).toMatchObject({ available: true, score: 87, signedAgent: false, ja4: realBotManagement.ja4 });
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

  it("keeps n/a for a service worker that was unsupported or errored", () => {
    for (const serviceWorker of [{ supported: false }, { error: "timeout" }]) {
      const client = { ...goodClient, browser: { ...goodClient.browser, webdriver: false }, workers: { ...cleanWorkers(false), serviceWorker } };
      const webdriverRow = buildWorkerConsistencyRows({ client }).find((row) => row.label === "WebDriver");
      expect(webdriverRow.values["Service Worker"]).toBe("n/a");
      expect(webdriverRow.values["Web Worker"]).toBe("not exposed");
    }
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

describe("Interaction row", () => {
  const server = { ...report().server };
  const scoredWith = (interaction) => {
    const client = { ...goodClient, interaction };
    const verdict = scoreReport({ server, client });
    return byName(buildCheckRows({ server, client, verdict }));
  };
  const reportFrom = ({ events, task }) => buildInteractionReport(events, task);

  it("is not taken until the test is completed", () => {
    expect(scoredWith(reportFrom({ events: [], task: { startMs: null, endMs: null, completed: false, valueMatches: false, valueSetterNative: null, fullscreen: false } })).Interaction)
      .toMatchObject({ name: "Interaction", slug: "interaction", status: "na", result: "not taken" });
  });

  it("passes a person-like run and says how long it took and what was judged", () => {
    const row = scoredWith(reportFrom(humanLike()))["Interaction"];
    expect(row).toMatchObject({ status: "pass", label: "Pass", slug: "interaction", summary: "Typing and clicks look human" });
    expect(row.result).toMatch(/^\d+\.\d s from Start to Submit · 13 of 13 checks judged$/);
  });

  it("warns, never fails, on script-made input while the checks are uncalibrated", () => {
    const rows = scoredWith(reportFrom(scriptedElementClick()));
    expect(rows["Interaction"].status).toBe("warn");
    expect(rows["Interaction"].finding).toMatch(/^Interaction test: /);
    expect(rows["Interaction"].summary).not.toMatch(/^Interaction test: /);
    expect(rows["Interaction"].status).not.toBe("fail");
  });

  it("is not taken when the test is completed but no check was judged, or there are no checks", () => {
    const judged = reportFrom(humanLike());
    const allNotJudged = { ...judged, checks: judged.checks.map((check) => ({ ...check, status: "na", observed: "not judged" })) };
    expect(scoredWith(allNotJudged).Interaction).toMatchObject({ status: "na", label: "Not available", result: "not taken" });
    expect(scoredWith({ ...judged, checks: [] }).Interaction).toMatchObject({ status: "na", result: "not taken" });
  });

  it("validates its row against the check-row schema in every state", () => {
    for (const interaction of [undefined, reportFrom(humanLike()), reportFrom(scriptedElementClick())]) {
      const row = scoredWith(interaction)["Interaction"];
      expect(validateRow(row), JSON.stringify(validateRow.errors)).toBe(true);
    }
  });
});

describe("verdict card fields", () => {
  it("groups every row under automation, behavior or fingerprint", () => {
    const groups = Object.fromEntries(buildCheckRows(report()).map((row) => [row.name, row.group]));
    expect(groups).toMatchObject({
      "Browser data": "automation",
      "Remote-control tells": "automation",
      "Behavioural classification": "behavior",
      "Interaction": "behavior",
      "Request profile": "fingerprint",
      "Worker consistency": "fingerprint"
    });
    for (const group of Object.values(groups)) expect(["automation", "behavior", "fingerprint"]).toContain(group);
  });

  it("says a passing check in plain words, and keeps the raw value as result", () => {
    const row = byName(buildCheckRows(report()))["Browser data"];
    expect(row).toMatchObject({ status: "pass", summary: "WebDriver not detected" });
    expect(row.result).toMatch(/^webdriver: false/);
    const extensions = { ...goodClient, surfaces: { extensions: { enabled: true, detectedCount: 1, checked: 10 } } };
    expect(byName(buildCheckRows(report({ client: extensions })))["Fingerprint surfaces"]).toMatchObject({ status: "pass", summary: "1 of 10 extensions visible" });
  });

  it("summarises a flagged check in plain words and keeps the server message as the finding", () => {
    const row = byName(buildCheckRows(report({
      client: { ...goodClient, browser: { ...goodClient.browser, webdriver: true } },
      reasons: [{ id: "navigator_webdriver", severity: "high", message: "navigator.webdriver is true." }]
    })))["Browser data"];
    expect(row).toMatchObject({ status: "fail", summary: "WebDriver detected", finding: "navigator.webdriver is true." });
    expect(row.summary).not.toMatch(/navigator\./);
  });

  it("never puts a raw API name in a summary, for any reason the scoring code can emit", () => {
    const rawApi = /navigator\.|window\.|document\.|performance\.|Function\.|isTrusted|\.prototype/;
    for (const [id, phrase] of Object.entries(REASON_PLAIN)) expect(phrase, id).not.toMatch(rawApi);
  });

  it("has a plain phrase for every reason the scoring code can emit", () => {
    const source = readFileSync(new URL("../src/report-verdict.js", import.meta.url), "utf8");
    const ids = [...source.matchAll(/penalize\([^,]+, "([a-z_0-9]+)"/g)].map((match) => match[1]);
    expect(ids.length).toBeGreaterThan(50);
    for (const id of ids) expect(REASON_PLAIN, id).toHaveProperty([id]);
  });

  it("says in a sentence why a check did not run, and keeps the short reason as result", () => {
    const rows = byName(buildCheckRows(report({ client: null, server: { ipIntel: { enabled: false }, cloudflareBotManagement: { available: false } } })));
    expect(rows["VPN / proxy / Tor intelligence"]).toMatchObject({ status: "na", summary: "IP reputation lookup is off", result: "lookup off" });
    expect(rows["Managed bot score"]).toMatchObject({ status: "na", summary: "Cloudflare bot score not available", result: "Bot Management not active" });
    expect(rows["TLS fingerprint"]).toMatchObject({ status: "na", summary: "TLS fingerprint not available" });
    expect(rows["Browser data"]).toMatchObject({ status: "na", summary: "Not collected in this run", result: "not collected" });
    expect(rows["Interaction"]).toMatchObject({ status: "na", summary: "Interaction test not taken", result: "not taken" });
  });

  it("writes every summary as a plain sentence: capitalised, no raw API name, no raw value", () => {
    const rawApi = /navigator\.|window\.|document\.|performance\.|Function\.|isTrusted|\.prototype|webdriver:|JA[34] [a-z0-9]/;
    const cases = [
      report(),
      report({ client: null, server: { ipIntel: { enabled: false } } }),
      report({ server: { ipIntel: { error: "timeout", enabled: true } } }),
      report({
        client: { ...goodClient, browser: { ...goodClient.browser, webdriver: true } },
        reasons: [
          { id: "navigator_webdriver", severity: "high", message: "navigator.webdriver is true." },
          { id: "client_headless_user_agent", severity: "high", message: "HeadlessChrome in navigator.userAgent." },
          { id: "timezone_mismatch", severity: "medium", message: "Intl timezone differs." }
        ]
      })
    ];
    for (const entry of cases) {
      const rows = buildCheckRows(entry);
      for (const row of rows) {
        expect(row.summary, row.name).toMatch(/^[A-Z0-9]/);
        expect(row.summary, row.name).not.toMatch(rawApi);
      }
      for (const line of buildVerdictGroupLines(rows)) expect(line.sentence, line.key).not.toMatch(rawApi);
    }
  });

  it("says WebDriver detected on a passing row whose flag is set", () => {
    const client = { ...goodClient, browser: { ...goodClient.browser, webdriver: true } };
    expect(byName(buildCheckRows(report({ client })))["Browser data"]).toMatchObject({ status: "pass", summary: "WebDriver detected" });
  });

  it("gives every row a non-empty plain summary", () => {
    for (const row of buildCheckRows(report())) expect(row.summary.trim().length).toBeGreaterThan(0);
  });

  it("maps each classification to one verdict word", async () => {
    const { verdictWord } = await import("../public/voice.js");
    expect(verdictWord("likely_human")).toBe("Looks human");
    expect(verdictWord("suspicious")).toBe("Hard to tell");
    expect(verdictWord("likely_bot")).toBe("Looks like a bot");
    expect(verdictWord("pending")).toBe("In progress");
    expect(verdictWord(undefined)).toBe("In progress");
  });
});

describe("verdict group lines", () => {
  const lineFor = (rows) => Object.fromEntries(buildVerdictGroupLines(rows).map((line) => [line.key, line]));
  const row = (name, group, status, summary) => ({ name, group, status, summary, ...{ pass: { symbol: "✓", label: "Pass" }, warn: { symbol: "!", label: "Warning" }, fail: { symbol: "✕", label: "Fail" }, na: { symbol: "–", label: "Not available" } }[status] });

  it("returns the three groups in display order, each with an anchor into the checks list", () => {
    const lines = buildVerdictGroupLines(buildCheckRows(report()));
    expect(lines.map((line) => line.key)).toEqual(["automation", "behavior", "fingerprint"]);
    expect(lines.map((line) => line.anchor)).toEqual(["checks-automation", "checks-behavior", "checks-fingerprint"]);
    expect(lines.map((line) => line.label)).toEqual(["Automation flags", "Behavior", "Fingerprint consistency"]);
  });

  it("says no automation flags when the automation rows pass", () => {
    const lines = lineFor([row("Browser data", "automation", "pass", "WebDriver not detected"), row("Remote-control tells", "automation", "pass", "No remote-control tells found")]);
    expect(lines.automation).toMatchObject({ status: "pass", symbol: "✓", statusLabel: "Pass", sentence: "none found" });
  });

  it("names a single automation flag on its own", () => {
    const lines = lineFor([row("Browser data", "automation", "fail", "WebDriver detected"), row("Managed bot score", "automation", "pass", "Cloudflare bot score is not low")]);
    expect(lines.automation).toMatchObject({ status: "fail", symbol: "✕", sentence: "WebDriver detected" });
  });

  it("counts several automation flags and lists them, later ones in lower case unless a name", () => {
    const lines = lineFor([
      row("Browser data", "automation", "fail", "WebDriver detected"),
      row("Browser data 2", "automation", "fail", "Headless browser detected"),
      row("Remote-control tells", "automation", "warn", "WebDriver flag patched"),
      row("Managed bot score", "automation", "pass", "Cloudflare bot score is not low")
    ]);
    expect(lines.automation).toMatchObject({ status: "fail", symbol: "✕", sentence: "3 flags: WebDriver detected, headless browser detected, WebDriver flag patched" });
  });

  it("uses the first clean behaviour sentence when nothing is flagged, and the concern when something is", () => {
    expect(lineFor([row("Behavioural classification", "behavior", "pass", "Pointer and key timing look human")]).behavior.sentence).toBe("Pointer and key timing look human");
    expect(lineFor([row("Behavioural classification", "behavior", "warn", "Pointer and key input are borderline")]).behavior).toMatchObject({ status: "warn", symbol: "!", sentence: "Pointer and key input are borderline" });
  });

  it("lists fingerprint concerns by their plain summaries, never by check name", () => {
    const lines = lineFor([
      row("Request profile", "fingerprint", "warn", "Timezone does not match the IP location"),
      row("Browser fingerprint", "fingerprint", "fail", "No WebGL graphics support"),
      row("Latency", "fingerprint", "pass", "Round-trip times look ordinary"),
      row("TLS fingerprint", "fingerprint", "na", "TLS fingerprint not available")
    ]);
    expect(lines.fingerprint).toMatchObject({ status: "fail", sentence: "2 concerns: Timezone does not match the IP location, no WebGL graphics support" });
    expect(lineFor([row("Latency", "fingerprint", "pass", "x")]).fingerprint.sentence).toBe("1 check agrees");
    expect(lineFor([row("Latency", "fingerprint", "pass", "x"), row("Request profile", "fingerprint", "pass", "y")]).fingerprint.sentence).toBe("All 2 checks agree");
  });

  it("reports a group with no judged rows as not checked, with n/a status", () => {
    const line = lineFor([row("Interaction", "behavior", "na", "Interaction test not taken")]).behavior;
    expect(line).toMatchObject({ status: "na", symbol: "–", statusLabel: "Not available", sentence: "Not checked in this run" });
    expect(lineFor([]).automation).toMatchObject({ status: "na", sentence: "Not checked in this run" });
  });
});
