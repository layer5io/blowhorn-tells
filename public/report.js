import { collectAutomationSignals, collectBrowser } from "./collect-browser.js";
import { collectFingerprints } from "./collect-fingerprints.js";
import { buildInteractionReport, INTERACTION_PHRASE } from "./collect-interaction.js";
import { collectNetwork } from "./collect-network.js";
import { collectSurfaceIndicators } from "./collect-surfaces.js";
import { collectTells } from "./collect-tells.js";
import { collectWorkers } from "./collect-workers.js";
import { $ } from "./dom.js";
import { computeBehavior } from "./runtime.js";
import { renderReport, renderVoice, setStatus, updateHeroReadout } from "./ui.js";
import { failureVoice, verdictVoice } from "./voice.js";
import { guessPlatformOs, guessUaOs, simplifyPerformanceEntry } from "./utils.js";

let latestRun = 0;

// Resolves true when the server returned a verdict, false when the run failed, and null when a newer run
// started before this one finished. Only the newest run touches the page, so an older, slower run cannot
// overwrite its verdict or re-enable the Run button while it is still running.
export async function runChecks(state) {
  const run = ++latestRun;
  const isLatest = () => run === latestRun;
  const runBtn = $("#runBtn");
  runBtn.disabled = true;
  renderVoice(verdictVoice("pending"), "Collecting signals in this browser.");
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
      tells: collectTells(state),
      workers,
      fingerprints,
      surfaces,
      network,
      consistency: computeConsistency(browser, workers, network),
      behavior: computeBehavior(state),
      interaction: state.interaction.report || notTakenInteraction()
    };

    if (!isLatest()) return null;
    setStatus("Inspection in progress. Sending the readings to the server for scoring.");
    const report = await postReport(client);
    if (!isLatest()) return null;
    state.report = report;
    renderReport(state, report);
    $("#copyBtn").disabled = false;
    $("#downloadBtn").disabled = false;
    return true;
  } catch (error) {
    if (!isLatest()) return null;
    renderVoice(failureVoice(String(error && error.message ? error.message : error)));
    $("#jsonOut").textContent = String(error && error.stack ? error.stack : error);
    return false;
  } finally {
    if (isLatest()) runBtn.disabled = false;
  }
}

// The interaction report is always sent. Before Submit it describes an untaken test, which scores nothing.
function notTakenInteraction() {
  return buildInteractionReport([], {
    phraseLength: INTERACTION_PHRASE.length,
    startMs: null,
    endMs: null,
    completed: false,
    valueMatches: false,
    valueSetterNative: null,
    fullscreen: false
  });
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
