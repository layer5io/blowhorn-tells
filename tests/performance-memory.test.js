import { describe, expect, it } from "vitest";
import { buildPerformanceMemorySurface, collectPerformanceMemorySnapshot } from "../public/performance-memory.js";
import worker from "../src/worker.js";
import { createWorkerEnv } from "./worker-env.js";

const browserHeaders = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-GB,en;q=0.9",
  "sec-ch-ua": '"Chromium";v="126"',
  "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
};

describe("performance memory sampling", () => {
  it("reports unsupported memory cleanly when performance.memory is unavailable", () => {
    expect(collectPerformanceMemorySnapshot(123)).toEqual({ supported: false, t: 123 });
  });

  it("builds a surface from stored samples", () => {
    const surface = buildPerformanceMemorySurface({
      performanceSamples: [
        { supported: true, t: 10, usedJSHeapSize: 10, totalJSHeapSize: 20, jsHeapSizeLimit: 100, usedRatio: 0.5 }
      ],
      rafSamples: [16, 16, 17]
    });

    expect(surface.memory).toMatchObject({
      supported: true,
      usedJSHeapSize: 10,
      totalJSHeapSize: 20,
      jsHeapSizeLimit: 100,
      usedRatio: 0.5
    });
    expect(surface.fps.approximateFps).toBeGreaterThan(0);
  });
});

describe("Worker performance memory verdicts", () => {
  it("echoes memory values sent with ping requests", async () => {
    const request = new Request("https://amiabot.example/api/ping?heapUsed=10&heapTotal=20&heapLimit=100&heapRatio=0.5", {
      headers: browserHeaders
    });

    const response = await worker.fetch(request, createWorkerEnv(), {});
    const data = await response.json();

    expect(data.server.performanceMemory).toEqual({
      usedJSHeapSize: 10,
      totalJSHeapSize: 20,
      jsHeapSizeLimit: 100,
      usedRatio: 0.5
    });
  });

  it("penalises impossible performance.memory samples from browser reports", async () => {
    const request = new Request("https://amiabot.example/api/report", {
      method: "POST",
      headers: { ...browserHeaders, "content-type": "application/json" },
      body: JSON.stringify({
        browser: { userAgent: browserHeaders["user-agent"], webdriver: false, plugins: [{ name: "PDF Viewer" }] },
        automation: {},
        workers: {},
        fingerprints: {},
        consistency: {},
        behavior: { score: 1 },
        network: {
          ping: {
            memorySamples: [
              { supported: true, t: 100, usedJSHeapSize: 30, totalJSHeapSize: 20, jsHeapSizeLimit: 100, usedRatio: 1.5 }
            ]
          }
        },
        surfaces: {}
      })
    });

    const response = await worker.fetch(request, createWorkerEnv(), {});
    const data = await response.json();
    const memoryReason = data.verdict.reasons.find((reason) => reason.id === "performance_memory_anomaly");

    expect(memoryReason).toMatchObject({
      severity: "medium",
      points: 12
    });
    expect(memoryReason.data.map((item) => item.id)).toContain("heap_used_exceeds_total");
  });
});
