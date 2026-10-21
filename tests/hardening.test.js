import { createServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { extensionDotTone } from "../public/ui.js";
import { copyWebIdl } from "../public/utils.js";
import { fetchWithTimeout } from "../src/fetch-with-timeout.js";
import { readJsonBody } from "../src/http.js";
import { buildApiRateLimitKey } from "../src/rate-limit.js";
import { inferDatacenterFromOrg } from "../src/server-signals.js";

function forwardedRequest(xff) {
  return new Request("https://tells.example/api/check", { headers: { "x-forwarded-for": xff } });
}

describe("forwarded client IP", () => {
  const trusted = { TRUST_FORWARDED_CLIENT_IP_HEADERS: "true" };

  it("keys on the address the trusted proxy appended, not the client's own entries", () => {
    expect(buildApiRateLimitKey(forwardedRequest("1.1.1.1, 203.0.113.9"), trusted)).toBe("GET:/api/check:203.0.113.9");
    expect(buildApiRateLimitKey(forwardedRequest("8.8.8.8, 203.0.113.9"), trusted)).toBe("GET:/api/check:203.0.113.9");
  });

  it("counts the configured number of proxy hops from the right", () => {
    const env = { ...trusted, TRUSTED_PROXY_HOPS: "2" };
    expect(buildApiRateLimitKey(forwardedRequest("1.1.1.1, 203.0.113.9, 10.0.0.2"), env)).toBe("GET:/api/check:203.0.113.9");
    expect(buildApiRateLimitKey(forwardedRequest("203.0.113.9"), env)).toBe("GET:/api/check:203.0.113.9");
  });
});

describe("request body limit", () => {
  it("refuses a declared oversized body before reading it", async () => {
    const body = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(10)); } });
    const request = new Request("https://tells.example/api/report", {
      method: "POST", body, duplex: "half", headers: { "content-length": "999999" }
    });
    await expect(readJsonBody(request, 1024)).rejects.toMatchObject({ status: 413 });
    expect(request.bodyUsed).toBe(false);
  });

  it("stops reading an undeclared stream once it passes the limit", async () => {
    let chunks = 0;
    const body = new ReadableStream({
      pull(controller) {
        chunks += 1;
        controller.enqueue(new Uint8Array(600));
      }
    });
    const request = new Request("https://tells.example/api/report", { method: "POST", body, duplex: "half" });
    await expect(readJsonBody(request, 1024)).rejects.toMatchObject({ status: 413 });
    expect(chunks).toBeLessThan(5);
  });

  it("still parses a body under the limit", async () => {
    const request = new Request("https://tells.example/api/report", { method: "POST", body: JSON.stringify({ ok: "ü" }) });
    await expect(readJsonBody(request, 1024)).resolves.toEqual({ ok: "ü" });
  });
});

describe("datacenter organisation patterns", () => {
  it("does not flag residential ISPs whose names contain a pattern as a substring", () => {
    for (const org of ["Telmex Colombia S.A.", "Colombia Movil", "Associated Telecom", "Sociedad Telefonica", "Colorado Broadband", "Laws Networks"]) {
      expect(inferDatacenterFromOrg(org).isLikelyDatacenter, org).toBe(false);
    }
  });

  it("still flags hosting providers", () => {
    for (const org of ["Oracle Corporation", "OCI", "Hetzner Online GmbH", "Example Colo Ltd", "AWS EC2", "OVH SAS"]) {
      expect(inferDatacenterFromOrg(org).isLikelyDatacenter, org).toBe(true);
    }
  });
});

describe("fetch timeout", () => {
  let server;
  let url;

  beforeAll(async () => {
    server = createServer((request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.write("{");
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${server.address().port}/`;
  });

  afterAll(() => {
    server.closeAllConnections();
    server.close();
  });

  it("covers a response body that stalls after the headers", async () => {
    const started = Date.now();
    const response = await fetchWithTimeout(url, {}, 300);
    await expect(response.json()).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe("WebIDL copy", () => {
  class AdapterInfo {
    get vendor() { return "apple"; }
    get architecture() { return "metal-3"; }
    get maxBufferSize() { return 2n ** 32n; }
  }
  for (const key of ["vendor", "architecture", "maxBufferSize"]) {
    Object.defineProperty(AdapterInfo.prototype, key, { ...Object.getOwnPropertyDescriptor(AdapterInfo.prototype, key), enumerable: true });
  }

  it("keeps values held in prototype getters", () => {
    expect(JSON.stringify(new AdapterInfo())).toBe("{}");
    expect(copyWebIdl(new AdapterInfo())).toEqual({ vendor: "apple", architecture: "metal-3", maxBufferSize: "4294967296" });
    expect(copyWebIdl(null)).toBeNull();
  });
});

describe("extension scanner dot", () => {
  it("stays muted until probes report", () => {
    expect(extensionDotTone(undefined)).toBe("muted");
    expect(extensionDotTone("n/a")).toBe("muted");
    expect(extensionDotTone("pending")).toBe("muted");
  });

  it("is good with no hits and a warning with any", () => {
    expect(extensionDotTone("0/12")).toBe("good");
    expect(extensionDotTone("2/12")).toBe("warn");
  });
});
