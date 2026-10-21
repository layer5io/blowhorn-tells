import { HttpError, json, JSON_HEADERS, readJsonBody, reportCorsHeaders } from "./http.js";
import { API_RATE_LIMIT_RETRY_AFTER_SECONDS, checkApiRateLimit } from "./rate-limit.js";
import { collectServer, collectServerBasics } from "./server-signals.js";
import { detectionMatrix, enrichClientConsistency, scoreReport } from "./report-verdict.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: url.pathname === "/api/report" ? reportCorsHeaders(request) : JSON_HEADERS
      });
    }

    try {
      if (url.pathname.startsWith("/api/")) {
        const rateLimit = await checkApiRateLimit(request, env);
        if (!rateLimit.allowed) {
          return json(rateLimit.responseBody, 429, {
            "Retry-After": String(API_RATE_LIMIT_RETRY_AFTER_SECONDS)
          });
        }
      }

      if (url.pathname === "/api/ping") {
        const server = collectServerBasics(request, env);
        return json({ ok: true, now: Date.now(), iso: new Date().toISOString(), server });
      }

      if (url.pathname === "/api/check") {
        const server = await collectServer(request, env);
        const verdict = scoreReport({ server, client: null });
        return json({ ok: true, receivedAt: new Date().toISOString(), verdict, server });
      }

      if (url.pathname === "/api/report" && request.method === "POST") {
        const rawClient = await readJsonBody(request, 192 * 1024);
        const server = await collectServer(request, env);
        const client = enrichClientConsistency(rawClient, server);
        const verdict = scoreReport({ server, client });
        const detections = detectionMatrix(server, client);
        return json({
          ok: true,
          receivedAt: new Date().toISOString(),
          verdict,
          server,
          client,
          detections
        }, 200, {}, reportCorsHeaders(request));
      }

      if (url.pathname.startsWith("/api/")) {
        return json({ ok: false, error: "Unknown API route" }, 404);
      }

      return env.ASSETS.fetch(request);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const headers = url.pathname === "/api/report" ? reportCorsHeaders(request) : JSON_HEADERS;
      return json({ ok: false, error: String(error?.message || error) }, status, {}, headers);
    }
  }
};
