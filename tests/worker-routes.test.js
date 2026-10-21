import { describe, expect, it } from "vitest";
import worker from "../src/worker.js";
import { createWorkerEnv } from "./worker-env.js";

const browserHeaders = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-GB,en;q=0.9",
  "cf-connecting-ip": "203.0.113.44",
  "sec-ch-ua": '"Chromium";v="126"',
  "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
};

describe("Worker API routes", () => {
  it("responds to CORS preflight without touching route handlers", async () => {
    const response = await worker.fetch(new Request("https://amiabot.example/api/report", {
      method: "OPTIONS"
    }), createWorkerEnv(), {});

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe("POST,OPTIONS");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("allows report CORS only for the same origin", async () => {
    const sameOrigin = await worker.fetch(new Request("https://amiabot.example/api/report", {
      method: "OPTIONS",
      headers: { origin: "https://amiabot.example" }
    }), createWorkerEnv(), {});
    const foreignOrigin = await worker.fetch(new Request("https://amiabot.example/api/report", {
      method: "OPTIONS",
      headers: { origin: "https://collector.example" }
    }), createWorkerEnv(), {});

    expect(sameOrigin.headers.get("Access-Control-Allow-Origin")).toBe("https://amiabot.example");
    expect(sameOrigin.headers.get("Vary")).toBe("Origin");
    expect(foreignOrigin.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("serves ping diagnostics from collected request basics", async () => {
    const response = await worker.fetch(new Request("https://amiabot.example/api/ping?token=secret", {
      headers: browserHeaders
    }), createWorkerEnv(), {});
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.server).toMatchObject({
      ip: "203.0.113.44",
      method: "GET",
      userAgent: browserHeaders["user-agent"]
    });
    expect(body.server.url).toContain("token=%5Bredacted%5D");
  });

  it("returns a check verdict without client data", async () => {
    const response = await worker.fetch(new Request("https://amiabot.example/api/check", {
      headers: browserHeaders
    }), createWorkerEnv(), {});
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.verdict).toMatchObject({
      classification: "likely_human",
      risk: "low"
    });
    expect(body.server.ipIntel).toMatchObject({ provider: "none", enabled: false });
  });

  it("rejects malformed report JSON as bad input", async () => {
    const response = await worker.fetch(new Request("https://amiabot.example/api/report", {
      method: "POST",
      headers: { ...browserHeaders, "content-type": "application/json" },
      body: "{"
    }), createWorkerEnv(), {});
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ ok: false, error: "Invalid JSON body" });
  });

  it("rejects oversized reports before scoring", async () => {
    const response = await worker.fetch(new Request("https://amiabot.example/api/report", {
      method: "POST",
      headers: { ...browserHeaders, "content-type": "application/json" },
      body: JSON.stringify({ padding: "x".repeat(192 * 1024) })
    }), createWorkerEnv(), {});
    const body = await response.json();

    expect(response.status).toBe(413);
    expect(body).toEqual({ ok: false, error: "Request body too large. Max 196608 bytes." });
  });

  it("adds same-origin CORS headers to report responses", async () => {
    const response = await worker.fetch(new Request("https://amiabot.example/api/report", {
      method: "POST",
      headers: { ...browserHeaders, "content-type": "application/json", origin: "https://amiabot.example" },
      body: "{}"
    }), createWorkerEnv(), {});

    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://amiabot.example");
  });

  it("returns a JSON 404 for unknown API routes", async () => {
    const response = await worker.fetch(new Request("https://amiabot.example/api/missing", {
      headers: browserHeaders
    }), createWorkerEnv(), {});
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ ok: false, error: "Unknown API route" });
  });
});
