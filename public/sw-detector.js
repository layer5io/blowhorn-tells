self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", async (event) => {
  if (!event.data || event.data.type !== "amiabot:inspect") return;

  const replyPort = event.ports && event.ports[0];
  const data = {
    supported: true,
    userAgent: safe(() => navigator.userAgent),
    platform: safe(() => navigator.platform),
    language: safe(() => navigator.language),
    languages: safe(() => Array.from(navigator.languages || [])),
    hardwareConcurrency: safe(() => navigator.hardwareConcurrency),
    deviceMemory: safe(() => navigator.deviceMemory),
    webdriver: safe(() => navigator.webdriver),
    vendor: safe(() => navigator.vendor),
    appVersion: safe(() => navigator.appVersion),
    userAgentData: await getUaData()
  };

  if (replyPort) replyPort.postMessage(data);
});

async function getUaData() {
  try {
    if (!navigator.userAgentData) return null;
    const base = {
      mobile: navigator.userAgentData.mobile,
      platform: navigator.userAgentData.platform,
      brands: navigator.userAgentData.brands
    };
    if (navigator.userAgentData.getHighEntropyValues) {
      base.highEntropy = await navigator.userAgentData.getHighEntropyValues([
        "architecture",
        "bitness",
        "formFactor",
        "fullVersionList",
        "model",
        "platformVersion",
        "uaFullVersion",
        "wow64"
      ]);
    }
    return base;
  } catch (error) {
    return { error: String(error && error.message ? error.message : error) };
  }
}

function safe(fn) {
  try {
    const value = fn();
    return value === undefined ? null : value;
  } catch (error) {
    return { error: String(error && error.message ? error.message : error) };
  }
}
