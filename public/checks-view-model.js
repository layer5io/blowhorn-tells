import { buildWebRtcComparison, buildWorkerConsistencyRows } from "./report-view-model.js";

// One row per check: what was observed, and a pass/warn/fail/n.a. status taken from
// the reasons the server scored against that check.

export const CHECK_STATUS = {
  pass: { symbol: "✓", label: "Pass" },
  warn: { symbol: "!", label: "Warning" },
  fail: { symbol: "✕", label: "Fail" },
  na: { symbol: "–", label: "Not available" }
};

const CHECKS = [
  {
    name: "Request profile",
    slug: "request-profile",
    reasons: ["server_missing_ua", "missing_user_agent", "automation_user_agent", "library_user_agent", "missing_accept", "missing_accept_language", "missing_client_hints", "body_without_content_type", "request_client_ua_mismatch", "accept_language_mismatch", "client_hint_platform_mismatch", "client_hint_mobile_mismatch", "client_hint_high_entropy_mismatch", "ua_data_high_entropy_mismatch", "ua_platform_mismatch", "timezone_mismatch"],
    observe: ({ server }) => join([
      describeUserAgent(server.userAgent),
      server.cf?.httpProtocol,
      server.headers ? `${Object.keys(server.headers).length} headers` : null
    ])
  },
  {
    name: "Proxy indicators",
    slug: "proxy-indicators",
    reasons: ["proxy_headers"],
    // The server already separates Cloudflare's own forwarding headers from extra ones;
    // only the extra ones land in the proxy_headers reason.
    observe: ({ server }, matched) => {
      const extra = Object.keys(matched[0]?.data || {});
      if (extra.length) return `extra forwarding headers: ${extra.join(", ")}`;
      return Object.keys(server.proxyHeaders || {}).length ? "only Cloudflare forwarding headers" : "no forwarding headers";
    }
  },
  {
    name: "Datacenter pattern",
    slug: "datacenter-pattern",
    reasons: ["datacenter_asn_heuristic"],
    available: ({ server }) => Boolean(server.datacenterHeuristic?.organization || server.cf?.asOrganization),
    unavailable: () => "no network owner reported",
    observe: ({ server }) => {
      const heuristic = server.datacenterHeuristic || {};
      const org = heuristic.organization || server.cf?.asOrganization;
      if (!org) return null;
      return `${org}: ${heuristic.isLikelyDatacenter ? "hosting provider name" : "not a hosting name"}`;
    }
  },
  {
    name: "VPN / proxy / Tor intelligence",
    slug: "vpn-proxy-tor",
    reasons: ["ip_vpn", "ip_proxy", "ip_tor", "ip_datacenter", "ip_crawler", "ip_abuser", "ipqs_high_fraud_score"],
    available: ({ server }) => server.ipIntel?.enabled === true && !server.ipIntel?.error,
    unavailable: ({ server }) => server.ipIntel?.error ? "lookup failed" : "lookup off",
    observe: ({ server }) => {
      const flags = server.ipIntel?.normalized || {};
      const raised = [["VPN", flags.isVpn], ["proxy", flags.isProxy], ["Tor", flags.isTor], ["hosting", flags.isDatacenter], ["crawler", flags.isCrawler], ["abuser", flags.isAbuser]]
        .filter(([, on]) => on === true)
        .map(([label]) => label);
      return raised.length ? `flagged: ${raised.join(", ")}` : "no VPN, proxy, Tor or hosting flags";
    }
  },
  {
    name: "Managed bot score",
    slug: "managed-bot-score",
    reasons: ["managed_bot_score_low", "managed_bot_score_borderline", "cloudflare_verified_bot"],
    available: ({ server }) => server.cloudflareBotManagement?.available === true,
    unavailable: () => "not on this plan",
    observe: ({ server }) => {
      const bot = server.cloudflareBotManagement;
      return join([`score ${bot.score ?? "n/a"} of 99`, bot.verifiedBot ? "verified bot" : null]);
    }
  },
  {
    name: "TLS fingerprint",
    slug: "tls-fingerprint",
    reasons: [],
    available: ({ server }) => Boolean(server.cf?.tlsVersion),
    unavailable: () => "no TLS details",
    observe: ({ server }) => {
      const bot = server.cloudflareBotManagement || {};
      const id = bot.ja4 ? `JA4 ${bot.ja4}` : bot.ja3Hash ? `JA3 ${bot.ja3Hash}` : "no JA4 on this plan";
      return join([server.cf.tlsVersion, id]);
    }
  },
  {
    name: "Browser data",
    slug: "browser-data",
    reasons: ["navigator_webdriver", "client_headless_user_agent", "empty_plugins_chromium", "plugin_reference_mismatch", "plugin_item_overflow", "prototype_getter_not_native", "screen_viewport_impossible", "mobile_touch_mismatch", "notification_permission_default_state", "notification_permission_contradiction"],
    available: ({ client }) => Boolean(client?.browser),
    observe: ({ client }) => {
      const browser = client.browser;
      const screen = browser.screen || {};
      return join([
        `webdriver: ${browser.webdriver === true ? "true" : browser.webdriver === false ? "false" : "absent"}`,
        Array.isArray(browser.plugins) ? plural(browser.plugins.length, "plugin") : null,
        browser.hardwareConcurrency ? plural(browser.hardwareConcurrency, "thread") : null,
        screen.width && screen.height ? `screen ${screen.width}×${screen.height}` : null
      ]);
    }
  },
  {
    name: "Browser fingerprint",
    slug: "browser-fingerprint",
    reasons: ["webgl_missing", "canvas_error"],
    available: ({ client }) => Boolean(client?.fingerprints),
    observe: ({ client }) => {
      const fp = client.fingerprints;
      const renderer = fp.webgl?.params?.unmaskedRenderer || fp.webgl?.params?.renderer;
      return join([
        fp.webgl?.supported === false ? "no WebGL" : renderer ? `GPU ${shortRenderer(renderer)}` : null,
        fp.fonts?.count != null ? plural(fp.fonts.count, "font") : null,
        fp.canvas?.hash ? "canvas hashed" : fp.canvas?.error ? "canvas failed" : null
      ]);
    }
  },
  {
    name: "Fingerprint surfaces",
    slug: "fingerprint-surfaces",
    reasons: [],
    available: ({ client }) => Boolean(client?.surfaces),
    observe: ({ client }) => {
      const surfaces = client.surfaces;
      const extensions = surfaces.extensions;
      return join([
        extensions?.enabled ? `${extensions.detectedCount || 0} of ${extensions.checked || 0} extensions found` : null,
        surfaces.speechSynthesis?.supported ? plural(surfaces.speechSynthesis.count || 0, "voice") : null,
        surfaces.devtools ? `DevTools ${surfaces.devtools.isOpen ? "open" : "closed"}` : null
      ]);
    }
  },
  {
    name: "Performance memory pings",
    slug: "performance-memory",
    reasons: ["performance_memory_anomaly"],
    available: ({ client }) => (client?.network?.ping?.memorySamples || []).some((sample) => sample?.supported),
    unavailable: () => "not exposed by this browser",
    observe: ({ client }) => {
      const samples = client.network.ping.memorySamples.filter((sample) => sample?.supported);
      const last = samples[samples.length - 1];
      return join([plural(samples.length, "sample"), Number.isFinite(last?.usedRatio) ? `heap ${Math.round(last.usedRatio * 100)}% used` : null]);
    }
  },
  {
    name: "Worker consistency",
    slug: "worker-consistency",
    reasons: ["worker_platform_mismatch", "iframe_platform_mismatch"],
    // Disagreement the score does not penalize still deserves a warning on this row.
    extraStatus: ({ client }) => {
      const differs = buildWorkerConsistencyRows({ client }).filter((row) => row.status === "differs").map((row) => row.label);
      return differs.length ? { status: "warn", finding: `Browser contexts disagree on ${differs.join(", ")}.` } : null;
    },
    available: ({ client }) => Boolean(client?.workers),
    observe: (report) => {
      const rows = buildWorkerConsistencyRows({ client: report.client });
      const differs = rows.filter((row) => row.status === "differs").map((row) => row.label.toLowerCase());
      const contexts = Object.values(report.client.workers).filter((context) => context && !context.error && context.supported !== false).length + 1;
      return differs.length ? `differs: ${differs.join(", ")}` : `${contexts} contexts agree`;
    }
  },
  {
    name: "WebRTC network clues",
    slug: "webrtc-clues",
    reasons: ["webrtc_public_ip_mismatch"],
    available: ({ client }) => client?.network?.webrtc?.supported !== false && (client?.network?.webrtc?.candidates || []).length > 0,
    unavailable: ({ client }) => client?.network?.webrtc?.supported === false ? "not supported" : "no candidates (blocked or offline)",
    observe: (report) => buildWebRtcComparison(report).Status
  },
  {
    name: "Latency",
    slug: "latency",
    reasons: ["browser_edge_latency_gap"],
    observe: ({ server, client }) => join([
      Number.isFinite(client?.network?.ping?.medianMs) ? `browser ${Math.round(client.network.ping.medianMs)} ms` : null,
      Number.isFinite(server.cf?.clientTcpRtt) ? `TCP ${server.cf.clientTcpRtt} ms` : null,
      Number.isFinite(server.cf?.clientQuicRtt) && server.cf.clientQuicRtt > 0 ? `QUIC ${server.cf.clientQuicRtt} ms` : null
    ])
  },
  {
    name: "Remote-control tells",
    slug: "remote-control-tells",
    reasons: ["automation_globals", "document_automation_keys", "cdp_serialization_signal", "webdriver_own_property", "webdriver_getter_patched", "native_function_patched", "synthetic_input", "input_while_hidden", "input_without_focus", "zero_size_window"],
    available: ({ client }) => Boolean(client?.automation || client?.tells),
    observe: ({ client }) => {
      const found = [...(client.automation?.present || []), ...(client.tells?.documentAutomationKeys || [])];
      const tells = client.tells || {};
      return join([
        found.length ? `driver keys: ${found.slice(0, 3).join(", ")}${found.length > 3 ? ` +${found.length - 3}` : ""}` : "no driver globals",
        tells.webdriver ? (tells.webdriver.getterNative === false || tells.webdriver.definedOn === "navigator" ? "webdriver patched" : "native webdriver getter") : null,
        tells.input?.untrusted ? plural(tells.input.untrusted, "scripted input") : null
      ]);
    }
  },
  {
    name: "Behavioural classification",
    slug: "behavioural-classification",
    reasons: ["behavior_score_low", "behavior_score_borderline"],
    available: ({ client }) => Boolean(client?.behavior),
    observe: ({ client }) => {
      const behavior = client.behavior;
      const counts = behavior.summary?.eventCounts || {};
      const events = Object.values(counts).reduce((sum, value) => sum + (Number(value) || 0), 0);
      return join([`score ${behavior.score ?? "n/a"}`, plural(events, "event")]);
    }
  },
  {
    name: "Optional human check",
    slug: "human-check",
    reasons: [],
    available: ({ client }) => client?.challenge?.completed === true,
    unavailable: () => "not taken",
    observe: () => "completed"
  }
];

const SEVERITY_RANK = { high: 3, medium: 2, low: 1 };

export function buildCheckRows(report) {
  const context = { server: report?.server || {}, client: report?.client || null };
  const reasons = Array.isArray(report?.verdict?.reasons) ? report.verdict.reasons : [];

  return CHECKS
    .filter((check) => check.name !== "Managed bot score" || context.server.cloudflareBotManagement?.available === true)
    .filter((check) => check.name !== "TLS fingerprint" || context.server.cloudflareBotManagement?.available === true)
    .map((check) => {
      const available = check.available ? check.available(context) : true;
      if (!available) {
        return row(check.name, "na", check.unavailable ? check.unavailable(context) : "not collected", null);
      }
      const matched = reasons
        .filter((reason) => check.reasons.includes(reason.id))
        .sort((a, b) => (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0));
      const worst = matched[0];
      let status = !worst ? "pass" : worst.severity === "high" ? "fail" : "warn";
      let finding = worst ? `${worst.message}${matched.length > 1 ? ` (+${matched.length - 1} more)` : ""}` : null;
      const extra = status === "pass" && check.extraStatus ? check.extraStatus(context) : null;
      if (extra) ({ status, finding } = extra);
      const observed = safeObserve(check, context, matched);
      if (!observed && !worst) return row(check.name, "na", "no data returned", null);
      return row(check.name, status, observed || "no data returned", finding);
    });
}

function row(name, status, result, finding) {
  const check = CHECKS.find((entry) => entry.name === name);
  return { name, status, ...CHECK_STATUS[status], result, finding, slug: check?.slug || null };
}

function safeObserve(check, context, matched) {
  try {
    return check.observe(context, matched);
  } catch (_) {
    return null;
  }
}

export function describeUserAgent(userAgent) {
  const ua = String(userAgent || "");
  if (!ua) return "no User-Agent";
  // Order matters: Edge, Opera and headless builds also carry a Chrome token.
  const token = ["HeadlessChrome", "Edg", "OPR", "CriOS", "FxiOS", "Firefox", "Chrome"]
    .map((name) => {
      const match = new RegExp(`\\b${name}/(\\d+)`).exec(ua);
      return match ? [null, name, match[1]] : null;
    })
    .find(Boolean);
  const safari = /Version\/(\d+).*Safari/.exec(ua);
  const browser = token || (safari ? [null, "Safari", safari[1]] : null);
  const names = { Edg: "Edge", OPR: "Opera", CriOS: "Chrome", FxiOS: "Firefox" };
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /CrOS/.test(ua) ? "ChromeOS" : /Linux/.test(ua) ? "Linux" : null;
  const name = browser ? `${names[browser[1]] || browser[1]} ${browser[2]}` : ua.split(/[\s/]/)[0];
  return os ? `${name} on ${os}` : name;
}

function shortRenderer(renderer) {
  const inner = /^ANGLE \((.*)\)$/.exec(renderer)?.[1] || renderer;
  const parts = inner.split(",").map((part) => part.trim()).filter(Boolean);
  const label = parts.length > 1 ? parts[1] : parts[0];
  return label.length > 40 ? `${label.slice(0, 39)}…` : label;
}

function plural(count, noun) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function join(parts) {
  const present = parts.filter(Boolean);
  return present.length ? present.join(" · ") : null;
}
