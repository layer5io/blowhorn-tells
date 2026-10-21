export function getClientIp(headers, options = {}) {
  const cloudflareIp = headers.get("cf-connecting-ip");
  if (cloudflareIp) return cloudflareIp;
  if (!options.trustForwardedHeaders) return "";

  return headers.get("true-client-ip") ||
    splitFirst(headers.get("x-forwarded-for")) ||
    headers.get("x-real-ip") ||
    "";
}

export function shouldTrustForwardedClientIp(env = {}) {
  return String(env.TRUST_FORWARDED_CLIENT_IP_HEADERS || "").toLowerCase() === "true";
}

function splitFirst(value) {
  if (!value) return "";
  return value.split(",")[0].trim();
}
