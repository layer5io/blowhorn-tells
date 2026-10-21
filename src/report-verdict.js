import { getSuspiciousProxyHeaders } from "./proxy-headers.js";
import {
  collectClientHintHighEntropyMismatches,
  collectUserAgentDataHighEntropyMismatches,
  languageListsOverlap,
  normalizeBrowserLanguages,
  normalizePlatformLabel,
  parseClientHintBoolean,
  parseAcceptLanguage,
  parseClientHintToken
} from "./header-consistency.js";

export function enrichClientConsistency(client, server) {
  if (!client || typeof client !== "object") return client;

  const consistency = { ...(client.consistency || {}) };
  const requestUserAgent = server?.userAgent || null;
  const browserUserAgent = client.browser?.userAgent || null;
  if (requestUserAgent && browserUserAgent && requestUserAgent !== browserUserAgent) {
    consistency.userAgentMismatch = { requestUserAgent, browserUserAgent };
  }

  const requestLanguages = parseAcceptLanguage(server?.headers?.["accept-language"]);
  const browserLanguages = normalizeBrowserLanguages(client.browser?.languages);
  if (requestLanguages.length && browserLanguages.length && !languageListsOverlap(requestLanguages, browserLanguages)) {
    consistency.acceptLanguageMismatch = {
      requestLanguages,
      browserLanguages
    };
  }

  const requestUaPlatform = parseClientHintToken(server?.headers?.["sec-ch-ua-platform"]);
  const browserUaPlatform = client.browser?.userAgentData?.platform || null;
  if (requestUaPlatform && browserUaPlatform && normalizePlatformLabel(requestUaPlatform) !== normalizePlatformLabel(browserUaPlatform)) {
    consistency.clientHintPlatformMismatch = {
      requestPlatform: requestUaPlatform,
      browserPlatform: browserUaPlatform
    };
  }

  const requestUaMobile = parseClientHintBoolean(server?.headers?.["sec-ch-ua-mobile"]);
  const browserUaMobile = client.browser?.userAgentData?.mobile;
  if (requestUaMobile != null && typeof browserUaMobile === "boolean" && requestUaMobile !== browserUaMobile) {
    consistency.clientHintMobileMismatch = {
      requestMobile: requestUaMobile,
      browserMobile: browserUaMobile
    };
  }

  const clientHintHighEntropyMismatches = collectClientHintHighEntropyMismatches(
    server?.headers,
    client.browser?.userAgentData?.highEntropy
  );
  if (clientHintHighEntropyMismatches.length) {
    consistency.clientHintHighEntropyMismatch = {
      mismatches: clientHintHighEntropyMismatches
    };
  }

  const uaDataHighEntropyMismatch = collectUserAgentDataHighEntropyMismatches({
    Window: client.browser,
    "Web Worker": client.workers?.webWorker,
    Iframe: client.workers?.iframe,
    "Service Worker": client.workers?.serviceWorker
  });
  if (uaDataHighEntropyMismatch) {
    consistency.userAgentDataHighEntropyMismatch = uaDataHighEntropyMismatch;
  }

  const uaLooksMobile = /android|iphone|ipad|ipod|mobile/i.test(browserUserAgent || requestUserAgent || "");
  const touchPoints = Number(client.browser?.maxTouchPoints);
  const touchEventPresent = client.browser?.features?.touchEvent;
  if (uaLooksMobile && Number.isFinite(touchPoints) && touchPoints === 0 && touchEventPresent === false) {
    consistency.mobileTouchMismatch = {
      userAgent: browserUserAgent || requestUserAgent,
      maxTouchPoints: touchPoints,
      touchEvent: touchEventPresent
    };
  }

  const browserTimezone = client.browser?.timezone || null;
  const ipTimezone = server?.ipIntel?.normalized?.timezone || server?.cf?.timezone || null;
  if (browserTimezone && ipTimezone && browserTimezone !== ipTimezone) {
    consistency.timezoneMismatch = { browserTimezone, ipTimezone };
  }

  const serverIp = server?.ip || null;
  const webrtc = client.network?.webrtc;
  if (serverIp && webrtc?.publicIps?.length) {
    if (!client.network) client.network = {};
    const hasServerIp = webrtc.publicIps.includes(serverIp);
    const different = webrtc.publicIps.filter((ip) => ip !== serverIp);
    client.network.webrtc = {
      ...webrtc,
      serverIp,
      publicIpMatchedServer: hasServerIp,
      additionalPublicIps: hasServerIp ? different : [],
      differentPublicIps: hasServerIp ? [] : different,
      publicIpLeakDifferentFromServer: !hasServerIp && different.length > 0
    };
  }

  return { ...client, consistency };
}

export function scoreReport(report) {
  const reasons = [];
  let score = 100;

  const server = report.server || {};
  const client = report.client || {};
  const browser = client.browser || {};
  const behavior = client.behavior || {};
  const fingerprints = client.fingerprints || {};
  const automation = client.automation || {};
  const consistency = client.consistency || {};
  const network = client.network || {};
  const surfaces = client.surfaces || {};
  const userAgent = browser.userAgent || "";
  const isMobileBrowser = /android|iphone|ipad|ipod|mobile/i.test(userAgent);

  const penalize = (points, id, severity, message, data = undefined) => {
    score -= points;
    reasons.push({ id, severity, points, message, data });
  };

  if (!server.userAgent) penalize(25, "server_missing_ua", "high", "Server saw no User-Agent header.");
  for (const reason of server.headerSignals?.reasons || []) {
    const points = reason.severity === "high" ? 25 : reason.severity === "medium" ? 12 : 5;
    penalize(points, reason.id, reason.severity, reason.message);
  }

  const suspiciousProxyHeaders = getSuspiciousProxyHeaders(server.proxyHeaders);
  if (Object.keys(suspiciousProxyHeaders).length) {
    penalize(20, "proxy_headers", "medium", "Request includes explicit proxy forwarding headers beyond Cloudflare's normal Worker forwarding context.", suspiciousProxyHeaders);
  }

  if (server.datacenterHeuristic?.isLikelyDatacenter) {
    penalize(15, "datacenter_asn_heuristic", "medium", "Cloudflare ASN organization resembles hosting/datacenter provider.", server.datacenterHeuristic);
  }

  const ipIntel = server.ipIntel?.normalized;
  if (ipIntel) {
    if (ipIntel.isTor) penalize(45, "ip_tor", "high", "IP intelligence says IP is Tor exit traffic.", ipIntel);
    if (ipIntel.isProxy) penalize(35, "ip_proxy", "high", "IP intelligence says IP is proxy traffic.", ipIntel);
    if (ipIntel.isVpn) penalize(30, "ip_vpn", "high", "IP intelligence says IP is VPN traffic.", ipIntel);
    if (ipIntel.isDatacenter) penalize(18, "ip_datacenter", "medium", "IP intelligence says IP belongs to hosting/datacenter space.", ipIntel);
    if (ipIntel.isAbuser) penalize(15, "ip_abuser", "medium", "IP intelligence marks IP as abusive or high-risk.", ipIntel);
    if (ipIntel.isCrawler) penalize(35, "ip_crawler", "high", "IP intelligence says IP belongs to crawler traffic.", ipIntel);
    if (typeof ipIntel.fraudScore === "number" && ipIntel.fraudScore >= 85) {
      penalize(20, "ipqs_high_fraud_score", "high", "IPQS fraud score is high.", ipIntel);
    }
  }

  const cfBot = server.cloudflareBotManagement;
  if (cfBot?.available) {
    if (typeof cfBot.score === "number" && cfBot.score < 30 && !cfBot.verifiedBot) {
      penalize(30, "managed_bot_score_low", "high", "Managed bot score is below 30.", cfBot);
    } else if (typeof cfBot.score === "number" && cfBot.score < 50 && !cfBot.verifiedBot) {
      penalize(12, "managed_bot_score_borderline", "medium", "Managed bot score is below 50.", cfBot);
    }
    if (cfBot.verifiedBot === true) {
      penalize(35, "cloudflare_verified_bot", "high", "Cloudflare identifies this request as verified bot traffic.", cfBot);
    }
  }

  if (browser.webdriver === true) penalize(40, "navigator_webdriver", "high", "navigator.webdriver is true.");
  if (/headlesschrome|phantomjs|slimerjs/i.test(userAgent)) {
    penalize(40, "client_headless_user_agent", "high", "Client User-Agent contains headless marker.");
  }
  if (automation.present?.length) {
    penalize(30, "automation_globals", "high", "Known automation globals found on window.", automation.present);
  }
  if (automation.cdpSerializationSignal === true) {
    penalize(20, "cdp_serialization_signal", "medium", "Chrome DevTools Protocol serialization signal tripped.");
  }

  if (consistency.uaPlatformMismatch) {
    penalize(18, "ua_platform_mismatch", "medium", "User-Agent OS and navigator.platform do not align.", consistency.uaPlatformMismatch);
  }
  if (consistency.workerPlatformMismatch) {
    penalize(18, "worker_platform_mismatch", "medium", "Window navigator.platform differs from Web Worker navigator.platform.", consistency.workerPlatformMismatch);
  }
  if (consistency.iframePlatformMismatch) {
    penalize(12, "iframe_platform_mismatch", "medium", "Window navigator.platform differs from iframe navigator.platform.", consistency.iframePlatformMismatch);
  }
  if (consistency.timezoneMismatch) {
    penalize(14, "timezone_mismatch", "medium", "Browser timezone differs from IP geolocation timezone.", consistency.timezoneMismatch);
  }
  if (consistency.screenViewportImpossible) {
    penalize(12, "screen_viewport_impossible", "medium", "Viewport dimensions exceed screen dimensions.", consistency.screenViewportImpossible);
  }
  if (consistency.userAgentMismatch) {
    penalize(22, "request_client_ua_mismatch", "high", "Request User-Agent differs from browser-reported User-Agent.", consistency.userAgentMismatch);
  }
  if (consistency.acceptLanguageMismatch) {
    penalize(12, "accept_language_mismatch", "medium", "Request Accept-Language does not align with browser languages.", consistency.acceptLanguageMismatch);
  }
  if (consistency.clientHintPlatformMismatch) {
    penalize(14, "client_hint_platform_mismatch", "medium", "Request UA-CH platform differs from browser-reported UA data platform.", consistency.clientHintPlatformMismatch);
  }
  if (consistency.clientHintMobileMismatch) {
    penalize(12, "client_hint_mobile_mismatch", "medium", "Request UA-CH mobile hint differs from browser-reported UA data mobile flag.", consistency.clientHintMobileMismatch);
  }
  if (consistency.clientHintHighEntropyMismatch) {
    penalize(14, "client_hint_high_entropy_mismatch", "medium", "Request high-entropy UA-CH hints differ from browser-reported UA data.", consistency.clientHintHighEntropyMismatch);
  }
  if (consistency.userAgentDataHighEntropyMismatch) {
    penalize(14, "ua_data_high_entropy_mismatch", "medium", "High-entropy UA data differs across browser execution contexts.", consistency.userAgentDataHighEntropyMismatch);
  }
  if (consistency.mobileTouchMismatch) {
    penalize(12, "mobile_touch_mismatch", "medium", "Mobile User-Agent has no matching touch capability surface.", consistency.mobileTouchMismatch);
  }

  if (browser.permissions?.notifications?.state === "default" && browser.permissions?.notifications?.permission === "default") {
    penalize(8, "notification_permission_default_state", "low", "Notification permission state is 'default'; stealth tooling has historically produced this mismatch.");
  }
  if (browser.plugins?.length === 0 && /chrome|chromium|edg/i.test(userAgent) && !isMobileBrowser) {
    penalize(10, "empty_plugins_chromium", "medium", "Chromium-like browser reports zero plugins.");
  }
  if (browser.prototypeChecks?.nativeGetterFailures?.length) {
    penalize(15, "prototype_getter_not_native", "medium", "Navigator property getter does not look native.", browser.prototypeChecks.nativeGetterFailures);
  }
  if (browser.pluginsConsistency?.referenceMismatch === true) {
    penalize(10, "plugin_reference_mismatch", "medium", "navigator.plugins nested enabledPlugin references are inconsistent.");
  }
  if (browser.pluginsConsistency?.itemOverflowMatchesFirst === false && browser.plugins?.length > 0) {
    penalize(5, "plugin_item_overflow", "low", "navigator.plugins.item overflow behavior differs from expected Chromium behavior.");
  }

  if (fingerprints.webgl?.supported === false) {
    penalize(10, "webgl_missing", "medium", "WebGL unavailable.");
  }
  const canvasError = fingerprints.canvas?.hashError || fingerprints.canvas?.error;
  if (canvasError) {
    penalize(8, "canvas_error", "low", "Canvas fingerprint failed or was blocked.", canvasError);
  }

  if (network.webrtc?.publicIpLeakDifferentFromServer === true) {
    penalize(25, "webrtc_public_ip_mismatch", "high", "WebRTC exposed a public IP different from the HTTP request IP.", network.webrtc);
  }
  if (network.ping?.medianMs != null && server.cf?.clientTcpRtt != null) {
    const browserPing = Number(network.ping.medianMs);
    const cfTcp = Number(server.cf.clientTcpRtt);
    if (Number.isFinite(browserPing) && Number.isFinite(cfTcp) && browserPing > cfTcp * 8 && browserPing > 300) {
      penalize(8, "browser_edge_latency_gap", "low", "Browser-to-edge fetch latency is much higher than Cloudflare TCP RTT.", { browserPing, cfTcp });
    }
  }
  const memoryAnomalies = analyzePerformanceMemorySamples(network.ping?.memorySamples || surfaces.performance?.samples || []);
  if (memoryAnomalies.length) {
    penalize(12, "performance_memory_anomaly", "medium", "performance.memory samples contain impossible heap values.", memoryAnomalies);
  }

  if (typeof behavior.score === "number") {
    if (behavior.score < 0.25) penalize(25, "behavior_score_low", "high", "Behavior score is very low.", behavior.summary);
    else if (behavior.score < 0.5) penalize(12, "behavior_score_borderline", "medium", "Behavior score is borderline.", behavior.summary);
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const classification = score >= 75 ? "likely_human" : score >= 45 ? "suspicious" : "likely_bot";
  const risk = score >= 75 ? "low" : score >= 45 ? "medium" : "high";

  return { score, classification, risk, reasons };
}

function analyzePerformanceMemorySamples(samples) {
  if (!Array.isArray(samples)) return [];
  const anomalies = [];
  for (const sample of samples) {
    if (!sample || sample.supported === false) continue;
    const used = Number(sample.usedJSHeapSize);
    const total = Number(sample.totalJSHeapSize);
    const limit = Number(sample.jsHeapSizeLimit);
    const ratio = Number(sample.usedRatio);
    const data = { t: sample.t ?? null, usedJSHeapSize: used, totalJSHeapSize: total, jsHeapSizeLimit: limit, usedRatio: ratio };

    if (![used, total, limit].every((value) => Number.isFinite(value) && value > 0)) {
      anomalies.push({ id: "memory_non_positive_or_missing", ...data });
    } else {
      if (used > total) anomalies.push({ id: "heap_used_exceeds_total", ...data });
      if (total > limit) anomalies.push({ id: "heap_total_exceeds_limit", ...data });
      if (limit < 128 * 1024 * 1024) anomalies.push({ id: "heap_limit_too_small", ...data });
    }
    if (Number.isFinite(ratio) && (ratio < 0 || ratio > 1.05)) {
      anomalies.push({ id: "heap_ratio_out_of_range", ...data });
    }
  }
  return anomalies.slice(0, 8);
}

export function detectionMatrix(server, client) {
  const cfBot = server?.cloudflareBotManagement;
  const rows = [
    { name: "Request profile", status: "checked", notes: "Headers, client IP, location, ASN, protocol, and timing signals." },
    { name: "Proxy indicators", status: "checked", notes: "Forwarding headers and network identity patterns." },
    { name: "Datacenter pattern", status: "checked", notes: "Hosting and provider signals in the connection profile." }
  ];

  if (server?.ipIntel?.enabled) {
    rows.push({ name: "VPN / proxy / Tor intelligence", status: "checked", notes: "External reputation and privacy-network signals." });
  }

  if (cfBot?.available) {
    rows.push(
      { name: "Managed bot score", status: "checked", notes: "Managed reputation and verified bot signals." },
      { name: "TLS fingerprint", status: "checked", notes: "Connection fingerprint signals included in the report." }
    );
  }

  if (client) {
    rows.push(
      { name: "Browser data", status: "checked", notes: "Navigator, screen, storage, media, permissions, and client hints." },
      { name: "Browser fingerprint", status: "checked", notes: "Canvas, WebGL, audio, fonts, and graphics capability hashes." },
      { name: "Fingerprint surfaces", status: "checked", notes: "Performance memory, resource timing, EME, speech voices, feature policy, and sensor surfaces." },
      { name: "Performance memory pings", status: "checked", notes: "Heap used, heap total, and heap limit are sent with latency pings and checked for impossible values." },
      { name: "Worker consistency", status: "checked", notes: "Cross-context browser consistency checks." },
      { name: "WebRTC network clues", status: "checked", notes: "Candidate and address consistency signals." },
      { name: "Latency", status: "checked", notes: "Browser-to-edge timing signals." },
      { name: "Behavioural classification", status: "checked", notes: "Pointer, key, scroll, focus, timing, and human-check activity." },
      { name: "Optional human check", status: "checked", notes: "Form, confirmation, and table-update interaction signals." }
    );
  }

  return rows;
}
