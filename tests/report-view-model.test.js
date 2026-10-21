import { describe, expect, it } from "vitest";
import {
  buildBehaviorSummary,
  buildNetworkIdentitySummary,
  buildReasonEvidence,
  buildRequestConsistencyRows,
  buildWebRtcComparison,
  buildWorkerConsistencyRows,
  getBehaviorFreshness
} from "../public/report-view-model.js";

const sampleReport = {
  verdict: {
    reasons: [
      {
        id: "webrtc_public_ip_mismatch",
        data: {
          serverIp: "2001:db8::1",
          publicIps: ["203.0.113.7", "2001:db8::1"],
          differentPublicIps: ["203.0.113.7"],
          privateIps: [],
          mdnsHosts: [],
          candidates: [
            { address: "203.0.113.7", port: "54323", type: "srflx", isPublic: true },
            { address: "2001:db8::1", port: "56243", type: "srflx", isPublic: true }
          ]
        }
      },
      {
        id: "behavior_score_borderline",
        data: {
          elapsedMs: 2500,
          eventCounts: { keydown: 2 },
          pointerMoveSamples: 0,
          pointerDistance: 0,
          pointerSpeedStdDev: 0,
          rafStdDev: 0.321,
          challengeCompleted: false
        }
      }
    ]
  },
  server: {
    ip: "2001:db8::1",
    userAgent: "Mozilla/5.0",
    headers: {
      "accept-language": "en-GB,en;q=0.9",
      "sec-ch-ua-platform": "\"macOS\"",
      "sec-ch-ua-mobile": "?0"
    },
    cf: {
      asn: 64500,
      asOrganization: "Example ISP",
      colo: "LHR",
      country: "GB",
      city: "London",
      region: "England",
      timezone: "Europe/London",
      httpProtocol: "HTTP/3",
      tlsVersion: "TLSv1.3",
      clientTcpRtt: 0,
      clientQuicRtt: 11
    },
    ipIntel: {
      provider: "ipapi.is",
      enabled: true,
      status: 200,
      elapsedMs: 26,
      normalized: {
        isProxy: false,
        isVpn: false,
        isTor: false,
        isDatacenter: false,
        isCrawler: false,
        providerName: "Example ISP",
        companyType: "isp",
        asnType: "isp",
        asn: 64500,
        country: "GB",
        timezone: "Europe/London"
      },
      raw: {
        company: { network: "2001:db8::/32" },
        asn: { route: "2001:db8::/32" }
      }
    },
    datacenterHeuristic: { isLikelyDatacenter: false },
    cloudflareBotManagement: {
      available: true,
      score: 99,
      verifiedBot: false,
      jsDetection: { passed: false }
    }
  },
  client: {
    browser: {
      platform: "MacIntel",
      language: "en-GB",
      languages: ["en-GB", "en"],
      userAgentData: { platform: "macOS", mobile: false },
      hardwareConcurrency: 2,
      deviceMemory: 8,
      webdriver: false,
      userAgent: "Mozilla/5.0"
    },
    workers: {
      webWorker: { platform: "MacIntel", language: "en-GB", hardwareConcurrency: 14, deviceMemory: 16, userAgent: "Mozilla/5.0" },
      iframe: { platform: "MacIntel", language: "en-GB", hardwareConcurrency: 12, deviceMemory: 16, webdriver: false, userAgent: "Mozilla/5.0" },
      serviceWorker: { platform: "MacIntel", language: "en-GB", hardwareConcurrency: 14, deviceMemory: 16, webdriver: null, userAgent: "Mozilla/5.0" }
    },
    network: {
      ping: { medianMs: 22 },
      webrtc: {
        supported: true,
        publicIps: ["203.0.113.7", "2001:db8::1"],
        differentPublicIps: ["203.0.113.7"],
        privateIps: [],
        mdnsHosts: [],
        serverIp: "2001:db8::1",
        candidates: [
          { address: "203.0.113.7", port: "54323", type: "srflx", isPublic: true },
          { address: "2001:db8::1", port: "56243", type: "srflx", isPublic: true }
        ]
      }
    },
    behavior: {
      score: 1,
      summary: {
        elapsedMs: 15000,
        eventCounts: { scroll: 353, pointermove: 8 },
        pointerMoveSamples: 8,
        pointerDistance: 353,
        pointerSpeedStdDev: 0.65,
        rafStdDev: 0.306,
        challengeCompleted: false
      }
    }
  }
};

describe("report view model", () => {
  it("expands WebRTC reason evidence into readable facts", () => {
    const evidence = buildReasonEvidence(sampleReport.verdict.reasons[0]);

    expect(evidence).toContainEqual({ label: "HTTP request IP", value: "2001:db8::1", tone: "neutral" });
    expect(evidence).toContainEqual({ label: "Different public IPs", value: "203.0.113.7", tone: "alert" });
  });

  it("builds network and WebRTC summaries from collected report data", () => {
    expect(buildNetworkIdentitySummary(sampleReport)).toMatchObject({
      "Request IP": "2001:db8::1",
      "Provider / ASN": "AS64500, Example ISP, 2001:db8::/32",
      "Managed bot": "score=99 verified=false js=not passed"
    });
    expect(buildWebRtcComparison(sampleReport)).toMatchObject({
      Status: "mismatch detected",
      "HTTP request IP": "2001:db8::1",
      "Different public IPs": "203.0.113.7",
      "Candidate types": "srflx:2"
    });
  });

  it("treats dual-stack WebRTC candidates as matched when the request IP is present", () => {
    const comparison = buildWebRtcComparison({
      server: { ip: "2a02:6b6f:eaf2:2500:d00b:9088:ad14:281a" },
      client: {
        network: {
          webrtc: {
            supported: true,
            serverIp: "2a02:6b6f:eaf2:2500:d00b:9088:ad14:281a",
            publicIpMatchedServer: true,
            publicIps: ["45.159.90.144", "2a02:6b6f:eaf2:2500:d00b:9088:ad14:281a"],
            additionalPublicIps: ["45.159.90.144"],
            differentPublicIps: [],
            candidates: [
              { address: "45.159.90.144", port: "54455", type: "srflx", isPublic: true },
              { address: "2a02:6b6f:eaf2:2500:d00b:9088:ad14:281a", port: "53369", type: "srflx", isPublic: true }
            ]
          }
        }
      }
    });

    expect(comparison).toMatchObject({
      Status: "matched request IP",
      "Additional public IPs": "45.159.90.144",
      "Different public IPs": "none"
    });
  });

  it("reports stale behaviour verdict samples separately from current behaviour", () => {
    expect(getBehaviorFreshness(sampleReport)).toMatchObject({ isStale: true });
    expect(buildBehaviorSummary(sampleReport)).toMatchObject({
      "Current sample": "15000 ms",
      "Verdict sample": "2500 ms",
      Events: "scroll:353 pointermove:8"
    });
  });

  it("builds cross-context rows and flags value drift", () => {
    const rows = buildWorkerConsistencyRows(sampleReport);
    const hardware = rows.find((row) => row.label === "Hardware threads");

    expect(rows.map((row) => row.label)).not.toContain("Request User-Agent");
    expect(hardware.status).toBe("differs");
    expect(hardware.values).toMatchObject({
      Window: "2",
      "Web Worker": "14",
      Iframe: "12",
      "Service Worker": "14"
    });
  });

  it("builds request-level consistency rows separately from worker context rows", () => {
    const rows = buildRequestConsistencyRows({
      ...sampleReport,
      client: {
        ...sampleReport.client,
        consistency: {
          userAgentMismatch: {
            requestUserAgent: "Mozilla/5.0",
            browserUserAgent: "Spoofed"
          },
          acceptLanguageMismatch: {
            requestLanguages: ["en-gb", "en"],
            browserLanguages: ["fr-fr", "fr"]
          },
          clientHintPlatformMismatch: {
            requestPlatform: "macOS",
            browserPlatform: "Windows"
          },
          clientHintMobileMismatch: {
            requestMobile: false,
            browserMobile: true
          }
        },
        browser: {
          ...sampleReport.client.browser,
          userAgent: "Spoofed",
          languages: ["fr-FR", "fr"],
          userAgentData: { platform: "Windows", mobile: true }
        }
      }
    });

    expect(rows).toEqual([
      {
        label: "User-Agent",
        values: {
          Request: "Mozilla/5.0",
          Browser: "Spoofed"
        },
        status: "differs"
      },
      {
        label: "Accept-Language",
        values: {
          Request: "en-GB,en;q=0.9",
          Browser: "fr-FR, fr"
        },
        status: "differs"
      },
      {
        label: "UA-CH platform",
        values: {
          Request: "macOS",
          Browser: "Windows"
        },
        status: "differs"
      },
      {
        label: "UA-CH mobile",
        values: {
          Request: "?0",
          Browser: "?1"
        },
        status: "differs"
      }
    ]);
  });
});
