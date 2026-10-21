import { $ } from "./dom.js";
import {
  buildBehaviorSummary,
  buildNetworkIdentitySummary,
  buildReasonEvidence,
  buildRequestConsistencyRows,
  buildWebRtcComparison,
  buildWorkerConsistencyRows
} from "./report-view-model.js";
import { computeBehavior } from "./runtime.js";
import { bool, escapeHtml, formatValue } from "./utils.js";
import { renderSurfacePanels } from "./surface-ui.js";

const DOT_CLASSES = ["dot-good", "dot-warn", "dot-bad", "dot-muted"];

export function renderReport(state, report, options = {}) {
  const verdict = report.verdict || {};
  const scoreCard = $("#scoreCard");
  scoreCard.className = `score-card ${verdict.risk || "pending"}`;
  scoreCard.innerHTML = verdict.score == null ? "Pending" : `${escapeHtml(String(verdict.score))}<small>${escapeHtml(verdict.classification || "unknown")}</small>`;
  setStatus(`Classification: ${verdict.classification || "unknown"}. Risk: ${verdict.risk || "unknown"}.`);

  renderReasons(verdict.reasons || []);
  renderCoverage(report.detections || []);
  renderServerSummary(report.server || {});
  renderBrowserSummary(state, report.client || {});
  renderSurfacePanels(report, renderKv);
  renderNetworkIdentity(report);
  renderWebRtcComparison(report);
  renderWorkerConsistency(report);
  renderBehaviorSummary(report);
  renderRuntime(state);
  updateHeroReadoutFromReport(report);

  if (!options.preserveJson) {
    $("#jsonOut").textContent = JSON.stringify(report, null, 2);
  }
}

function renderReasons(reasons) {
  const el = $("#reasons");
  if (!reasons.length) {
    el.innerHTML = `<div class="muted">No suspicious signals in current report.</div>`;
    return;
  }
  el.innerHTML = reasons.slice(0, 12).map((reason) => `
    <div class="reason">
      <strong>${escapeHtml(reason.id)} &middot; ${escapeHtml(reason.severity)} &middot; -${escapeHtml(String(reason.points))}</strong>
      <span>${escapeHtml(reason.message)}</span>
      ${renderReasonEvidence(reason)}
    </div>
  `).join("");
}

function renderReasonEvidence(reason) {
  const evidence = buildReasonEvidence(reason);
  if (!evidence.length) return "";
  return `
    <dl class="reason-evidence">
      ${evidence.map((item) => `
        <div class="${item.tone === "alert" ? "is-alert" : ""}">
          <dt>${escapeHtml(item.label)}</dt>
          <dd>${escapeHtml(formatValue(item.value))}</dd>
        </div>
      `).join("")}
    </dl>
  `;
}

function renderCoverage(rows) {
  const tbody = $("#coverageTable tbody");
  tbody.innerHTML = rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.name)}</td>
      <td><span class="status-pill status-${escapeHtml(row.status)}">${escapeHtml(row.status)}</span></td>
      <td>${escapeHtml(row.notes || "")}</td>
    </tr>
  `).join("");
}

function renderServerSummary(server) {
  const ipIntel = server.ipIntel?.normalized || {};
  const cfBot = server.cloudflareBotManagement || {};
  const summary = {
    IP: server.ip || "n/a",
    Country: server.cf?.country || ipIntel.country || "n/a",
    Colo: server.cf?.colo || "n/a",
    ASN: server.cf?.asn || ipIntel.asn || "n/a",
    Organization: server.cf?.asOrganization || ipIntel.providerName || "n/a",
    "HTTP protocol": server.cf?.httpProtocol || "n/a",
    "TCP RTT": server.cf?.clientTcpRtt != null ? `${server.cf.clientTcpRtt} ms` : "n/a",
    "Proxy/VPN/Tor/DC": `proxy=${bool(ipIntel.isProxy)} vpn=${bool(ipIntel.isVpn)} tor=${bool(ipIntel.isTor)} dc=${bool(ipIntel.isDatacenter)}`,
  };

  if (server.ipIntel?.enabled) {
    summary["IP reputation"] = `${server.ipIntel.provider || "active"} ${server.ipIntel.elapsedMs ? `(${server.ipIntel.elapsedMs} ms)` : ""}`;
  }

  if (cfBot.available) {
    summary["Managed bot score"] = `${cfBot.score} verified=${bool(cfBot.verifiedBot)}`;
    summary["JA3/JA4"] = `${cfBot.ja3Hash || "n/a"} / ${cfBot.ja4 || "n/a"}`;
  }

  renderKv("#serverSummary", summary);
}

function renderBrowserSummary(state, client) {
  const b = client.browser || {};
  const fp = client.fingerprints || {};
  const workers = client.workers || {};
  const webrtc = client.network?.webrtc || {};
  renderKv("#browserSummary", {
    "User-Agent": b.userAgent || "n/a",
    Platform: b.platform || "n/a",
    Timezone: b.timezone || "n/a",
    WebDriver: bool(b.webdriver),
    Plugins: Array.isArray(b.plugins) ? b.plugins.length : "n/a",
    "Canvas hash": fp.canvas?.hash || "n/a",
    "WebGL renderer": fp.webgl?.params?.unmaskedRenderer || fp.webgl?.params?.renderer || "n/a",
    "Audio hash": fp.audio?.hash || "n/a",
    "Worker platform": workers.webWorker?.platform || "n/a",
    "Service worker platform": workers.serviceWorker?.platform || "n/a",
    "WebRTC public IPs": (webrtc.publicIps || []).join(", ") || "none",
    "WebRTC private/mDNS": `${(webrtc.privateIps || []).join(", ") || "none"} / ${(webrtc.mdnsHosts || []).length || 0} mDNS`,
    "Behavior score": client.behavior?.score ?? "n/a",
    "Human check": challengeStatus(state)
  });
}

function renderNetworkIdentity(report) {
  renderKv("#networkIdentity", buildNetworkIdentitySummary(report));
}

function renderWebRtcComparison(report) {
  renderKv("#webrtcComparison", buildWebRtcComparison(report));
}

function renderBehaviorSummary(report) {
  renderKv("#behaviorSummary", buildBehaviorSummary(report));
}

function renderWorkerConsistency(report) {
  const requestTbody = $("#requestConsistencyTable tbody");
  requestTbody.innerHTML = buildRequestConsistencyRows(report).map((row) => `
    <tr>
      <td>${escapeHtml(row.label)}</td>
      <td><code>${escapeHtml(row.values.Request)}</code></td>
      <td><code>${escapeHtml(row.values.Browser)}</code></td>
      <td><span class="status-pill status-${escapeHtml(row.status)}">${escapeHtml(row.status)}</span></td>
    </tr>
  `).join("");

  const tbody = $("#workerConsistencyTable tbody");
  tbody.innerHTML = buildWorkerConsistencyRows(report).map((row) => `
    <tr>
      <td>${escapeHtml(row.label)}</td>
      <td><code>${escapeHtml(row.values.Window)}</code></td>
      <td><code>${escapeHtml(row.values["Web Worker"])}</code></td>
      <td><code>${escapeHtml(row.values.Iframe)}</code></td>
      <td><code>${escapeHtml(row.values["Service Worker"])}</code></td>
      <td><span class="status-pill status-${escapeHtml(row.status)}">${escapeHtml(row.status)}</span></td>
    </tr>
  `).join("");
}

export function renderRuntime(state) {
  const behavior = computeBehavior(state);
  renderKv("#runtime", {
    "Elapsed": `${Math.round(performance.now() - state.startedAt)} ms`,
    "Behavior score": behavior.score,
    "Events": Object.entries(behavior.summary.eventCounts).map(([key, value]) => `${key}:${value}`).join(" ") || "none",
    "Pointer distance": behavior.summary.pointerDistance,
    "Human check": challengeStatus(state)
  });
  if (!state.report) {
    updateHeroReadout({ behaviour: String(behavior.score) });
  }
}

function challengeStatus(state) {
  return state.challenge.completed ? "complete" : state.challenge.tableShown ? "in progress" : state.challenge.formSubmitted ? "submitted" : "not started";
}

function updateHeroReadoutFromReport(report) {
  const webdriver = report.client?.browser?.webdriver;
  const score = report.verdict?.score;
  const behaviorScore = report.client?.behavior?.score;
  const webrtc = report.client?.network?.webrtc || {};
  const memory = report.client?.surfaces?.performance?.memory || {};
  const extensions = report.client?.surfaces?.extensions || {};
  updateHeroReadout({
    webdriver: webdriver == null ? "unknown" : webdriver ? "yes" : "no",
    verdict: score == null ? "pending" : String(score),
    behaviour: behaviorScore == null ? "sampling" : String(behaviorScore),
    webrtc: formatHeroWebrtc(webrtc),
    memory: memory.supported ? `${formatValue(memory.usedRatio)}` : "n/a",
    extensions: extensions.enabled ? `${extensions.detectedCount || 0}/${extensions.checked || 0}` : "n/a",
    risk: report.verdict?.risk || "pending",
    score
  });
}

export function updateHeroReadout(values = {}) {
  const webdriver = $("#heroWebdriver");
  const verdict = $("#heroVerdict");
  const behaviour = $("#heroBehaviour");
  const webrtc = $("#heroWebrtc");
  const memory = $("#heroMemory");
  const extensions = $("#heroExtensions");
  if (webdriver && values.webdriver) webdriver.textContent = values.webdriver;
  if (verdict && values.verdict) verdict.textContent = values.verdict;
  if (behaviour && values.behaviour) behaviour.textContent = values.behaviour;
  if (webrtc && values.webrtc) webrtc.textContent = values.webrtc;
  if (memory && values.memory) memory.textContent = values.memory;
  if (extensions && values.extensions) extensions.textContent = values.extensions;
  updateScannerState(values);
}

function updateScannerState(values) {
  const ring = $("#scannerRing");
  if (!ring) return;
  const score = Number(values.score ?? values.verdict);
  const boundedScore = Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : 0;
  const risk = values.risk || "pending";
  ring.className = `scanner-ring scanner-${escapeScannerRisk(risk)}`;
  ring.style.setProperty("--scanner-score", String(boundedScore));
  ring.style.setProperty("--scanner-angle", `${Math.round((boundedScore / 100) * 360)}deg`);

  setScannerDot("#scannerWebdriverDot", values.webdriver === "yes" ? "bad" : values.webdriver === "no" ? "good" : "muted");
  setScannerDot("#scannerWebrtcDot", values.webrtc === "mismatch" ? "bad" : values.webrtc === "matched" ? "good" : values.webrtc === "extra" ? "warn" : "muted");
  setScannerDot("#scannerMemoryDot", values.memory && values.memory !== "n/a" && values.memory !== "pending" ? "good" : "muted");
  setScannerDot("#scannerExtensionDot", values.extensions && values.extensions !== "n/a" && values.extensions !== "pending" && !String(values.extensions).startsWith("0/") ? "warn" : "good");
}

function setScannerDot(selector, tone) {
  const dot = $(selector);
  if (!dot) return;
  dot.classList.remove(...DOT_CLASSES);
  dot.classList.add(`dot-${tone}`);
}

function escapeScannerRisk(risk) {
  return ["low", "medium", "high", "pending"].includes(risk) ? risk : "pending";
}

function formatHeroWebrtc(webrtc) {
  if (webrtc.publicIpLeakDifferentFromServer) return "mismatch";
  if (webrtc.publicIpMatchedServer && webrtc.additionalPublicIps?.length) return "extra";
  if (webrtc.publicIpMatchedServer) return "matched";
  if (webrtc.supported === false) return "n/a";
  return "pending";
}

function renderKv(selector, obj) {
  const el = $(selector);
  el.innerHTML = Object.entries(obj).map(([key, value]) => `
    <div>${escapeHtml(key)}</div><div><code>${escapeHtml(formatValue(value))}</code></div>
  `).join("");
}

export function setStatus(text) {
  $("#status").textContent = text;
}
