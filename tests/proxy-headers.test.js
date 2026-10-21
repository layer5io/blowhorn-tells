import { describe, expect, it } from "vitest";
import { collectProxyHeaders, getSuspiciousProxyHeaders } from "../src/proxy-headers.js";
import worker from "../src/worker.js";
import { createWorkerEnv } from "./worker-env.js";

const browserHeaders = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-GB,en;q=0.9",
  "sec-ch-ua": '"Chromium";v="126"',
  "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
};

describe("proxy header filtering", () => {
  it("keeps Cloudflare forwarding headers visible without marking them suspicious", () => {
    const proxyHeaders = {
      "x-forwarded-for": "203.0.113.10",
      "x-forwarded-proto": "https",
      "x-real-ip": "203.0.113.10",
      "true-client-ip": "203.0.113.10"
    };

    expect(getSuspiciousProxyHeaders(proxyHeaders)).toEqual({});
  });

  it("keeps explicit proxy headers scoreable", () => {
    expect(getSuspiciousProxyHeaders({
      "x-forwarded-proto": "https",
      via: "1.1 proxy.example",
      "proxy-authorization": "[redacted]"
    })).toEqual({
      via: "1.1 proxy.example",
      "proxy-authorization": "[redacted]"
    });
  });

  it("redacts sensitive proxy header values", () => {
    const headers = new Headers({
      "proxy-authorization": "Basic secret",
      "x-forwarded-proto": "https"
    });

    expect(collectProxyHeaders(headers, new Set(["proxy-authorization"]))).toEqual({
      "x-forwarded-proto": "https",
      "proxy-authorization": "[redacted]"
    });
  });
});

describe("Worker proxy header verdicts", () => {
  it("does not penalise normal Cloudflare Worker forwarding headers", async () => {
    const request = new Request("https://amiabot.example/api/check", {
      headers: {
        ...browserHeaders,
        "x-forwarded-for": "203.0.113.10",
        "x-forwarded-proto": "https",
        "x-real-ip": "203.0.113.10"
      }
    });

    const response = await worker.fetch(request, createWorkerEnv(), {});
    const data = await response.json();

    expect(data.server.proxyHeaders).toMatchObject({
      "x-forwarded-for": "203.0.113.10",
      "x-forwarded-proto": "https",
      "x-real-ip": "203.0.113.10"
    });
    expect(data.verdict.reasons.map((reason) => reason.id)).not.toContain("proxy_headers");
  });

  it("penalises explicit proxy headers beyond Cloudflare forwarding context", async () => {
    const request = new Request("https://amiabot.example/api/check", {
      headers: {
        ...browserHeaders,
        "x-forwarded-proto": "https",
        via: "1.1 proxy.example"
      }
    });

    const response = await worker.fetch(request, createWorkerEnv(), {});
    const data = await response.json();
    const proxyReason = data.verdict.reasons.find((reason) => reason.id === "proxy_headers");

    expect(proxyReason).toMatchObject({
      severity: "medium",
      points: 20,
      data: { via: "1.1 proxy.example" }
    });
  });

  it("redacts proxy authorization values in reports and verdict evidence", async () => {
    const request = new Request("https://amiabot.example/api/check", {
      headers: {
        ...browserHeaders,
        "proxy-authorization": "Basic secret"
      }
    });

    const response = await worker.fetch(request, createWorkerEnv(), {});
    const data = await response.json();
    const proxyReason = data.verdict.reasons.find((reason) => reason.id === "proxy_headers");

    expect(data.server.proxyHeaders).toMatchObject({
      "proxy-authorization": "[redacted]"
    });
    expect(proxyReason).toMatchObject({
      data: { "proxy-authorization": "[redacted]" }
    });
    expect(JSON.stringify(data)).not.toContain("Basic secret");
  });
});
