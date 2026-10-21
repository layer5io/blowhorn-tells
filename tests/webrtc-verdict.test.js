import { describe, expect, it } from "vitest";
import worker from "../src/worker.js";
import { createWorkerEnv } from "./worker-env.js";

const browserHeaders = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-GB,en;q=0.9",
  "sec-ch-ua": '"Chromium";v="126"',
  "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "cf-connecting-ip": "2a02:6b6f:eaf2:2500:d00b:9088:ad14:281a"
};

function reportRequest(webrtc) {
  return new Request("https://amiabot.example/api/report", {
    method: "POST",
    headers: { ...browserHeaders, "content-type": "application/json" },
    body: JSON.stringify({
      browser: { userAgent: browserHeaders["user-agent"], webdriver: false, plugins: [{ name: "PDF Viewer" }] },
      automation: {},
      workers: {},
      fingerprints: {},
      consistency: {},
      behavior: { score: 1 },
      network: { webrtc },
      surfaces: {}
    })
  });
}

describe("Worker WebRTC verdicts", () => {
  it("does not penalise dual-stack candidates when the HTTP request IP is present", async () => {
    const response = await worker.fetch(reportRequest({
      supported: true,
      publicIps: ["45.159.90.144", "2a02:6b6f:eaf2:2500:d00b:9088:ad14:281a"],
      candidates: []
    }), createWorkerEnv(), {});
    const data = await response.json();

    expect(data.client.network.webrtc).toMatchObject({
      publicIpMatchedServer: true,
      additionalPublicIps: ["45.159.90.144"],
      differentPublicIps: [],
      publicIpLeakDifferentFromServer: false
    });
    expect(data.verdict.reasons.map((reason) => reason.id)).not.toContain("webrtc_public_ip_mismatch");
  });

  it("keeps penalising WebRTC candidates that do not include the HTTP request IP", async () => {
    const response = await worker.fetch(reportRequest({
      supported: true,
      publicIps: ["45.159.90.144"],
      candidates: []
    }), createWorkerEnv(), {});
    const data = await response.json();

    expect(data.client.network.webrtc).toMatchObject({
      publicIpMatchedServer: false,
      differentPublicIps: ["45.159.90.144"],
      publicIpLeakDifferentFromServer: true
    });
    expect(data.verdict.reasons.map((reason) => reason.id)).toContain("webrtc_public_ip_mismatch");
  });
});
