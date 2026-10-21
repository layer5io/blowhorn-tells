import { describe, expect, it } from "vitest";
import {
  buildMediaDrmSummary,
  buildMemoryVisual,
  buildExtensionProbeSummary,
  buildResourceTimeline,
  buildSensorVisual,
  buildSurfaceSummary,
  buildVoicePolicySummary
} from "../public/surface-view-model.js";

const sampleReport = {
  client: {
    browser: {
      mediaDevices: {
        supported: true,
        counts: { audioinput: 1, audiooutput: 1, videoinput: 1 },
        labelsVisible: 0,
        supportedConstraints: ["aspectRatio", "frameRate", "width"]
      }
    },
    surfaces: {
      document: {
        hasFocus: true,
        hidden: false,
        visibilityState: "visible"
      },
      devtools: {
        isOpen: false,
        widthGap: 12,
        heightGap: 88
      },
      performance: {
        memory: {
          supported: true,
          usedJSHeapSize: 25 * 1024 * 1024,
          totalJSHeapSize: 50 * 1024 * 1024,
          jsHeapSizeLimit: 4 * 1024 * 1024 * 1024,
          usedRatio: 0.5
        },
        fps: { supported: true, approximateFps: 60 },
        samples: [
          { t: 500, usedJSHeapSize: 20 * 1024 * 1024, totalJSHeapSize: 40 * 1024 * 1024, jsHeapSizeLimit: 4 * 1024 * 1024 * 1024 },
          { t: 1000, usedJSHeapSize: 40 * 1024 * 1024, totalJSHeapSize: 50 * 1024 * 1024, jsHeapSizeLimit: 4 * 1024 * 1024 * 1024 }
        ]
      },
      resourceTiming: {
        supported: true,
        entriesCount: 3,
        navigation: { type: "navigate", domainLookupTime: 0, responseTime: 18 },
        timeline: [
          { name: "document", entryType: "navigation", startTime: 0, duration: 120 },
          { name: "/styles.css", entryType: "resource", startTime: 20, duration: 30 }
        ]
      },
      encryptedMedia: {
        supported: true,
        supportedCount: 1,
        systems: [
          { name: "Widevine", supported: true },
          { name: "FairPlay", supported: false }
        ]
      },
      deviceSensors: {
        support: {
          accelerometer: true,
          linearAccelerationSensor: false,
          gyroscope: true,
          absoluteOrientationSensor: true,
          deviceOrientationEvent: true,
          deviceMotionEvent: true,
          requestPermission: false
        },
        orientation: { samples: 2, latest: { alpha: 1, beta: 2, gamma: 3 } },
        motion: { samples: 1, latest: { x: 0.1, y: 0.2, z: 0.3 } }
      },
      speechSynthesis: {
        supported: true,
        count: 2,
        languages: ["en-GB", "en-US"],
        voices: [{ name: "Daniel", lang: "en-GB" }]
      },
      extensions: {
        enabled: true,
        checked: 2,
        detectedCount: 1,
        results: [
          { name: "Google Translate", detected: false },
          { name: "Grammarly", detected: true }
        ]
      },
      featurePolicy: {
        supported: true,
        count: 2,
        features: ["camera", "microphone"]
      },
      extensionProbing: { enabled: false }
    }
  }
};

describe("surface view model", () => {
  it("summarises high-level fingerprint surfaces", () => {
    expect(buildSurfaceSummary(sampleReport)).toMatchObject({
      "DevTools heuristic": "not detected",
      "Approx FPS": "60",
      "Heap limit": "4 GB",
      "Resource entries": 3,
      "Sensor samples": "2 orientation / 1 motion",
      Extensions: "1 detected / 2 checked"
    });
  });

  it("normalises memory samples into bar percentages", () => {
    const visual = buildMemoryVisual(sampleReport);

    expect(visual.current).toMatchObject({
      used: "25 MB",
      total: "50 MB",
      usedPercent: 50
    });
    expect(visual.ratioSeries.map((point) => point.value)).toEqual([50, 80]);
    expect(visual.heapSeries.map((point) => point.usedPercent)).toEqual([40, 80]);
    expect(visual.heapSeries.map((point) => point.totalPercent)).toEqual([80, 100]);
  });

  it("scales resource timing bars against the visible timeline", () => {
    const timeline = buildResourceTimeline(sampleReport);

    expect(timeline.bars[0]).toMatchObject({ leftPercent: 0, widthPercent: 100 });
    expect(timeline.bars[1].leftPercent).toBeGreaterThan(0);
  });

  it("groups media, DRM, sensor, voice, and policy surfaces", () => {
    expect(buildMediaDrmSummary(sampleReport).encryptedMedia.supportedCount).toBe(1);
    expect(buildSensorVisual(sampleReport).support).toContainEqual(["Gyroscope", true]);
    expect(buildVoicePolicySummary(sampleReport).policy.features).toEqual(["camera", "microphone"]);
    expect(buildExtensionProbeSummary(sampleReport).detected).toEqual([{ name: "Grammarly", detected: true }]);
  });
});
