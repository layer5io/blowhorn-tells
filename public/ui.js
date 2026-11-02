import { $ } from "./dom.js";
import {
  buildBehaviorSummary,
  buildNetworkIdentitySummary,
  buildReasonEvidence,
  buildRequestConsistencyRows,
  buildWebRtcComparison,
  buildWorkerConsistencyRows
} from "./report-view-model.js";
import { buildCheckRows, buildVerdictGroupLines, CHECK_GROUPS, reasonHeadline, SEVERITY_LABEL } from "./checks-view-model.js";
import { computeBehavior, interactionCompleted } from "./runtime.js";
import { bool, escapeHtml, formatValue } from "./utils.js";
import { renderSurfacePanels } from "./surface-ui.js";
import { verdictVoice, verdictWord } from "./voice.js";

// One variant per group. The three groups stack, so each differs from the one above and below it.
const CHECK_GROUP_VARIANT = { automation: "card-field", behavior: "card-stamp", fingerprint: "card-plain" };

export function renderReport(state, report, options = {}) {
  const verdict = report.verdict || {};
  renderVoice(verdictVoice(verdict.classification));

  renderVerdictCard(report);
  renderReasons(verdict.reasons || [], report);
  renderChecks(report);
  renderServerSummary(report.server || {});
  renderBrowserSummary(state, report.client || {});
  renderSurfacePanels(report, renderKv);
  renderNetworkIdentity(report);
  renderWebRtcComparison(report);
  renderWorkerConsistency(report);
  renderBehaviorSummary(report);
  renderRuntime(state);

  if (!options.preserveJson) {
    $("#jsonOut").textContent = JSON.stringify(report, null, 2);
  }
}

// Each signal leads with its plain headline and its weight. The raw reason id, the server's message
// and the evidence are in the details, like the checks list.
function renderReasons(reasons, report) {
  const el = $("#reasons");
  if (!reasons.length) {
    el.innerHTML = `<div class="muted">All quiet. No tells in this report.</div>`;
    return;
  }
  el.innerHTML = reasons.slice(0, 12).map((reason) => `
    <div class="reason">
      <p class="reason-head">
        <strong class="reason-title">${escapeHtml(reasonHeadline(reason.id))}</strong>
        <span class="reason-weight">${escapeHtml(SEVERITY_LABEL[reason.severity] || reason.severity)} &middot; -${escapeHtml(String(reason.points))}</span>
      </p>
      <details class="reason-more">
        <summary>Details</summary>
        <p class="reason-id"><code>${escapeHtml(reason.id)}</code></p>
        <p class="reason-message">${escapeHtml(reason.message)}</p>
        ${renderReasonEvidence(reason, report)}
      </details>
    </div>
  `).join("");
}

function renderReasonEvidence(reason, report) {
  const evidence = buildReasonEvidence(reason, report);
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

// The checks list: one group per heading, each row a disclosure. The label is the check name and
// its plain summary; opening it shows the raw observed value, the finding and the check's page.
function renderChecks(report) {
  const el = $("#checksGroups");
  const rows = buildCheckRows(report);
  el.innerHTML = CHECK_GROUPS.map(({ key, label }) => {
    const items = rows.filter((row) => row.group === key);
    if (!items.length) return "";
    return `
      <section class="check-group card ${CHECK_GROUP_VARIANT[key]}" id="checks-${key}" aria-labelledby="checks-${key}-title">
        <h3 id="checks-${key}-title">${escapeHtml(label)}</h3>
        <ul class="check-list">${items.map(renderCheckItem).join("")}</ul>
      </section>
    `;
  }).join("");
}

function renderCheckItem(row) {
  const status = escapeHtml(row.status);
  const observed = row.result && row.result !== row.summary ? `<p class="check-detail-line"><span class="check-detail-label">Observed</span> <code>${escapeHtml(row.result)}</code></p>` : "";
  const finding = row.finding ? `<p class="check-detail-line">${escapeHtml(row.finding)}</p>` : "";
  const about = row.slug ? `<a class="check-about" href="/checks/${escapeHtml(row.slug)}/">What this check means</a>` : "";
  // The row itself carries no status styling: the icon and the word next to the name say it.
  return `
    <li class="check-item">
      <details>
        <summary>
          <span class="check-icon check-${status}" aria-hidden="true">${escapeHtml(row.symbol)}</span>
          <span class="check-text">
            <span class="check-head">
              <span class="check-name">${escapeHtml(row.name)}</span>
              <span class="check-state check-${status}">${escapeHtml(row.label)}</span>
            </span>
            <span class="check-summary">${escapeHtml(row.summary)}</span>
          </span>
        </summary>
        <div class="check-detail">${observed}${finding}${about}</div>
      </details>
    </li>
  `;
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
    "Interaction test": challengeStatus(state)
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
    "Interaction test": challengeStatus(state)
  });
}

function challengeStatus(state) {
  return interactionCompleted(state) ? "complete" : state.interaction.startMs !== null ? "in progress" : "not started";
}

// The one verdict readout: the word, the score out of 100 on a bot-to-human scale, and one line per
// check group. The lines link to their group in the checks list. Called with no report while a run
// is collecting, which resets the card to its pending state.
export function renderVerdictCard(report = null) {
  const card = $("#verdictCard");
  if (!card) return;
  const verdict = report?.verdict || {};
  const score = report && Number.isFinite(verdict.score) ? verdict.score : null;
  $("#verdictWord").textContent = report ? verdictWord(verdict.classification) : verdictWord("pending");
  $("#verdictWord").dataset.risk = report && verdict.risk ? verdict.risk : "pending";
  $("#verdictScore").textContent = score == null ? "–" : String(score);
  const marker = $("#verdictMarker");
  marker.hidden = score == null;
  marker.style.left = `${score ?? 0}%`;
  $("#verdictGroups").innerHTML = report
    ? renderVerdictLines(buildVerdictGroupLines(buildCheckRows(report)))
    : `<p class="muted">Waiting for the inspection.</p>`;
}

function renderVerdictLines(lines) {
  return `<ul class="verdict-lines">${lines.map((line) => `
    <li>
      <a class="verdict-line verdict-${escapeHtml(line.status)}" href="#${escapeHtml(line.anchor)}">
        <span class="check-icon check-${escapeHtml(line.status)}" role="img" aria-label="${escapeHtml(line.statusLabel)}">${escapeHtml(line.symbol)}</span>
        <span class="verdict-line-text"><span class="verdict-line-group">${escapeHtml(line.label)}</span>: <span class="verdict-line-sentence">${escapeHtml(line.sentence)}</span></span>
      </a>
    </li>
  `).join("")}</ul>`;
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

export function renderVoice(voice, detail = "") {
  const title = $("#verdictTitle");
  const figure = $("#verdictFigure");
  if (title) title.textContent = voice.title;
  if (figure) {
    figure.src = voice.figure.src;
    figure.alt = voice.figure.alt;
  }
  setStatus(detail ? `${voice.line} ${detail}` : voice.line);
}
