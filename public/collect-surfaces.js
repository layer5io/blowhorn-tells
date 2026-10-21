import { copyPlain, promiseWithTimeout, safeAsync, sha256 } from "./utils.js";
import { buildPerformanceMemorySurface } from "./performance-memory.js";

const EME_KEY_SYSTEMS = [
  ["Widevine", "com.widevine.alpha"],
  ["PlayReady", "com.microsoft.playready"],
  ["YouTube PlayReady", "com.youtube.playready"],
  ["ClearKey WebKit", "webkit-org.w3.clearkey"],
  ["ClearKey", "org.w3.clearkey"],
  ["Primetime", "com.adobe.primetime"],
  ["FairPlay", "com.apple.fairplay"]
];

const EXTENSION_PROBES = [
  ["Google Translate", "chrome-extension://aapbdbdomjkkjkaonfhkkikfgjllcleb/popup_css_compiled.css", "style"],
  ["Grammarly", "chrome-extension://kbfnbcaeplbcioakkpcpgfkobkghlhen/src/css/Grammarly-fonts.styles.css", "style"],
  ["LanguageTool", "chrome-extension://oldceeleldhonbafppcapldpdifcinji/privacyConfirmationDialog/loginRedirectUri.html", "frame"],
  ["LastPass", "chrome-extension://hdokiejnpimakedhajhdlcegeplioahd/overlay.html", "frame"],
  ["React Developer Tools", "chrome-extension://fmkadmapgofadopljbjfkapdkoienihi/icons/128.png", "image"],
  ["uBlock Origin", "chrome-extension://cjpalhdlnbpafiamejdnhcphjbkeiagm/img/icon_128.png", "image"],
  ["MetaMask", "chrome-extension://nkbihfbeogaeaoehlefnkodbefgpgknn/images/icon-64.png", "image"],
  ["Dark Reader", "chrome-extension://eimadpbcbfnmbkopoojfekhnkhdbieeh/ui/assets/images/icon-128.png", "image"],
  ["1Password", "chrome-extension://aeblfdkhhhdcdjpifhhbdiojplfjncoa/app/app.html", "frame"],
  ["Bitwarden", "chrome-extension://nngceckbapebfimnlniiiahkandclblb/images/icon128.png", "image"]
];

export async function collectSurfaceIndicators(state) {
  const [encryptedMedia, speechSynthesis, extensions] = await Promise.all([
    collectEncryptedMediaSupport(),
    collectSpeechSynthesisVoices(),
    collectExtensionProbing()
  ]);

  return {
    document: collectDocumentStatus(),
    devtools: collectDevtoolsHeuristic(),
    performance: buildPerformanceMemorySurface(state),
    resourceTiming: collectResourceTimingSurface(),
    encryptedMedia,
    featurePolicy: collectFeaturePolicySurface(),
    speechSynthesis,
    deviceSensors: collectDeviceSensorSurface(state),
    extensions
  };
}

function collectDocumentStatus() {
  return {
    hasFocus: document.hasFocus(),
    hidden: document.hidden,
    visibilityState: document.visibilityState,
    compatMode: document.compatMode,
    designMode: document.designMode,
    referrerPresent: Boolean(document.referrer)
  };
}

function collectDevtoolsHeuristic() {
  const threshold = 160;
  const widthGap = window.outerWidth - window.innerWidth;
  const heightGap = window.outerHeight - window.innerHeight;
  const widthThreshold = widthGap > threshold;
  const heightThreshold = heightGap > threshold;
  const isOpen = !(heightThreshold && widthThreshold) && (widthThreshold || heightThreshold);
  return {
    isOpen,
    orientation: isOpen ? widthThreshold ? "vertical" : "horizontal" : null,
    widthGap,
    heightGap,
    threshold
  };
}

function collectResourceTimingSurface() {
  const entries = performance.getEntries();
  const navigation = performance.getEntriesByType("navigation")[0];
  const timeline = entries
    .filter((entry) => ["navigation", "resource", "paint", "mark"].includes(entry.entryType))
    .slice(0, 80)
    .map(simplifyTimingEntry);

  return {
    supported: entries.length > 0,
    entriesCount: entries.length,
    navigation: navigation ? {
      type: navigation.type,
      encodedBodySize: navigation.encodedBodySize,
      decodedBodySize: navigation.decodedBodySize,
      transferSize: navigation.transferSize,
      domainLookupTime: roundTiming(navigation.domainLookupEnd - navigation.domainLookupStart),
      connectTime: roundTiming(navigation.connectEnd - navigation.connectStart),
      requestTime: roundTiming(navigation.responseStart - navigation.requestStart),
      responseTime: roundTiming(navigation.responseEnd - navigation.responseStart)
    } : null,
    timeline
  };
}

function simplifyTimingEntry(entry) {
  return {
    name: displayEntryName(entry),
    entryType: entry.entryType,
    startTime: roundTiming(entry.startTime),
    duration: roundTiming(entry.duration)
  };
}

function displayEntryName(entry) {
  if (entry.entryType === "navigation") return "document";
  if (entry.entryType === "paint" || entry.entryType === "mark") return entry.name;
  try {
    const url = new URL(entry.name, location.href);
    if (url.origin === location.origin) return url.pathname || "/";
    return url.hostname;
  } catch (_) {
    return String(entry.name || entry.entryType).slice(0, 80);
  }
}

async function collectEncryptedMediaSupport() {
  if (!navigator.requestMediaKeySystemAccess) return { supported: false, systems: [] };
  const systems = await Promise.all(EME_KEY_SYSTEMS.map(async ([name, keySystem]) => {
    const supported = await safeAsync(async () => {
      await promiseWithTimeout(navigator.requestMediaKeySystemAccess(keySystem, [
        { initDataTypes: ["keyids", "webm"] },
        { audioCapabilities: [{ contentType: 'audio/webm; codecs="opus"' }] }
      ]), 900, "Encrypted media probe timeout");
      return true;
    });
    return {
      name,
      keySystem,
      supported: supported === true,
      error: supported && typeof supported === "object" ? supported.error : null
    };
  }));
  return {
    supported: true,
    systems,
    supportedCount: systems.filter((item) => item.supported).length
  };
}

function collectFeaturePolicySurface() {
  const policy = document.featurePolicy || document.permissionsPolicy;
  if (!policy?.features) return { supported: false, features: [] };
  const features = safePolicyFeatures(policy);
  return {
    supported: true,
    features,
    count: features.length
  };
}

function safePolicyFeatures(policy) {
  try {
    return Array.from(policy.features()).sort();
  } catch (_) {
    return [];
  }
}

async function collectSpeechSynthesisVoices() {
  if (!window.speechSynthesis?.getVoices) return { supported: false, voices: [] };
  const voices = await waitForVoices();
  const mapped = voices.map((voice) => ({
    name: voice.name,
    lang: voice.lang,
    localService: voice.localService,
    default: voice.default
  }));
  return {
    supported: true,
    count: mapped.length,
    languages: [...new Set(mapped.map((voice) => voice.lang).filter(Boolean))].sort(),
    voices: mapped.slice(0, 120),
    hash: mapped.length ? await sha256(JSON.stringify(mapped)) : null
  };
}

async function collectExtensionProbing() {
  const results = await Promise.all(EXTENSION_PROBES.map(([name, url, kind]) => probeExtensionResource({ name, url, kind })));
  return {
    enabled: true,
    checked: results.length,
    detectedCount: results.filter((result) => result.detected).length,
    detected: results.filter((result) => result.detected).map(({ name, url, kind }) => ({ name, url, kind })),
    results
  };
}

function probeExtensionResource(probe) {
  return new Promise((resolve) => {
    let settled = false;
    let element = null;
    const finish = (detected) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      if (element) element.remove();
      resolve({ ...probe, detected });
    };
    const timeout = window.setTimeout(() => finish(false), 900);

    if (probe.kind === "image") {
      element = new Image();
      element.onload = () => finish(true);
      element.onerror = () => finish(false);
      element.src = probe.url;
      return;
    }

    if (probe.kind === "style") {
      element = document.createElement("link");
      element.rel = "preload";
      element.as = "style";
      element.onload = () => finish(true);
      element.onerror = () => finish(false);
      element.href = probe.url;
      document.head.appendChild(element);
      return;
    }

    element = document.createElement("iframe");
    element.setAttribute("aria-hidden", "true");
    element.style.cssText = "position:absolute;width:1px;height:1px;left:-9999px;top:-9999px;border:0";
    element.onload = () => finish(true);
    element.onerror = () => finish(false);
    element.src = probe.url;
    document.body.appendChild(element);
  });
}

async function waitForVoices() {
  for (let i = 0; i < 7; i += 1) {
    const voices = window.speechSynthesis.getVoices();
    if (voices.length) return voices;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return window.speechSynthesis.getVoices();
}

function collectDeviceSensorSurface(state) {
  const orientation = state.sensorSamples?.orientation || [];
  const motion = state.sensorSamples?.motion || [];
  return {
    support: {
      accelerometer: "Accelerometer" in window,
      linearAccelerationSensor: "LinearAccelerationSensor" in window,
      gyroscope: "Gyroscope" in window,
      absoluteOrientationSensor: "AbsoluteOrientationSensor" in window,
      deviceOrientationEvent: "DeviceOrientationEvent" in window,
      deviceMotionEvent: "DeviceMotionEvent" in window,
      requestPermission: Boolean(window.DeviceMotionEvent?.requestPermission || window.DeviceOrientationEvent?.requestPermission)
    },
    orientation: {
      samples: orientation.length,
      latest: copyPlain(orientation.length ? orientation[orientation.length - 1] : null)
    },
    motion: {
      samples: motion.length,
      latest: copyPlain(motion.length ? motion[motion.length - 1] : null)
    }
  };
}

function roundTiming(value) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}
