export function getClientIp(headers, options = {}) {
  const cloudflareIp = headers.get("cf-connecting-ip");
  if (cloudflareIp) return cloudflareIp;
  if (!options.trustForwardedHeaders) return "";

  return pickForwardedFor(headers.get("x-forwarded-for"), options.trustedProxyHops) ||
    headers.get("x-real-ip") ||
    headers.get("true-client-ip") ||
    "";
}

export function shouldTrustForwardedClientIp(env = {}) {
  return String(env.TRUST_FORWARDED_CLIENT_IP_HEADERS || "").toLowerCase() === "true";
}

export function trustedProxyHops(env = {}) {
  const hops = Number.parseInt(env.TRUSTED_PROXY_HOPS, 10);
  return Number.isInteger(hops) && hops > 0 ? hops : 1;
}

export function clientIpOptions(env = {}) {
  return {
    trustForwardedHeaders: shouldTrustForwardedClientIp(env),
    trustedProxyHops: trustedProxyHops(env)
  };
}

// The client writes the leftmost X-Forwarded-For entries; each trusted proxy appends one.
// Count trusted hops from the right so a client cannot pick its own address.
function pickForwardedFor(value, hops = 1) {
  if (!value) return "";
  const entries = value.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (!entries.length) return "";
  return entries[Math.max(0, entries.length - hops)];
}
