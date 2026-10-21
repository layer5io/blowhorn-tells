import { fetchWithTimeout } from "./fetch-with-timeout.js";

export async function lookupIpIntel(ip, userAgent, env, provider) {
  if (!ip || provider === "none") {
    return { provider: "none", enabled: false, reason: "No reputation data returned." };
  }

  try {
    if (provider === "ipinfo") return await lookupIpinfo(ip, env.IPINFO_TOKEN);
    if (provider === "ipqs" || provider === "ipqualityscore") return await lookupIpqs(ip, userAgent, env.IPQUALITYSCORE_KEY);
    return await lookupIpapiIs(ip, env.IPAPI_IS_KEY);
  } catch (error) {
    return {
      provider,
      enabled: true,
      error: String(error?.message || error),
      normalized: null
    };
  }
}

async function lookupIpapiIs(ip, key) {
  const url = new URL("https://api.ipapi.is/");
  url.searchParams.set("q", ip);
  if (key) url.searchParams.set("key", key);

  const started = Date.now();
  const res = await fetchWithTimeout(url.toString(), {}, 2500);
  const data = await res.json();
  const elapsedMs = Date.now() - started;

  if (data?.error) throw new Error(`ipapi.is error: ${data.error}`);

  return {
    provider: "ipapi.is",
    enabled: true,
    status: res.status,
    elapsedMs,
    raw: data,
    normalized: {
      isDatacenter: Boolean(data.is_datacenter),
      isProxy: Boolean(data.is_proxy),
      isVpn: Boolean(data.is_vpn),
      isTor: Boolean(data.is_tor),
      isCrawler: Boolean(data.is_crawler),
      isAbuser: Boolean(data.is_abuser),
      isMobile: Boolean(data.is_mobile),
      providerName: data.datacenter?.datacenter || data.company?.name || data.asn?.name || null,
      companyType: data.company?.type || null,
      asnType: data.asn?.type || null,
      asn: data.asn?.asn || null,
      country: data.location?.country_code || data.datacenter?.country || null,
      timezone: data.location?.timezone || null
    }
  };
}

async function lookupIpinfo(ip, token) {
  if (!token) throw new Error("IPINFO_TOKEN is required for provider=ipinfo.");
  const url = new URL(`https://ipinfo.io/${encodeURIComponent(ip)}/privacy`);
  url.searchParams.set("token", token);

  const started = Date.now();
  const res = await fetchWithTimeout(url.toString(), {}, 2500);
  const data = await res.json();
  const elapsedMs = Date.now() - started;

  return {
    provider: "ipinfo",
    enabled: true,
    status: res.status,
    elapsedMs,
    raw: data,
    normalized: {
      isDatacenter: Boolean(data.hosting),
      isProxy: Boolean(data.proxy),
      isVpn: Boolean(data.vpn),
      isTor: Boolean(data.tor),
      isRelay: Boolean(data.relay),
      providerName: data.service || null,
      confidence: data.confidence ?? null,
      firstSeen: data.first_seen || null,
      lastSeen: data.last_seen || null
    }
  };
}

async function lookupIpqs(ip, userAgent, key) {
  if (!key) throw new Error("IPQUALITYSCORE_KEY is required for provider=ipqs.");
  const url = new URL(`https://www.ipqualityscore.com/api/json/ip/${encodeURIComponent(key)}/${encodeURIComponent(ip)}`);
  url.searchParams.set("strictness", "1");
  url.searchParams.set("allow_public_access_points", "true");
  if (userAgent) url.searchParams.set("user_agent", userAgent);

  const started = Date.now();
  const res = await fetchWithTimeout(url.toString(), {}, 3000);
  const data = await res.json();
  const elapsedMs = Date.now() - started;

  return {
    provider: "ipqualityscore",
    enabled: true,
    status: res.status,
    elapsedMs,
    raw: data,
    normalized: {
      isDatacenter: Boolean(data.hosting),
      isProxy: Boolean(data.proxy),
      isVpn: Boolean(data.vpn || data.active_vpn),
      isTor: Boolean(data.tor || data.active_tor),
      isCrawler: Boolean(data.crawler),
      isAbuser: Boolean(data.recent_abuse),
      fraudScore: data.fraud_score ?? null,
      providerName: data.ISP || data.organization || null,
      connectionType: data.connection_type || null,
      country: data.country_code || null
    }
  };
}
