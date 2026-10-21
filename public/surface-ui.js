import { $ } from "./dom.js";
import { bool, escapeHtml, formatMs } from "./utils.js";
import {
  buildMediaDrmSummary,
  buildPerformanceMemoryVisual,
  buildExtensionProbeSummary,
  buildResourceTimeline,
  buildSensorVisual,
  buildSurfaceSummary,
  buildVoicePolicySummary
} from "./surface-view-model.js";

export function renderSurfacePanels(report, renderKv) {
  renderKv("#surfaceSummary", buildSurfaceSummary(report));
  renderPerformanceMemorySurface(report?.client?.surfaces?.performance || {});
  renderResourceTimeline(report);
  renderMediaDrmSummary(report);
  renderSensorVisual(report);
  renderExtensionProbeSummary(report);
  renderVoicePolicySummary(report);
}

export function renderPerformanceMemorySurface(performance) {
  const el = $("#memoryVisual");
  if (!el) return;
  const visual = buildPerformanceMemoryVisual(performance);
  if (!visual.supported) {
    el.className = "visual-block muted";
    el.textContent = "performance.memory is not exposed by this browser.";
    return;
  }

  el.className = "visual-block";
  el.innerHTML = `
    <div class="metric-row">
      <span>Used</span><strong>${escapeHtml(visual.current.used)}</strong>
      <span>Total</span><strong>${escapeHtml(visual.current.total)}</strong>
      <span>Limit</span><strong>${escapeHtml(visual.current.limit)}</strong>
      <span>FPS</span><strong>${escapeHtml(visual.fps?.approximateFps ?? "n/a")}</strong>
    </div>
    ${renderLineChart("Used / total heap", visual.ratioSeries, [{ key: "value", label: "Used/Total", className: "line-used" }], "%")}
    ${renderLineChart("Used and total JS heap size", visual.heapSeries, [
      { key: "usedPercent", label: "usedJSHeapSize", className: "line-used" },
      { key: "totalPercent", label: "totalJSHeapSize", className: "line-total" }
    ], "%")}
  `;
}

function renderResourceTimeline(report) {
  const el = $("#resourceTimeline");
  const timeline = buildResourceTimeline(report);
  if (!timeline.supported) {
    el.className = "visual-block muted";
    el.textContent = "Resource Timing entries are not available.";
    return;
  }

  el.className = "visual-block";
  el.innerHTML = `
    <div class="metric-row">
      <span>Entries</span><strong>${escapeHtml(timeline.entriesCount)}</strong>
      <span>Navigation</span><strong>${escapeHtml(timeline.navigation?.type || "n/a")}</strong>
      <span>DNS</span><strong>${escapeHtml(formatMs(timeline.navigation?.domainLookupTime))}</strong>
      <span>Response</span><strong>${escapeHtml(formatMs(timeline.navigation?.responseTime))}</strong>
    </div>
    <div class="timeline-bars" aria-label="Resource loading timeline">
      ${timeline.bars.map((entry) => `
        <div class="timeline-row timeline-${escapeHtml(entry.entryType)}">
          <span class="timeline-track">
            <span style="left:${entry.leftPercent}%;width:${entry.widthPercent}%"></span>
          </span>
          <code>${escapeHtml(entry.name)}</code>
        </div>
      `).join("")}
    </div>
  `;
}

function renderMediaDrmSummary(report) {
  const el = $("#mediaDrmSummary");
  const summary = buildMediaDrmSummary(report);
  const counts = summary.devices.counts || {};
  const constraints = summary.devices.supportedConstraints;
  const systems = summary.encryptedMedia.systems;

  el.className = "surface-grid";
  el.innerHTML = `
    <div class="metric-row">
      <span>Audio in</span><strong>${escapeHtml(counts.audioinput || 0)}</strong>
      <span>Audio out</span><strong>${escapeHtml(counts.audiooutput || 0)}</strong>
      <span>Video in</span><strong>${escapeHtml(counts.videoinput || 0)}</strong>
      <span>Labels</span><strong>${escapeHtml(summary.devices.labelsVisible)}</strong>
    </div>
    <div>
      <h3>Supported constraints</h3>
      ${renderChips(constraints.slice(0, 48))}
    </div>
    <div>
      <h3>Encrypted media</h3>
      <div class="check-grid">
        ${systems.map((system) => `
          <span class="${system.supported ? "is-good" : "is-bad"}">${escapeHtml(system.name)} <strong>${system.supported ? "yes" : "no"}</strong></span>
        `).join("") || `<span class="muted">Not exposed</span>`}
      </div>
    </div>
  `;
}

function renderSensorVisual(report) {
  const el = $("#sensorVisual");
  const sensor = buildSensorVisual(report);
  const orientation = sensor.orientation || {};
  const motion = sensor.motion || {};
  const tiltX = clampVisual(Number(orientation.gamma || 0), -90, 90);
  const tiltY = clampVisual(Number(orientation.beta || 0), -180, 180);

  el.className = "visual-block";
  el.innerHTML = `
    <div class="check-grid">
      ${sensor.support.map(([label, value]) => `
        <span class="${value ? "is-good" : "is-missing"}">${escapeHtml(label)} <strong>${bool(value)}</strong></span>
      `).join("")}
    </div>
    <div class="sensor-stage" style="--tilt-x:${tiltX};--tilt-y:${tiltY}">
      <span class="sensor-device"></span>
      <span class="sensor-axis sensor-axis-x"></span>
      <span class="sensor-axis sensor-axis-y"></span>
    </div>
    <div class="metric-row">
      <span>Orientation</span><strong>${escapeHtml(sensor.orientationSamples)} samples</strong>
      <span>Motion</span><strong>${escapeHtml(sensor.motionSamples)} samples</strong>
      <span>Latest tilt</span><strong>${escapeHtml(formatSensorVector(orientation, ["alpha", "beta", "gamma"]))}</strong>
      <span>Latest motion</span><strong>${escapeHtml(formatSensorVector(motion, ["x", "y", "z"]))}</strong>
    </div>
  `;
}

function renderExtensionProbeSummary(report) {
  const el = $("#extensionProbeSummary");
  const summary = buildExtensionProbeSummary(report);
  if (!summary.enabled) {
    el.className = "visual-block muted";
    el.textContent = "Extension probing did not run.";
    return;
  }

  el.className = "visual-block";
  el.innerHTML = `
    <div class="metric-row">
      <span>Checked</span><strong>${escapeHtml(summary.checked)}</strong>
      <span>Detected</span><strong>${escapeHtml(summary.detectedCount)}</strong>
    </div>
    <div class="check-grid">
      ${summary.results.map((extension) => `
        <span class="${extension.detected ? "is-good" : "is-missing"}">
          ${escapeHtml(extension.name)}
          <strong>${extension.detected ? "found" : "not found"}</strong>
        </span>
      `).join("")}
    </div>
  `;
}

function renderVoicePolicySummary(report) {
  const el = $("#voicePolicySummary");
  const summary = buildVoicePolicySummary(report);
  el.className = "visual-block";
  el.innerHTML = `
    <div class="metric-row">
      <span>Voices</span><strong>${escapeHtml(summary.speech.count)}</strong>
      <span>Languages</span><strong>${escapeHtml(summary.speech.languages.length)}</strong>
      <span>Policies</span><strong>${escapeHtml(summary.policy.count)}</strong>
    </div>
    <h3>Speech voices</h3>
    ${renderChips(summary.speech.voices.slice(0, 80).map((voice) => `${voice.lang || "n/a"} ${voice.name || ""}`.trim()))}
    <h3>Feature policy</h3>
    ${renderChips(summary.policy.features.slice(0, 90))}
  `;
}

function renderChips(values) {
  if (!Array.isArray(values) || !values.length) return `<div class="muted">none</div>`;
  return `<div class="chip-cloud">${values.map((value) => `<span>${escapeHtml(value)}</span>`).join("")}</div>`;
}

function renderLineChart(title, series, lines, unit) {
  const points = series.length ? series : [{ index: 0, value: 0, usedPercent: 0, totalPercent: 0, label: "now" }];
  return `
    <div class="memory-chart">
      <div class="chart-head">
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(points.length)} samples</span>
      </div>
      <svg viewBox="0 0 100 44" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(title)}">
        <line x1="0" y1="10" x2="100" y2="10"></line>
        <line x1="0" y1="22" x2="100" y2="22"></line>
        <line x1="0" y1="34" x2="100" y2="34"></line>
        ${lines.map((line) => `<polyline class="${line.className}" points="${escapeHtml(toPolyline(points, line.key))}"></polyline>`).join("")}
      </svg>
      <div class="chart-legend">
        ${lines.map((line) => `<span class="${line.className}">${escapeHtml(line.label)}</span>`).join("")}
        <code>${escapeHtml(formatLatestPoint(points, lines, unit))}</code>
      </div>
    </div>
  `;
}

function toPolyline(points, key) {
  if (points.length === 1) {
    const y = chartY(points[0][key]);
    return `0,${y} 100,${y}`;
  }
  return points.map((point, index) => {
    const x = (index / (points.length - 1)) * 100;
    return `${roundChart(x)},${chartY(point[key])}`;
  }).join(" ");
}

function chartY(value) {
  const clamped = Math.max(0, Math.min(100, Number(value) || 0));
  return roundChart(42 - (clamped / 100) * 38);
}

function roundChart(value) {
  return Math.round(value * 100) / 100;
}

function formatLatestPoint(points, lines, unit) {
  const latest = points[points.length - 1] || {};
  return lines.map((line) => `${line.label}:${latest[line.key] ?? "n/a"}${unit}`).join(" ");
}

function clampVisual(value, min, max) {
  if (!Number.isFinite(value)) return 0;
  const normalized = ((Math.max(min, Math.min(max, value)) - min) / (max - min)) * 2 - 1;
  return Math.round(normalized * 1000) / 1000;
}

function formatSensorVector(value, keys) {
  if (!value || typeof value !== "object") return "n/a";
  return keys.map((key) => `${key}:${value[key] ?? "n/a"}`).join(" ");
}
