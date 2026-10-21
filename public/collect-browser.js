import { safe, safeAsync } from "./utils.js";

export async function collectBrowser() {
  const permissions = await collectPermissions();
  const uaData = await collectUaData(navigator.userAgentData);
  const storage = await collectStorage();
  const mediaDevices = await collectMediaDevices();

  return {
    userAgent: navigator.userAgent,
    appVersion: navigator.appVersion,
    platform: navigator.platform,
    vendor: navigator.vendor,
    productSub: navigator.productSub,
    language: navigator.language,
    languages: Array.from(navigator.languages || []),
    webdriver: navigator.webdriver,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: navigator.deviceMemory || null,
    maxTouchPoints: navigator.maxTouchPoints,
    cookieEnabled: navigator.cookieEnabled,
    doNotTrack: navigator.doNotTrack || window.doNotTrack || navigator.msDoNotTrack || null,
    pdfViewerEnabled: navigator.pdfViewerEnabled ?? null,
    globalPrivacyControl: navigator.globalPrivacyControl ?? null,
    timezone: safe(() => Intl.DateTimeFormat().resolvedOptions().timeZone),
    timezoneOffsetMinutes: new Date().getTimezoneOffset(),
    locale: collectLocaleData(),
    screen: collectScreenData(),
    historyLength: history.length,
    devicePixelRatio: window.devicePixelRatio,
    userAgentData: uaData,
    plugins: collectPlugins(),
    mimeTypes: collectMimeTypes(),
    permissions,
    storage,
    mediaDevices,
    features: collectFeaturePresence(),
    prototypeChecks: collectPrototypeChecks(),
    pluginsConsistency: collectPluginConsistency(),
    stackProbe: collectStackProbe()
  };
}

async function collectUaData(userAgentData) {
  if (!userAgentData) return null;
  const out = {
    brands: userAgentData.brands || null,
    mobile: userAgentData.mobile,
    platform: userAgentData.platform
  };
  if (userAgentData.getHighEntropyValues) {
    out.highEntropy = await safeAsync(() => userAgentData.getHighEntropyValues([
      "architecture",
      "bitness",
      "formFactor",
      "fullVersionList",
      "model",
      "platformVersion",
      "uaFullVersion",
      "wow64"
    ]));
  }
  return out;
}

function collectLocaleData() {
  return {
    numberSample: safe(() => new Intl.NumberFormat().format(1234567.89)),
    dateSample: safe(() => new Intl.DateTimeFormat(undefined, { dateStyle: "full", timeStyle: "long" }).format(new Date("2026-05-12T12:34:56Z"))),
    calendar: safe(() => Intl.DateTimeFormat().resolvedOptions().calendar),
    numberingSystem: safe(() => Intl.DateTimeFormat().resolvedOptions().numberingSystem)
  };
}

function collectScreenData() {
  return {
    width: screen.width,
    height: screen.height,
    availWidth: screen.availWidth,
    availHeight: screen.availHeight,
    colorDepth: screen.colorDepth,
    pixelDepth: screen.pixelDepth,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    outerWidth: window.outerWidth,
    outerHeight: window.outerHeight,
    visualViewport: window.visualViewport ? {
      width: Math.round(window.visualViewport.width),
      height: Math.round(window.visualViewport.height),
      scale: window.visualViewport.scale,
      offsetLeft: Math.round(window.visualViewport.offsetLeft),
      offsetTop: Math.round(window.visualViewport.offsetTop)
    } : null
  };
}

function collectPlugins() {
  return Array.from(navigator.plugins || []).map((plugin) => ({
    name: plugin.name,
    filename: plugin.filename,
    description: plugin.description,
    mimeTypes: Array.from(plugin || []).map((mime) => ({ type: mime.type, suffixes: mime.suffixes, description: mime.description }))
  }));
}

function collectMimeTypes() {
  return Array.from(navigator.mimeTypes || []).map((mime) => ({
    type: mime.type,
    suffixes: mime.suffixes,
    description: mime.description,
    enabledPlugin: mime.enabledPlugin ? mime.enabledPlugin.name : null
  }));
}

async function collectPermissions() {
  const out = {};
  if (!navigator.permissions || !navigator.permissions.query) return { supported: false };
  const queries = ["notifications", "geolocation", "camera", "microphone", "clipboard-read", "clipboard-write"];
  for (const name of queries) {
    out[name] = await safeAsync(async () => {
      const result = await navigator.permissions.query({ name });
      return { state: result.state, permission: name === "notifications" ? window.Notification?.permission : undefined };
    });
  }
  return out;
}

async function collectStorage() {
  return {
    localStorage: storageProbe("localStorage"),
    sessionStorage: storageProbe("sessionStorage"),
    indexedDB: "indexedDB" in window,
    caches: "caches" in window,
    estimate: navigator.storage?.estimate ? await safeAsync(() => navigator.storage.estimate()) : null,
    persisted: navigator.storage?.persisted ? await safeAsync(() => navigator.storage.persisted()) : null
  };
}

function storageProbe(name) {
  try {
    const store = window[name];
    const key = "__amiabot_probe__";
    store.setItem(key, "1");
    const ok = store.getItem(key) === "1";
    store.removeItem(key);
    return { supported: true, writable: ok, length: store.length };
  } catch (error) {
    return { supported: false, error: String(error && error.message ? error.message : error) };
  }
}

async function collectMediaDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return { supported: false };
  return await safeAsync(async () => {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const counts = {};
    let labelsVisible = 0;
    for (const device of devices) {
      counts[device.kind] = (counts[device.kind] || 0) + 1;
      if (device.label) labelsVisible += 1;
    }
    return {
      supported: true,
      counts,
      labelsVisible,
      total: devices.length,
      supportedConstraints: navigator.mediaDevices.getSupportedConstraints
        ? Object.entries(navigator.mediaDevices.getSupportedConstraints()).filter(([, value]) => value === true).map(([name]) => name).sort()
        : []
    };
  });
}

function collectFeaturePresence() {
  return {
    chromeObject: Boolean(window.chrome),
    permissions: Boolean(navigator.permissions),
    serviceWorker: Boolean(navigator.serviceWorker),
    webWorker: Boolean(window.Worker),
    sharedWorker: Boolean(window.SharedWorker),
    webAssembly: Boolean(window.WebAssembly),
    webGL: Boolean(document.createElement("canvas").getContext("webgl")),
    webGL2: Boolean(document.createElement("canvas").getContext("webgl2")),
    webGPU: Boolean(navigator.gpu),
    webRTC: Boolean(window.RTCPeerConnection),
    bluetooth: Boolean(navigator.bluetooth),
    hid: Boolean(navigator.hid),
    usb: Boolean(navigator.usb),
    serial: Boolean(navigator.serial),
    battery: Boolean(navigator.getBattery),
    notification: Boolean(window.Notification),
    credentialManagement: Boolean(navigator.credentials),
    clipboard: Boolean(navigator.clipboard),
    offscreenCanvas: Boolean(window.OffscreenCanvas),
    touchEvent: Boolean(window.TouchEvent)
  };
}

function collectPrototypeChecks() {
  const props = ["userAgent", "platform", "languages", "hardwareConcurrency", "plugins", "webdriver", "deviceMemory", "maxTouchPoints"];
  const proto = Object.getPrototypeOf(navigator);
  const descriptors = {};
  const nativeGetterFailures = [];

  for (const prop of props) {
    const desc = Object.getOwnPropertyDescriptor(proto, prop) || Object.getOwnPropertyDescriptor(navigator, prop);
    if (!desc) {
      descriptors[prop] = null;
      continue;
    }
    const source = desc.get ? Function.prototype.toString.call(desc.get) : desc.value ? Function.prototype.toString.call(desc.value) : null;
    descriptors[prop] = {
      configurable: desc.configurable,
      enumerable: desc.enumerable,
      hasGetter: Boolean(desc.get),
      hasSetter: Boolean(desc.set),
      hasValue: "value" in desc,
      sourceSnippet: source ? source.slice(0, 140) : null
    };
    if (source && !source.includes("[native code]") && prop !== "webdriver") {
      nativeGetterFailures.push({ prop, sourceSnippet: source.slice(0, 140) });
    }
  }

  return { descriptors, nativeGetterFailures };
}

function collectPluginConsistency() {
  const plugins = navigator.plugins;
  const result = { supported: Boolean(plugins), length: plugins ? plugins.length : 0 };
  if (!plugins || plugins.length === 0) return result;

  try {
    const firstPlugin = plugins[0];
    const firstMime = firstPlugin && firstPlugin[0];
    if (firstMime && firstMime.enabledPlugin) {
      result.nameMatch = firstPlugin.name === firstMime.enabledPlugin.name;
      result.referenceMismatch = firstMime.enabledPlugin !== firstPlugin;
    }
  } catch (error) {
    result.referenceError = String(error && error.message ? error.message : error);
  }

  try {
    result.itemOverflowMatchesFirst = plugins.item(4294967296) === plugins[0];
  } catch (error) {
    result.itemOverflowError = String(error && error.message ? error.message : error);
  }

  try {
    const original = plugins.refresh;
    plugins.refresh = "amiabot-test";
    result.refreshWritable = plugins.refresh === "amiabot-test";
    plugins.refresh = original;
  } catch (error) {
    result.refreshWritable = false;
    result.refreshError = String(error && error.message ? error.message : error);
  }

  return result;
}

function collectStackProbe() {
  let recursion = null;
  try {
    let depth = 0;
    (function recurse() {
      depth += 1;
      recurse();
    })();
  } catch (error) {
    recursion = {
      depth: countStackDepth(error),
      name: error.name,
      message: error.message,
      stackLength: String(error.stack || "").length
    };
  }
  return recursion;
}

function countStackDepth(error) {
  const stack = String(error.stack || "");
  const lines = stack.split("\n").length;
  return lines || null;
}

export function collectAutomationSignals() {
  const markers = [
    "_phantom",
    "callPhantom",
    "__nightmare",
    "domAutomation",
    "domAutomationController",
    "__webdriver_script_fn",
    "__driver_evaluate",
    "__webdriver_evaluate",
    "__selenium_evaluate",
    "__fxdriver_evaluate",
    "__driver_unwrapped",
    "__webdriver_unwrapped",
    "__selenium_unwrapped",
    "__fxdriver_unwrapped",
    "_Selenium_IDE_Recorder",
    "_selenium",
    "calledSelenium",
    "cdc_adoQpoasnfa76pfcZLmcfl_Array",
    "cdc_adoQpoasnfa76pfcZLmcfl_Promise",
    "cdc_adoQpoasnfa76pfcZLmcfl_Symbol"
  ];
  const present = markers.filter((name) => name in window);

  return {
    present,
    cdpSerializationSignal: detectCdpSerialization(),
    webdriver: navigator.webdriver === true,
    headlessUserAgent: /HeadlessChrome|PhantomJS|SlimerJS/i.test(navigator.userAgent)
  };
}

function detectCdpSerialization() {
  let tripped = false;
  try {
    const error = new Error("amiabot-cdp-probe");
    Object.defineProperty(error, "stack", {
      configurable: true,
      get() {
        tripped = true;
        return "";
      }
    });
    // Some automation stacks serialize console arguments through CDP and trigger the getter.
    console.debug(error);
  } catch (_) {
    return false;
  }
  return tripped;
}
