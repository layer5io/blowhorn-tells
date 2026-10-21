import { bool, formatBytes, formatMs } from "./utils.js";

export function buildSurfaceSummary(report) {
  const surfaces = report?.client?.surfaces || {};
  const performance = surfaces.performance || {};
  const resourceTiming = surfaces.resourceTiming || {};
  const sensors = surfaces.deviceSensors || {};

  return {
    "DevTools heuristic": formatDevtools(surfaces.devtools),
    Document: formatDocumentStatus(surfaces.document),
    "Approx FPS": performance.fps?.supported ? String(performance.fps.approximateFps) : "n/a",
    "Heap limit": formatBytes(performance.memory?.jsHeapSizeLimit),
    "Resource entries": resourceTiming.entriesCount ?? "n/a",
    "Domain lookup": formatMs(resourceTiming.navigation?.domainLookupTime),
    "Sensor samples": `${sensors.orientation?.samples || 0} orientation / ${sensors.motion?.samples || 0} motion`,
    Extensions: surfaces.extensions?.enabled ? `${surfaces.extensions.detectedCount || 0} detected / ${surfaces.extensions.checked || 0} checked` : "n/a"
  };
}

export function buildMemoryVisual(report) {
  const performance = report?.client?.surfaces?.performance || {};
  return buildPerformanceMemoryVisual(performance);
}

export function buildPerformanceMemoryVisual(performance) {
  const memory = performance.memory || {};
  const samples = Array.isArray(performance.samples) ? performance.samples : [];
  const heapMax = Math.max(
    1,
    ...samples.flatMap((sample) => [Number(sample.usedJSHeapSize || 0), Number(sample.totalJSHeapSize || 0)]),
    Number(memory.totalJSHeapSize || 0),
    Number(memory.usedJSHeapSize || 0)
  );

  return {
    supported: memory.supported === true,
    current: memory.supported === true ? {
      used: formatBytes(memory.usedJSHeapSize),
      total: formatBytes(memory.totalJSHeapSize),
      limit: formatBytes(memory.jsHeapSizeLimit),
      usedPercent: percent(memory.usedRatio)
    } : null,
    fps: performance.fps || null,
    ratioSeries: samples.map((sample, index) => ({
      index,
      label: formatMs(sample.t),
      value: percent(ratio(sample.usedJSHeapSize, sample.totalJSHeapSize))
    })),
    heapSeries: samples.map((sample, index) => ({
      index,
      label: formatMs(sample.t),
      usedBytes: sample.usedJSHeapSize,
      totalBytes: sample.totalJSHeapSize,
      usedPercent: percent(ratio(sample.usedJSHeapSize, heapMax)),
      totalPercent: percent(ratio(sample.totalJSHeapSize, heapMax))
    })),
    samplesCount: samples.length
  };
}

export function buildResourceTimeline(report) {
  const surface = report?.client?.surfaces?.resourceTiming || {};
  const timeline = Array.isArray(surface.timeline) ? surface.timeline : [];
  const maxEnd = Math.max(1, ...timeline.map((entry) => Number(entry.startTime || 0) + Number(entry.duration || 0)));

  return {
    supported: surface.supported === true,
    navigation: surface.navigation || null,
    entriesCount: surface.entriesCount || 0,
    bars: timeline.slice(0, 80).map((entry) => ({
      ...entry,
      leftPercent: Math.max(0, Math.min(100, (Number(entry.startTime || 0) / maxEnd) * 100)),
      widthPercent: Math.max(0.8, Math.min(100, (Number(entry.duration || 0) / maxEnd) * 100))
    }))
  };
}

export function buildMediaDrmSummary(report) {
  const browser = report?.client?.browser || {};
  const media = browser.mediaDevices || {};
  const encryptedMedia = report?.client?.surfaces?.encryptedMedia || {};

  return {
    devices: {
      supported: media.supported === true,
      counts: media.counts || {},
      labelsVisible: media.labelsVisible || 0,
      supportedConstraints: Array.isArray(media.supportedConstraints) ? media.supportedConstraints : []
    },
    encryptedMedia: {
      supported: encryptedMedia.supported === true,
      supportedCount: encryptedMedia.supportedCount || 0,
      systems: Array.isArray(encryptedMedia.systems) ? encryptedMedia.systems : []
    }
  };
}

export function buildSensorVisual(report) {
  const sensors = report?.client?.surfaces?.deviceSensors || {};
  const support = sensors.support || {};
  const orientation = sensors.orientation?.latest || null;
  const motion = sensors.motion?.latest || null;

  return {
    support: [
      ["Accelerometer", support.accelerometer],
      ["LinearAccelerationSensor", support.linearAccelerationSensor],
      ["Gyroscope", support.gyroscope],
      ["AbsoluteOrientationSensor", support.absoluteOrientationSensor],
      ["DeviceOrientationEvent", support.deviceOrientationEvent],
      ["DeviceMotionEvent", support.deviceMotionEvent],
      ["Permission-gated", support.requestPermission]
    ],
    orientation,
    motion,
    orientationSamples: sensors.orientation?.samples || 0,
    motionSamples: sensors.motion?.samples || 0
  };
}

export function buildVoicePolicySummary(report) {
  const surfaces = report?.client?.surfaces || {};
  const speech = surfaces.speechSynthesis || {};
  const policy = surfaces.featurePolicy || {};
  return {
    speech: {
      supported: speech.supported === true,
      count: speech.count || 0,
      languages: Array.isArray(speech.languages) ? speech.languages : [],
      voices: Array.isArray(speech.voices) ? speech.voices : []
    },
    policy: {
      supported: policy.supported === true,
      count: policy.count || 0,
      features: Array.isArray(policy.features) ? policy.features : []
    }
  };
}

export function buildExtensionProbeSummary(report) {
  const extensions = report?.client?.surfaces?.extensions || {};
  const results = Array.isArray(extensions.results) ? extensions.results : [];
  return {
    enabled: extensions.enabled === true,
    checked: extensions.checked || results.length,
    detectedCount: extensions.detectedCount || results.filter((item) => item.detected).length,
    results,
    detected: results.filter((item) => item.detected)
  };
}

function formatDevtools(devtools) {
  if (!devtools) return "n/a";
  return devtools.isOpen ? `open ${devtools.orientation || ""}`.trim() : "not detected";
}

function formatDocumentStatus(documentStatus) {
  if (!documentStatus) return "n/a";
  return `focus=${bool(documentStatus.hasFocus)} hidden=${bool(documentStatus.hidden)} visibility=${documentStatus.visibilityState || "n/a"}`;
}

function ratio(used, total) {
  if (!Number.isFinite(Number(used)) || !Number.isFinite(Number(total)) || Number(total) <= 0) return null;
  return Number(used) / Number(total);
}

function percent(value) {
  if (!Number.isFinite(Number(value))) return null;
  return Math.max(0, Math.min(100, Math.round(Number(value) * 1000) / 10));
}
