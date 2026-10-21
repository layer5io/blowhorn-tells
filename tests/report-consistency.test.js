import { describe, expect, it } from "vitest";
import { scoreReport } from "../src/report-verdict.js";
import worker from "../src/worker.js";
import { createWorkerEnv } from "./worker-env.js";

const requestHeaders = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-GB,en;q=0.9",
  "cf-connecting-ip": "203.0.113.44",
  "sec-ch-ua": '"Chromium";v="126"',
  "sec-ch-ua-platform": '"macOS"',
  "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
};

describe("server-side report consistency", () => {
  it("scores request and browser identity drift on the Worker", async () => {
    const response = await worker.fetch(new Request("https://amiabot.example/api/report", {
      method: "POST",
      headers: { ...requestHeaders, "content-type": "application/json" },
      body: JSON.stringify({
        browser: {
          userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
          userAgentData: { platform: "Windows" },
          languages: ["fr-FR", "fr"],
          webdriver: false,
          plugins: [{ name: "PDF Viewer" }]
        },
        automation: { present: [], cdpSerializationSignal: false },
        workers: {},
        fingerprints: { webgl: { supported: true } },
        consistency: {},
        behavior: { score: 1 },
        network: {},
        surfaces: {}
      })
    }), createWorkerEnv(), {});
    const body = await response.json();
    const reasonIds = body.verdict.reasons.map((reason) => reason.id);

    expect(response.status).toBe(200);
    expect(body.client.consistency).toMatchObject({
      acceptLanguageMismatch: {
        requestLanguages: ["en-gb", "en"],
        browserLanguages: ["fr-fr", "fr"]
      },
      clientHintPlatformMismatch: {
        requestPlatform: "macOS",
        browserPlatform: "Windows"
      }
    });
    expect(body.client.consistency.userAgentMismatch).toMatchObject({
      requestUserAgent: requestHeaders["user-agent"]
    });
    expect(reasonIds).toEqual(expect.arrayContaining([
      "request_client_ua_mismatch",
      "accept_language_mismatch",
      "client_hint_platform_mismatch"
    ]));
  });

  it("scores verified crawler signals as bot evidence", () => {
    const verdict = scoreReport({
      server: {
        userAgent: "Googlebot/2.1",
        proxyHeaders: {},
        datacenterHeuristic: { isLikelyDatacenter: false },
        headerSignals: { reasons: [] },
        ipIntel: {
          normalized: {
            isCrawler: true
          }
        },
        cloudflareBotManagement: {
          available: true,
          verifiedBot: true,
          score: 99
        }
      },
      client: {
        browser: {
          userAgent: "Googlebot/2.1",
          webdriver: false,
          plugins: []
        },
        automation: { present: [], cdpSerializationSignal: false },
        fingerprints: { webgl: { supported: true } },
        network: {},
        surfaces: {},
        consistency: {},
        behavior: { score: 1 }
      }
    });
    const reasonIds = verdict.reasons.map((reason) => reason.id);

    expect(verdict.classification).toBe("likely_bot");
    expect(reasonIds).toEqual(expect.arrayContaining([
      "ip_crawler",
      "cloudflare_verified_bot"
    ]));
  });

  it("scores blocked canvas fingerprint collection", () => {
    const verdict = scoreReport({
      server: {
        userAgent: requestHeaders["user-agent"],
        proxyHeaders: {},
        datacenterHeuristic: { isLikelyDatacenter: false },
        headerSignals: { reasons: [] },
        cloudflareBotManagement: { available: false }
      },
      client: {
        browser: {
          userAgent: requestHeaders["user-agent"],
          webdriver: false,
          plugins: [{ name: "PDF Viewer" }]
        },
        automation: { present: [], cdpSerializationSignal: false },
        fingerprints: {
          canvas: { supported: false, hashError: "Canvas readback blocked" },
          webgl: { supported: true }
        },
        network: {},
        surfaces: {},
        consistency: {},
        behavior: { score: 1 }
      }
    });

    expect(verdict.reasons).toContainEqual(expect.objectContaining({
      id: "canvas_error",
      data: "Canvas readback blocked"
    }));
  });

  it("scores mobile client hint drift and impossible touch surface", async () => {
    const response = await worker.fetch(new Request("https://amiabot.example/api/report", {
      method: "POST",
      headers: { ...requestHeaders, "sec-ch-ua-mobile": "?0", "content-type": "application/json" },
      body: JSON.stringify({
        browser: {
          userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
          userAgentData: { platform: "Android", mobile: true },
          languages: ["en-GB", "en"],
          maxTouchPoints: 0,
          features: { touchEvent: false },
          webdriver: false,
          plugins: []
        },
        automation: { present: [], cdpSerializationSignal: false },
        workers: {},
        fingerprints: { webgl: { supported: true } },
        consistency: {},
        behavior: { score: 1 },
        network: {},
        surfaces: {}
      })
    }), createWorkerEnv(), {});
    const body = await response.json();
    const reasonIds = body.verdict.reasons.map((reason) => reason.id);

    expect(body.client.consistency).toMatchObject({
      clientHintMobileMismatch: {
        requestMobile: false,
        browserMobile: true
      },
      mobileTouchMismatch: {
        maxTouchPoints: 0,
        touchEvent: false
      }
    });
    expect(reasonIds).toEqual(expect.arrayContaining([
      "client_hint_mobile_mismatch",
      "mobile_touch_mismatch"
    ]));
  });

  it("scores high-entropy UA-CH drift across request and worker contexts", async () => {
    const response = await worker.fetch(new Request("https://amiabot.example/api/report", {
      method: "POST",
      headers: {
        ...requestHeaders,
        "content-type": "application/json",
        "sec-ch-ua-arch": '"arm"',
        "sec-ch-ua-bitness": '"64"',
        "sec-ch-ua-platform-version": '"14.0.0"',
        "sec-ch-ua-wow64": "?0"
      },
      body: JSON.stringify({
        browser: {
          userAgent: requestHeaders["user-agent"],
          userAgentData: {
            platform: "macOS",
            mobile: false,
            highEntropy: {
              architecture: "x86",
              bitness: "64",
              platformVersion: "14.0.0",
              wow64: false
            }
          },
          languages: ["en-GB", "en"],
          webdriver: false,
          plugins: [{ name: "PDF Viewer" }]
        },
        automation: { present: [], cdpSerializationSignal: false },
        workers: {
          webWorker: {
            userAgentData: {
              highEntropy: {
                architecture: "x86",
                bitness: "64",
                platformVersion: "14.0.0",
                wow64: false
              }
            }
          },
          serviceWorker: {
            userAgentData: {
              highEntropy: {
                architecture: "arm",
                bitness: "64",
                platformVersion: "14.0.0",
                wow64: false
              }
            }
          }
        },
        fingerprints: { webgl: { supported: true } },
        consistency: {},
        behavior: { score: 1 },
        network: {},
        surfaces: {}
      })
    }), createWorkerEnv(), {});
    const body = await response.json();
    const reasonIds = body.verdict.reasons.map((reason) => reason.id);

    expect(body.client.consistency.clientHintHighEntropyMismatch).toMatchObject({
      mismatches: [
        {
          field: "architecture",
          requestValue: "arm",
          browserValue: "x86"
        }
      ]
    });
    expect(body.client.consistency.userAgentDataHighEntropyMismatch).toMatchObject({
      reference: "Window",
      mismatches: [
        {
          field: "architecture",
          context: "Service Worker",
          referenceValue: "x86",
          contextValue: "arm"
        }
      ]
    });
    expect(reasonIds).toEqual(expect.arrayContaining([
      "client_hint_high_entropy_mismatch",
      "ua_data_high_entropy_mismatch"
    ]));
  });
});
