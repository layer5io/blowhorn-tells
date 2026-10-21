import { collectAutomationSignals, collectBrowser } from "./collect-browser.js";
import { collectFingerprints } from "./collect-fingerprints.js";
import { collectNetwork } from "./collect-network.js";
import { collectSurfaceIndicators } from "./collect-surfaces.js";
import { collectWorkers } from "./collect-workers.js";
import { $ } from "./dom.js";
import { computeBehavior } from "./runtime.js";
import { renderReport, setStatus, updateHeroReadout } from "./ui.js";
import { guessPlatformOs, guessUaOs, simplifyPerformanceEntry } from "./utils.js";

export async function runChecks(state) {
  const runBtn = $("#runBtn");
  runBtn.disabled = true;
  setStatus("Collecting signals...");
  updateHeroReadout({ webdriver: "checking", verdict: "pending", behaviour: "sampling" });

  try {
    const browser = await collectBrowser();
    const automation = collectAutomationSignals();

    const [workers, fingerprints, network, surfaces] = await Promise.all([
      collectWorkers(),
      collectFingerprints(),
      collectNetwork(state),
      collectSurfaceIndicators(state)
    ]);

    const client = {
      page: collectPageData(state),
      browser,
      automation,
      workers,
      fingerprints,
      surfaces,
      network,
      consistency: computeConsistency(browser, workers, network),
      behavior: computeBehavior(state),
      challenge: { ...state.challenge }
    };

    setStatus("Sending report to Worker...");
    const report = await postReport(client);
    state.report = report;
    renderReport(state, report);
    $("#copyBtn").disabled = false;
    $("#downloadBtn").disabled = false;
  } catch (error) {
    setStatus(`Error: ${error && error.message ? error.message : error}`);
    $("#jsonOut").textContent = String(error && error.stack ? error.stack : error);
  } finally {
    runBtn.disabled = false;
  }
}

async function postReport(client) {
  const response = await fetch("/api/report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(client)
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function collectPageData(state) {
  const navigation = performance.getEntriesByType("navigation")[0];
  return {
    url: location.href,
    origin: location.origin,
    referrer: document.referrer || null,
    title: document.title,
    visibilityState: document.visibilityState,
    isSecureContext: window.isSecureContext,
    crossOriginIsolated: window.crossOriginIsolated,
    elapsedMs: Math.round(performance.now() - state.startedAt),
    navigation: navigation ? simplifyPerformanceEntry(navigation) : null
  };
}

export function computeConsistency(browser, workers, network) {
  const consistency = {};
  const uaOS = guessUaOs(browser.userAgent);
  const platformOS = guessPlatformOs(browser.platform);

  if (uaOS && platformOS && uaOS !== platformOS) {
    consistency.uaPlatformMismatch = { userAgentOS: uaOS, platformOS, platform: browser.platform };
  }
  if (workers.webWorker?.platform && browser.platform && workers.webWorker.platform !== browser.platform) {
    consistency.workerPlatformMismatch = { windowPlatform: browser.platform, workerPlatform: workers.webWorker.platform };
  }
  if (workers.iframe?.platform && browser.platform && workers.iframe.platform !== browser.platform) {
    consistency.iframePlatformMismatch = { windowPlatform: browser.platform, iframePlatform: workers.iframe.platform };
  }
  if (browser.screen?.innerWidth > browser.screen?.width + 8 || browser.screen?.innerHeight > browser.screen?.height + 8) {
    consistency.screenViewportImpossible = browser.screen;
  }
  if (network.webrtc?.publicIps?.length) {
    consistency.webrtcPublicIps = network.webrtc.publicIps;
  }
  return consistency;
}
