import { INTERACTION_CHECK_IDS } from "./interaction-checks.js";
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
    group: "fingerprint",
    pass: "Headers and client hints agree",
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
    group: "fingerprint",
    pass: "No extra proxy headers",
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
    group: "fingerprint",
    pass: "Network owner is not a hosting provider",
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
    group: "fingerprint",
    pass: "No VPN, proxy or Tor flags",
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
    group: "automation",
    pass: "Cloudflare bot score is not low",
    slug: "managed-bot-score",
    reasons: ["managed_bot_score_low", "managed_bot_score_borderline", "cloudflare_verified_bot"],
    available: ({ server }) => server.cloudflareBotManagement?.available === true,
    unavailable: () => "Bot Management not active",
    observe: ({ server }) => {
      const bot = server.cloudflareBotManagement;
      return join([`score ${bot.score ?? "n/a"} of 99`, bot.verifiedBot ? "verified bot" : null]);
    }
  },
  {
    name: "TLS fingerprint",
    group: "fingerprint",
    pass: "TLS handshake recorded for comparison",
    slug: "tls-fingerprint",
    reasons: [],
    available: ({ server }) => Boolean(server.cloudflareBotManagement?.ja4 || server.cloudflareBotManagement?.ja3Hash),
    unavailable: () => "no JA4 or JA3 fingerprint",
    observe: ({ server }) => {
      const bot = server.cloudflareBotManagement;
      return join([server.cf?.tlsVersion, bot.ja4 ? `JA4 ${bot.ja4}` : `JA3 ${bot.ja3Hash}`]);
    }
  },
  {
    name: "Browser data",
    group: "automation",
    pass: ({ client }) => client?.browser?.webdriver === true ? "WebDriver flag is set" : "WebDriver not detected",
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
    group: "fingerprint",
    pass: "GPU, fonts and canvas read normally",
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
    group: "fingerprint",
    pass: ({ client }) => client?.surfaces?.extensions?.enabled ? `${client.surfaces.extensions.detectedCount || 0} of ${client.surfaces.extensions.checked || 0} extensions visible` : "Extension probe did not run",
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
    group: "fingerprint",
    pass: "Heap readings look ordinary",
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
    group: "fingerprint",
    pass: "Window, worker and iframe agree",
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
    group: "fingerprint",
    pass: "WebRTC address matches the request",
    slug: "webrtc-clues",
    reasons: ["webrtc_public_ip_mismatch"],
    available: ({ client }) => client?.network?.webrtc?.supported !== false && (client?.network?.webrtc?.candidates || []).length > 0,
    unavailable: ({ client }) => client?.network?.webrtc?.supported === false ? "not supported" : "no candidates (blocked or offline)",
    observe: (report) => buildWebRtcComparison(report).Status
  },
  {
    name: "Latency",
    group: "fingerprint",
    pass: "Round-trip times look ordinary",
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
    group: "automation",
    pass: "No remote-control tells found",
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
    group: "behavior",
    pass: "Pointer and key timing look human",
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
    name: "Interaction",
    group: "behavior",
    pass: "Test input arrived like a person's",
    slug: "interaction",
    reasons: INTERACTION_CHECK_IDS,
    // A completed test whose checks are all not-judged has no evidence either, so it reads as not taken.
    available: ({ client }) => client?.interaction?.task?.completed === true && (client.interaction.checks || []).some((check) => check.status !== "na"),
    unavailable: () => "not taken",
    observe: ({ client }) => {
      const checks = client.interaction.checks || [];
      const judged = checks.filter((check) => check.status !== "na").length;
      const seconds = client.interaction.task.durationMs;
      return join([
        Number.isFinite(seconds) ? `${(seconds / 1000).toFixed(1)} s from Start to Submit` : null,
        `${judged} of ${checks.length} checks judged`
      ]);
    }
  }
];

const SEVERITY_RANK = { high: 3, medium: 2, low: 1 };

export function buildCheckRows(report) {
  const context = { server: report?.server || {}, client: report?.client || null };
  const reasons = Array.isArray(report?.verdict?.reasons) ? report.verdict.reasons : [];

  return CHECKS
    .map((check) => {
      const available = check.available ? check.available(context) : true;
      if (!available) {
        return row(check, "na", check.unavailable ? check.unavailable(context) : "not collected", null);
      }
      const matched = reasons
        .filter((reason) => check.reasons.includes(reason.id))
        .sort((a, b) => (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0));
      const worst = matched[0];
      let status = !worst ? "pass" : worst.severity === "high" ? "fail" : "warn";
      let finding = worst ? `${worst.message}${matched.length > 1 ? ` (+${matched.length - 1} more)` : ""}` : null;
      const extra = status === "pass" && check.extraStatus ? check.extraStatus(context) : null;
      if (extra) ({ status, finding } = extra);
      const plain = extra?.summary || (worst ? REASON_PLAIN[worst.id] || CHECK_CONCERN[check.name] : null);
      const observed = safeObserve(check, context, matched);
      if (!observed && !worst) return row(check, "na", "no data returned", null);
      return row(check, status, observed || "no data returned", finding, context, plain);
    });
}

// result is the raw observed value and finding the server's own message: both go in the details only.
// summary is the plain-language result, the only text the list and the verdict card show. It is the
// check's pass sentence, the phrase for the worst reason that fired, or the check's concern.
function row(check, status, result, finding, context = null, plain = null) {
  const summary = status === "na" ? result : status === "pass" ? passSummary(check, context) : plain || CHECK_CONCERN[check.name];
  return { name: check.name, group: check.group, status, ...CHECK_STATUS[status], result, summary, finding, slug: check.slug || null };
}

// Plain-language phrase for each reason the server can score. Raw API names and the server's messages
// stay in the finding; this is what a reader sees.
export const REASON_PLAIN = {
  server_missing_ua: "No browser identity sent",
  proxy_headers: "Extra proxy headers sent",
  datacenter_asn_heuristic: "Network belongs to a hosting provider",
  ip_tor: "Tor exit address",
  ip_proxy: "Proxy address",
  ip_vpn: "VPN address",
  ip_datacenter: "Hosting or datacenter address",
  ip_abuser: "Address flagged for abuse",
  ip_crawler: "Crawler address",
  ipqs_high_fraud_score: "High fraud score for this address",
  managed_bot_score_low: "Bot score is low",
  managed_bot_score_borderline: "Bot score is borderline",
  cloudflare_verified_bot: "Verified bot traffic",
  navigator_webdriver: "WebDriver detected",
  client_headless_user_agent: "Headless browser detected",
  automation_globals: "Automation tools detected on the page",
  cdp_serialization_signal: "Remote debugging traces found",
  ua_platform_mismatch: "Browser OS does not match its user agent",
  worker_platform_mismatch: "Worker reports a different platform",
  iframe_platform_mismatch: "Frame reports a different platform",
  timezone_mismatch: "Timezone does not match the IP location",
  screen_viewport_impossible: "Window is larger than the screen",
  request_client_ua_mismatch: "Request and browser user agents differ",
  accept_language_mismatch: "Language headers differ from the browser",
  client_hint_platform_mismatch: "Client hints disagree on platform",
  client_hint_mobile_mismatch: "Client hints disagree on mobile",
  client_hint_high_entropy_mismatch: "Client hints disagree on detailed platform data",
  ua_data_high_entropy_mismatch: "Platform data differs between browser contexts",
  mobile_touch_mismatch: "Mobile user agent without touch support",
  notification_permission_default_state: "Notification permission in an unusual state",
  notification_permission_contradiction: "Notification permission reports contradict",
  empty_plugins_chromium: "No browser plugins reported",
  prototype_getter_not_native: "Browser property looks patched",
  plugin_reference_mismatch: "Plugin list is internally inconsistent",
  plugin_item_overflow: "Plugin list behaves unusually",
  webgl_missing: "No WebGL graphics support",
  canvas_error: "Canvas drawing blocked or failed",
  webrtc_public_ip_mismatch: "WebRTC address differs from the request",
  browser_edge_latency_gap: "Timing disagrees with the connection",
  performance_memory_anomaly: "Heap readings look impossible",
  behavior_score_low: "Pointer and key input look automated",
  behavior_score_borderline: "Pointer and key input are borderline",
  interaction_report_invalid: "Interaction report could not be read",
  webdriver_own_property: "WebDriver flag redefined in the browser",
  webdriver_getter_patched: "WebDriver flag patched",
  native_function_patched: "Browser functions replaced by script",
  document_automation_keys: "Automation keys found on the page",
  synthetic_input: "Input generated by script",
  input_while_hidden: "Input arrived while the page was hidden",
  input_without_focus: "Input arrived without page focus",
  zero_size_window: "Window has no visible size",
  int_trusted: "Test input was generated by script",
  int_click_chain: "Click events arrived out of order",
  int_click_detail: "Click count looks wrong",
  int_screen_coords: "Click position does not match the screen",
  int_coalesced: "Pointer movement looks synthetic",
  int_premove: "No movement before the click",
  int_centre: "Clicks land on unnatural spots",
  int_press: "Press length looks scripted",
  int_key_chain: "Key events arrived out of order",
  int_value_source: "Text was set by script, not typed",
  int_key_rhythm: "Typing rhythm looks scripted",
  int_dwell: "Key hold times look scripted",
  int_task_speed: "Test finished unnaturally fast"
};

// What a check is about, used when a flagged reason has no phrase above.
const CHECK_CONCERN = {
  "Request profile": "Request does not match the browser",
  "Proxy indicators": "Extra proxy headers sent",
  "Datacenter pattern": "Network belongs to a hosting provider",
  "VPN / proxy / Tor intelligence": "Address flagged as VPN, proxy or Tor",
  "Managed bot score": "Bot score is low",
  "TLS fingerprint": "TLS fingerprint looks unusual",
  "Browser data": "Browser reports automation",
  "Browser fingerprint": "Graphics or canvas readings missing",
  "Fingerprint surfaces": "Browser surfaces look unusual",
  "Performance memory pings": "Heap readings look impossible",
  "Worker consistency": "Browser contexts disagree",
  "WebRTC network clues": "WebRTC address differs from the request",
  "Latency": "Timing disagrees with the connection",
  "Remote-control tells": "Remote-control tells found",
  "Behavioural classification": "Pointer and key input look automated",
  "Interaction": "Test input looks scripted"
};

function passSummary(check, context) {
  if (typeof check.pass === "function") return check.pass(context || {});
  return check.pass || "Nothing unusual";
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

// The three groups the verdict card and the checks list both use, in display order.
export const CHECK_GROUPS = [
  { key: "automation", label: "Automation flags" },
  { key: "behavior", label: "Behavior" },
  { key: "fingerprint", label: "Fingerprint consistency" }
];

const STATUS_RANK = { fail: 3, warn: 2, pass: 1, na: 0 };

// One line per group for the verdict card, derived from the same rows the checks list shows.
// judged = rows that produced a result (not n/a); flagged = judged rows that failed or warned.
export function buildVerdictGroupLines(rows) {
  return CHECK_GROUPS.map(({ key, label }) => {
    const items = rows.filter((row) => row.group === key);
    const judged = items.filter((row) => row.status !== "na");
    const flagged = judged.filter((row) => row.status === "fail" || row.status === "warn");
    const status = items.reduce((worst, row) => (STATUS_RANK[row.status] > STATUS_RANK[worst] ? row.status : worst), "na");
    return {
      key,
      label,
      anchor: `checks-${key}`,
      status,
      symbol: CHECK_STATUS[status].symbol,
      statusLabel: CHECK_STATUS[status].label,
      sentence: groupSentence(key, judged, flagged)
    };
  });
}

function groupSentence(key, judged, flagged) {
  if (!judged.length) return "Not checked in this run";
  if (key === "fingerprint") {
    return flagged.length
      ? `${flagged.length} of ${judged.length} inconsistent: ${flagged.map((row) => row.name).join(", ")}`
      : `All ${judged.length} ${judged.length === 1 ? "check agrees" : "checks agree"}`;
  }
  if (key === "automation") {
    if (!flagged.length) return "none found";
    return flagged.length === 1 ? flagged[0].summary : `${flagged.length} flags: ${flagged.map((row) => row.summary).join(", ")}`;
  }
  // Behavior: the first concern, or the first clean result when nothing is flagged.
  if (!flagged.length) return judged[0].summary;
  return flagged.length === 1 ? flagged[0].summary : `${flagged.length} concerns: ${flagged.map((row) => row.summary).join(", ")}`;
}
