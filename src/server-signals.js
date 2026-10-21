import { getClientIp, shouldTrustForwardedClientIp } from "./client-ip.js";
import { lookupIpIntel } from "./ip-intelligence.js";
import { isJsonSafeValue } from "./json-safe.js";
import { collectProxyHeaders } from "./proxy-headers.js";
import { parseFiniteSearchParam } from "./search-params.js";
import { SENSITIVE_HEADERS } from "./sensitive-headers.js";
import { redactUrlSecrets } from "./url-redaction.js";

const DATACENTER_ORG_PATTERNS = [
  /amazon|aws|ec2/i,
  /google\s+cloud|google\s+llc|google\s+inc/i,
  /microsoft|azure/i,
  /digitalocean/i,
  /linode|akamai cloud|akamai connected cloud/i,
  /vultr|choopa/i,
  /ovh|soyoustart|kimsufi/i,
  /hetzner/i,
  /leaseweb/i,
  /contabo/i,
  /oracle|oci/i,
  /alibaba|aliyun/i,
  /tencent/i,
  /huawei cloud/i,
  /scaleway/i,
  /packet|equinix metal/i,
  /cloudflare/i,
  /m247/i,
  /data center|datacenter|hosting|colo/i,
  /servers|servermania|rackspace|ionos|1&1/i,
  /quadranet|psychz|sharktech|reliablesite/i,
  /cogent|g-core|fastly/i
];

export function collectServerBasics(request, env = {}) {
  const headers = collectHeaders(request.headers);
  const cf = collectCf(request.cf || {});
  const ip = getClientIp(request.headers, {
    trustForwardedHeaders: shouldTrustForwardedClientIp(env)
  });
  const ua = request.headers.get("user-agent") || "";
  const proxyHeaders = collectProxyHeaders(request.headers, SENSITIVE_HEADERS);
  const url = new URL(request.url);

  return {
    ip,
    url: redactUrlSecrets(request.url),
    method: request.method,
    userAgent: ua,
    headerNames: Object.keys(headers).sort(),
    headers,
    cf,
    proxyHeaders,
    performanceMemory: collectPingPerformanceMemory(url.searchParams)
  };
}

export async function collectServer(request, env) {
  const basics = collectServerBasics(request, env);
  const ip = basics.ip;
  const ua = basics.userAgent;
  const provider = String(env.IP_INTEL_PROVIDER || "ipapi").toLowerCase();

  const datacenterHeuristic = inferDatacenterFromOrg(basics.cf.asOrganization || "");
  const ipIntel = await lookupIpIntel(ip, ua, env, provider);
  const headerSignals = analyzeHeaders(basics.headers, basics.userAgent);

  return {
    ...basics,
    datacenterHeuristic,
    headerSignals,
    ipIntel,
    cloudflareBotManagement: normalizeCloudflareBotManagement(basics.cf.botManagement)
  };
}

function collectHeaders(headers) {
  const out = {};
  for (const [name, value] of headers.entries()) {
    const key = name.toLowerCase();
    out[key] = SENSITIVE_HEADERS.has(key) ? "[redacted]" : value;
  }
  return out;
}

function collectCf(cfRaw) {
  const keys = [
    "asn",
    "asOrganization",
    "colo",
    "country",
    "city",
    "region",
    "regionCode",
    "postalCode",
    "continent",
    "timezone",
    "latitude",
    "longitude",
    "clientTcpRtt",
    "clientQuicRtt",
    "httpProtocol",
    "tlsVersion",
    "tlsCipher",
    "tlsClientRandom",
    "edgeRequestKeepAliveStatus",
    "requestPriority",
    "botManagement"
  ];

  const cf = {};
  for (const key of keys) {
    if (cfRaw[key] !== undefined) cf[key] = cfRaw[key];
  }
  for (const [key, value] of Object.entries(cfRaw)) {
    if (!(key in cf) && isJsonSafeValue(value)) cf[key] = value;
  }
  return cf;
}

function collectPingPerformanceMemory(searchParams) {
  const used = parseFiniteSearchParam(searchParams, "heapUsed");
  const total = parseFiniteSearchParam(searchParams, "heapTotal");
  const limit = parseFiniteSearchParam(searchParams, "heapLimit");
  const ratio = parseFiniteSearchParam(searchParams, "heapRatio");
  if (used == null && total == null && limit == null && ratio == null) return null;
  return {
    usedJSHeapSize: used,
    totalJSHeapSize: total,
    jsHeapSizeLimit: limit,
    usedRatio: ratio
  };
}

function analyzeHeaders(headers, ua) {
  const reasons = [];
  const lowerUa = ua.toLowerCase();
  const hasSecChUa = Boolean(headers["sec-ch-ua"]);
  const isLikelyBrowser = /mozilla|chrome|safari|firefox|edg|opr/i.test(ua);

  if (!ua) reasons.push({ id: "missing_user_agent", severity: "high", message: "User-Agent header missing." });
  if (/headlesschrome|phantomjs|slimerjs|selenium|playwright/i.test(ua)) {
    reasons.push({ id: "automation_user_agent", severity: "high", message: "User-Agent contains automation marker." });
  }
  if (isLikelyBrowser && !headers.accept) {
    reasons.push({ id: "missing_accept", severity: "medium", message: "Browser-like request missing Accept header." });
  }
  if (isLikelyBrowser && !headers["accept-language"]) {
    reasons.push({ id: "missing_accept_language", severity: "medium", message: "Browser-like request missing Accept-Language header." });
  }
  if ((/chrome|chromium|edg|opr/i.test(ua) && !/headlesschrome/i.test(ua)) && !hasSecChUa) {
    reasons.push({ id: "missing_client_hints", severity: "low", message: "Chromium-like UA without sec-ch-ua client hint. Some real browsers omit this, so weak signal only." });
  }
  if (headers["content-length"] && Number(headers["content-length"]) > 0 && !headers["content-type"]) {
    reasons.push({ id: "body_without_content_type", severity: "low", message: "Request body exists without Content-Type." });
  }
  if (/curl|wget|python-requests|aiohttp|httpx|go-http-client|okhttp|java\//i.test(lowerUa)) {
    reasons.push({ id: "library_user_agent", severity: "medium", message: "User-Agent looks like HTTP client library." });
  }

  return { reasons };
}

function inferDatacenterFromOrg(org) {
  const matched = DATACENTER_ORG_PATTERNS.find((pattern) => pattern.test(org));
  return {
    isLikelyDatacenter: Boolean(matched),
    organization: org || null,
    matchedPattern: matched ? String(matched) : null
  };
}

function normalizeCloudflareBotManagement(botManagement) {
  if (!botManagement) {
    return { available: false };
  }
  return {
    available: true,
    score: botManagement.score ?? null,
    verifiedBot: botManagement.verifiedBot ?? null,
    signedAgent: botManagement.signedAgent ?? null,
    staticResource: botManagement.staticResource ?? null,
    ja3Hash: botManagement.ja3Hash ?? null,
    ja4: botManagement.ja4 ?? null,
    detectionIds: botManagement.detectionIds ?? null,
    jsDetection: botManagement.jsDetection ?? null
  };
}
