import { getClientIp, shouldTrustForwardedClientIp } from "./client-ip.js";

const API_RATE_LIMITER_BINDING = "API_RATE_LIMITER";
const UNKNOWN_API_ROUTE = "/api/*";
const API_RATE_LIMITED_MESSAGE = "Rate limit exceeded. Please retry shortly.";
const API_ROUTES = new Set([
  "/api/check",
  "/api/ping",
  "/api/report"
]);

export const API_RATE_LIMIT_RETRY_AFTER_SECONDS = 60;

export async function checkApiRateLimit(request, env) {
  const limiter = env[API_RATE_LIMITER_BINDING];
  if (!limiter || typeof limiter.limit !== "function") {
    throw new Error(`${API_RATE_LIMITER_BINDING} binding is not configured.`);
  }

  const result = await limiter.limit({ key: buildApiRateLimitKey(request, env) });
  if (result.success) {
    return { allowed: true };
  }

  return {
    allowed: false,
    responseBody: {
      ok: false,
      error: API_RATE_LIMITED_MESSAGE,
      retryAfterSeconds: API_RATE_LIMIT_RETRY_AFTER_SECONDS
    }
  };
}

export function buildApiRateLimitKey(request, env = {}) {
  const url = new URL(request.url);
  const route = API_ROUTES.has(url.pathname) ? url.pathname : UNKNOWN_API_ROUTE;
  const client = getClientIp(request.headers, {
    trustForwardedHeaders: shouldTrustForwardedClientIp(env)
  }) || "unknown-client";
  return `${request.method}:${route}:${client}`;
}
