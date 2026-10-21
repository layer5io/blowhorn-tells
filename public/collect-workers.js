import { promiseWithTimeout, sleep } from "./utils.js";

export async function collectWorkers() {
  const [webWorker, iframe, serviceWorker] = await Promise.all([
    collectWebWorker(),
    collectIframeNavigator(),
    collectServiceWorker()
  ]);
  return { webWorker, iframe, serviceWorker };
}

async function collectWebWorker() {
  if (!window.Worker) return { supported: false };
  const code = `
    async function collect() {
      const out = {
        supported: true,
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        language: navigator.language,
        languages: Array.from(navigator.languages || []),
        hardwareConcurrency: navigator.hardwareConcurrency,
        deviceMemory: navigator.deviceMemory || null,
        webdriver: navigator.webdriver,
        vendor: navigator.vendor,
        appVersion: navigator.appVersion
      };
      try {
        if (navigator.userAgentData) {
          out.userAgentData = {
            brands: navigator.userAgentData.brands,
            mobile: navigator.userAgentData.mobile,
            platform: navigator.userAgentData.platform
          };
          if (navigator.userAgentData.getHighEntropyValues) {
            out.userAgentData.highEntropy = await navigator.userAgentData.getHighEntropyValues(['architecture','bitness','formFactor','fullVersionList','model','platformVersion','uaFullVersion','wow64']);
          }
        }
      } catch (error) {
        out.userAgentData = { error: String(error && error.message ? error.message : error) };
      }
      postMessage(out);
    }
    collect();
  `;
  const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
  try {
    const worker = new Worker(url);
    const data = await promiseWithTimeout(new Promise((resolve, reject) => {
      worker.onmessage = (event) => resolve(event.data);
      worker.onerror = (event) => reject(new Error(event.message || "Web Worker error"));
    }), 1800, "Web Worker timeout");
    worker.terminate();
    return data;
  } catch (error) {
    return { supported: true, error: String(error && error.message ? error.message : error) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function collectIframeNavigator() {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = "position:absolute;width:1px;height:1px;left:-9999px;top:-9999px;border:0";
  document.body.appendChild(iframe);
  await sleep(0);
  try {
    const n = iframe.contentWindow.navigator;
    return {
      supported: true,
      userAgent: n.userAgent,
      platform: n.platform,
      language: n.language,
      languages: Array.from(n.languages || []),
      hardwareConcurrency: n.hardwareConcurrency,
      deviceMemory: n.deviceMemory || null,
      webdriver: n.webdriver,
      vendor: n.vendor,
      appVersion: n.appVersion,
      pluginsLength: n.plugins ? n.plugins.length : null
    };
  } catch (error) {
    return { supported: true, error: String(error && error.message ? error.message : error) };
  } finally {
    iframe.remove();
  }
}

async function collectServiceWorker() {
  if (!navigator.serviceWorker || !window.isSecureContext) {
    return { supported: false, reason: "Service Worker requires secure context and navigator.serviceWorker." };
  }
  try {
    const registration = await navigator.serviceWorker.register("/sw-detector.js", { scope: "/" });
    await navigator.serviceWorker.ready;
    const sw = registration.active || registration.waiting || registration.installing || navigator.serviceWorker.controller;
    if (!sw) return { supported: true, error: "No active service worker after registration." };

    const channel = new MessageChannel();
    const responsePromise = new Promise((resolve) => {
      channel.port1.onmessage = (event) => resolve(event.data);
    });
    sw.postMessage({ type: "amiabot:inspect" }, [channel.port2]);
    return await promiseWithTimeout(responsePromise, 1800, "Service Worker timeout");
  } catch (error) {
    return { supported: true, error: String(error && error.message ? error.message : error) };
  }
}
