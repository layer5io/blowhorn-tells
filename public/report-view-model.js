import { bool, formatList, formatMs, formatValue } from "./utils.js";

export function buildReasonEvidence(reason) {
  const data = reason?.data;
  if (!data || typeof data !== "object") return [];

  if (reason.id === "webrtc_public_ip_mismatch") {
    return compactEntries([
      entry("HTTP request IP", data.serverIp),
      entry("WebRTC public IPs", formatList(data.publicIps)),
      entry("Different public IPs", formatList(data.differentPublicIps), "alert"),
      entry("Private / mDNS", `${formatList(data.privateIps)} / ${data.mdnsHosts?.length || 0} mDNS`),
      entry("Candidates", summarizeIceCandidates(data.candidates))
    ]);
  }

  if (reason.id === "behavior_score_low" || reason.id === "behavior_score_borderline") {
    return compactEntries([
      entry("Verdict sample", formatMs(data.elapsedMs)),
      entry("Events", summarizeEventCounts(data.eventCounts)),
      entry("Pointer samples", data.pointerMoveSamples),
      entry("Pointer distance", data.pointerDistance),
      entry("Pointer speed jitter", data.pointerSpeedStdDev),
      entry("RAF jitter", data.rafStdDev),
      entry("Human check", data.challengeCompleted === true ? "complete" : "not complete")
    ]);
  }

  return Object.entries(data).slice(0, 8).map(([label, value]) => entry(label, formatValue(value)));
}

export function buildNetworkIdentitySummary(report) {
  const server = report?.server || {};
  const cf = server.cf || {};
  const ipIntel = server.ipIntel || {};
  const normalized = ipIntel.normalized || {};
  const raw = ipIntel.raw || {};
  const bot = server.cloudflareBotManagement || {};

  return {
    "Request IP": server.ip || "n/a",
    Location: formatLocation(cf, raw.location, normalized),
    "Provider / ASN": formatProvider(server, raw, normalized),
    "Network type": formatList([normalized.companyType, normalized.asnType].filter(Boolean)),
    "Privacy flags": `proxy=${bool(normalized.isProxy)} vpn=${bool(normalized.isVpn)} tor=${bool(normalized.isTor)} dc=${bool(normalized.isDatacenter)} crawler=${bool(normalized.isCrawler)}`,
    "Datacenter heuristic": server.datacenterHeuristic?.isLikelyDatacenter === true ? `matched ${server.datacenterHeuristic.matchedPattern || "pattern"}` : "not matched",
    "Cloudflare edge": formatList([cf.colo, cf.httpProtocol, cf.tlsVersion].filter(Boolean), "n/a"),
    "Edge latency": formatEdgeLatency(report),
    "Managed bot": bot.available ? `score=${bot.score ?? "n/a"} verified=${bool(bot.verifiedBot)} js=${bot.jsDetection?.passed === true ? "passed" : "not passed"}` : "n/a",
    "TLS fingerprint": formatList([bot.ja4, bot.ja3Hash, cf.tlsClientExtensionsSha1].filter(Boolean), "n/a"),
    "IP intel lookup": ipIntel.enabled ? `${ipIntel.provider || "active"} status=${ipIntel.status ?? "n/a"} ${formatMs(ipIntel.elapsedMs)}` : "disabled"
  };
}

export function buildWebRtcComparison(report) {
  const webrtc = report?.client?.network?.webrtc || {};
  const candidates = Array.isArray(webrtc.candidates) ? webrtc.candidates : [];
  const different = webrtc.differentPublicIps || [];
  const additional = webrtc.additionalPublicIps || [];
  const serverIp = webrtc.serverIp || report?.server?.ip || null;

  return {
    Status: webrtc.supported === false ? "not supported" : different.length ? "mismatch detected" : webrtc.publicIpMatchedServer ? "matched request IP" : candidates.length ? "no matching public IP" : "no candidates",
    "HTTP request IP": serverIp || "n/a",
    "WebRTC public IPs": formatList(webrtc.publicIps),
    "Additional public IPs": formatList(additional),
    "Different public IPs": formatList(different),
    "Private IPs": formatList(webrtc.privateIps),
    "mDNS hosts": webrtc.mdnsHosts?.length || 0,
    "Candidate types": summarizeCandidateTypes(candidates),
    "Candidate details": summarizeIceCandidates(candidates)
  };
}

export function buildBehaviorSummary(report) {
  const current = report?.client?.behavior || {};
  const summary = current.summary || {};
  const verdictSample = findBehaviorVerdictSample(report);
  const freshness = getBehaviorFreshness(report);

  return {
    "Current score": current.score ?? "n/a",
    "Current sample": formatMs(summary.elapsedMs),
    "Verdict sample": verdictSample ? formatMs(verdictSample.elapsedMs) : "n/a",
    "Rescore status": freshness.message,
    Events: summarizeEventCounts(summary.eventCounts),
    "Pointer samples": summary.pointerMoveSamples ?? "n/a",
    "Pointer distance": summary.pointerDistance ?? "n/a",
    "Pointer speed jitter": summary.pointerSpeedStdDev ?? "n/a",
    "RAF jitter": summary.rafStdDev ?? "n/a",
    "Human check": summary.challengeCompleted === true ? "complete" : "not complete"
  };
}

export function buildWorkerConsistencyRows(report) {
  const browser = report?.client?.browser || {};
  const workers = report?.client?.workers || {};
  const contexts = {
    Window: browser,
    "Web Worker": workers.webWorker,
    Iframe: workers.iframe,
    "Service Worker": workers.serviceWorker
  };

  return [
    compareContextValue("Platform", contexts, "platform"),
    compareContextValue("Language", contexts, "language"),
    compareContextValue("Hardware threads", contexts, "hardwareConcurrency"),
    compareContextValue("Device memory", contexts, "deviceMemory"),
    compareContextValue("WebDriver", contexts, "webdriver"),
    compareContextValue("User-Agent", contexts, "userAgent")
  ];
}

export function buildRequestConsistencyRows(report) {
  const server = report?.server || {};
  const browser = report?.client?.browser || {};
  const consistency = report?.client?.consistency || {};

  return [
    compareRequestBrowserValue("User-Agent", server.userAgent, browser.userAgent, consistency.userAgentMismatch),
    compareRequestBrowserValue("Accept-Language", server.headers?.["accept-language"], formatList(browser.languages), consistency.acceptLanguageMismatch),
    compareRequestBrowserValue("UA-CH platform", stripClientHintQuotes(server.headers?.["sec-ch-ua-platform"]), browser.userAgentData?.platform, consistency.clientHintPlatformMismatch),
    compareRequestBrowserValue("UA-CH mobile", stripClientHintQuotes(server.headers?.["sec-ch-ua-mobile"]), formatClientHintMobile(browser.userAgentData?.mobile), consistency.clientHintMobileMismatch)
  ];
}

export function getBehaviorFreshness(report) {
  const currentElapsed = report?.client?.behavior?.summary?.elapsedMs;
  const verdictSample = findBehaviorVerdictSample(report);
  if (!verdictSample || !Number.isFinite(Number(currentElapsed))) {
    return { isStale: false, message: "verdict and display are aligned" };
  }

  const delta = Number(currentElapsed) - Number(verdictSample.elapsedMs);
  if (delta > 1000) {
    return {
      isStale: true,
      message: `verdict used earlier behaviour; rerun to rescore current ${formatMs(currentElapsed)} sample`
    };
  }
  return { isStale: false, message: "verdict and behaviour sample are aligned" };
}

function entry(label, value, tone = "neutral") {
  return { label, value, tone };
}

function compactEntries(entries) {
  return entries.filter((item) => item.value !== undefined && item.value !== null && item.value !== "");
}

function summarizeIceCandidates(candidates) {
  if (!Array.isArray(candidates) || !candidates.length) return "none";
  return candidates.map((candidate) => {
    const visibility = candidate.isPublic ? "public" : candidate.isPrivate ? "private" : candidate.isMdns ? "mDNS" : "unknown";
    return `${candidate.address || "n/a"}:${candidate.port || "n/a"} ${candidate.type || "unknown"} ${visibility}`;
  }).join(" | ");
}

function summarizeCandidateTypes(candidates) {
  if (!Array.isArray(candidates) || !candidates.length) return "none";
  const counts = {};
  for (const candidate of candidates) {
    const type = candidate.type || "unknown";
    counts[type] = (counts[type] || 0) + 1;
  }
  return summarizeEventCounts(counts);
}

function summarizeEventCounts(counts) {
  if (!counts || typeof counts !== "object") return "none";
  return Object.entries(counts).map(([key, value]) => `${key}:${value}`).join(" ") || "none";
}

function findBehaviorVerdictSample(report) {
  const reasons = report?.verdict?.reasons;
  if (!Array.isArray(reasons)) return null;
  const reason = reasons.find((item) => item.id === "behavior_score_low" || item.id === "behavior_score_borderline");
  return reason?.data && typeof reason.data === "object" ? reason.data : null;
}

function formatLocation(cf, location, normalized) {
  const city = cf.city || location?.city;
  const region = cf.region || location?.state;
  const country = cf.country || normalized.country || location?.country_code || location?.country;
  const timezone = cf.timezone || normalized.timezone || location?.timezone;
  return formatList([city, region, country, timezone].filter(Boolean), "n/a");
}

function formatProvider(server, raw, normalized) {
  const asn = server.cf?.asn || normalized.asn || raw.asn?.asn;
  const org = server.cf?.asOrganization || normalized.providerName || raw.company?.name || raw.asn?.org;
  const route = raw.asn?.route || raw.company?.network;
  return formatList([asn ? `AS${asn}` : null, org, route].filter(Boolean), "n/a");
}

function formatEdgeLatency(report) {
  const cf = report?.server?.cf || {};
  const ping = report?.client?.network?.ping || {};
  return `browser median=${formatMs(ping.medianMs)} tcp=${formatMs(cf.clientTcpRtt)} quic=${formatMs(cf.clientQuicRtt)}`;
}

function compareContextValue(label, contexts, key) {
  const values = Object.fromEntries(
    Object.entries(contexts).map(([name, context]) => [name, formatContextValue(context?.[key])])
  );
  const presentValues = Object.values(values).filter((value) => value !== "n/a");
  const uniqueValues = new Set(presentValues);
  return {
    label,
    values,
    status: uniqueValues.size > 1 ? "differs" : presentValues.length ? "aligned" : "missing"
  };
}

function compareRequestBrowserValue(label, requestValue, browserValue, mismatch) {
  const values = {
    Request: formatContextValue(requestValue),
    Browser: formatContextValue(browserValue)
  };
  const presentValues = [values.Request, values.Browser].filter((value) => value !== "n/a");
  return {
    label,
    values,
    status: mismatch ? "differs" : presentValues.length === 2 ? "aligned" : "missing"
  };
}

function formatContextValue(value) {
  if (value === null) return "null";
  return formatValue(value);
}

function stripClientHintQuotes(value) {
  if (!value) return value;
  return String(value).trim().replace(/^"|"$/g, "");
}

function formatClientHintMobile(value) {
  if (typeof value !== "boolean") return value;
  return value ? "?1" : "?0";
}
