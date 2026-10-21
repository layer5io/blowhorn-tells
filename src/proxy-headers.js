const PROXY_HEADER_NAMES = [
  "forwarded",
  "forwarded-for",
  "via",
  "proxy-connection",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-real-ip",
  "x-client-ip",
  "true-client-ip",
  "client-ip",
  "proxy-authenticate",
  "proxy-authorization"
];

const CLOUDFLARE_PLATFORM_FORWARDING_HEADERS = new Set([
  "true-client-ip",
  "x-forwarded-for",
  "x-forwarded-proto",
  "x-real-ip"
]);

export function collectProxyHeaders(headers, sensitiveHeaderNames = new Set()) {
  const found = {};
  for (const name of PROXY_HEADER_NAMES) {
    const value = headers.get(name);
    if (value) found[name] = sensitiveHeaderNames.has(name) ? "[redacted]" : value;
  }
  return found;
}

export function getSuspiciousProxyHeaders(proxyHeaders = {}) {
  return Object.fromEntries(
    Object.entries(proxyHeaders).filter(([name]) => !CLOUDFLARE_PLATFORM_FORWARDING_HEADERS.has(name))
  );
}
