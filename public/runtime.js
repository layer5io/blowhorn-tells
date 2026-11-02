import { collectPerformanceMemorySnapshot, buildPerformanceMemorySurface } from "./performance-memory.js";
import { standardDeviation } from "./utils.js";

export const BEHAVIOR_CHECKPOINTS_MS = [1500, 4000, 7000, 10000, 15000];

// The interaction test's three buttons. Only events on these elements are recorded for it.
const INTERACTION_TARGETS = new Set(["start", "phrase", "submit"]);
const INTERACTION_TYPES = ["pointerover", "pointerenter", "pointerdown", "mousedown", "pointerup", "mouseup", "click", "focus", "blur", "keydown", "keypress", "keyup", "beforeinput", "input", "paste"];
const INTERACTION_POINTER_TYPES = new Set(["pointerover", "pointerenter", "pointerdown", "mousedown", "pointerup", "mouseup", "click"]);
const INTERACTION_KEY_TYPES = new Set(["keydown", "keypress", "keyup", "beforeinput", "input", "paste"]);
const PREMOVE_WINDOW_MS = 1000;
const MAX_INTERACTION_EVENTS = 400;

export function setupEventCapture(state) {
  const record = (type, detail = {}) => {
    state.events.push({ type, t: Math.round(performance.now() - state.startedAt), ...detail });
    if (state.events.length > 700) state.events.shift();
  };

  const pointerHandler = (event) => {
    if (event.type === "pointermove") recordPointerTrail(state, event);
    const now = performance.now();
    if (event.type === "pointermove" && now - state.lastPointerSampleAt < 60) return;
    state.lastPointerSampleAt = now;
    record(event.type, {
      ...inputContext(event),
      x: Math.round(event.clientX),
      y: Math.round(event.clientY),
      pointerType: event.pointerType,
      buttons: event.buttons,
      pressure: event.pressure
    });
  };

  ["pointermove", "pointerdown", "pointerup", "click"].forEach((type) => {
    window.addEventListener(type, pointerHandler, { passive: true });
  });
  window.addEventListener("keydown", (event) => record("keydown", { ...inputContext(event), code: event.code, repeat: event.repeat }), { passive: true });
  window.addEventListener("scroll", () => record("scroll", { x: Math.round(window.scrollX), y: Math.round(window.scrollY) }), { passive: true });
  window.addEventListener("focus", () => record("focus"));
  window.addEventListener("blur", () => record("blur"));
  document.addEventListener("visibilitychange", () => record("visibilitychange", { visibilityState: document.visibilityState }));

  // Capture phase, so focus and pointerenter (which do not bubble) are seen too.
  INTERACTION_TYPES.forEach((type) => {
    document.addEventListener(type, (event) => recordInteraction(state, event), { capture: true, passive: true });
  });
}

function inputContext(event) {
  return { isTrusted: event.isTrusted, hidden: document.hidden, hasFocus: document.hasFocus() };
}

// Keeps only the step length of each pointer move from the last 1 s. No coordinates are kept,
// so the window can answer "how far did the pointer travel before this press" without storing the path.
function recordPointerTrail(state, event) {
  const interaction = state.interaction;
  const t = Math.round(performance.now() - state.startedAt);
  const last = interaction.lastMove;
  interaction.trail.push({
    t,
    isTrusted: event.isTrusted,
    pointerType: event.pointerType,
    coalesced: event.getCoalescedEvents?.().length ?? 0,
    step: last ? Math.hypot(event.clientX - last.x, event.clientY - last.y) : 0
  });
  interaction.lastMove = { x: event.clientX, y: event.clientY };
  while (interaction.trail.length && interaction.trail[0].t < t - PREMOVE_WINDOW_MS) interaction.trail.shift();
}

function recordInteraction(state, event) {
  const interaction = state.interaction;
  if (interaction.endMs !== null) return;
  const element = event.target instanceof Element ? event.target.closest("[data-tells-target]") : null;
  const target = INTERACTION_TARGETS.has(element?.dataset.tellsTarget) ? element.dataset.tellsTarget : null;
  if (!target) return;
  // Keys and text count only once the test has started; the pointer on the buttons counts from page load.
  if (INTERACTION_KEY_TYPES.has(event.type) && interaction.startMs === null) return;

  const t = Math.round(performance.now() - state.startedAt);
  const record = { type: event.type, t, target, isTrusted: event.isTrusted, hidden: document.hidden, hasFocus: document.hasFocus() };
  if (INTERACTION_POINTER_TYPES.has(event.type)) {
    const rect = element.getBoundingClientRect();
    record.dx = roundOne(event.clientX - (rect.left + rect.width / 2));
    record.dy = roundOne(event.clientY - (rect.top + rect.height / 2));
    record.screenDx = event.screenX - event.clientX;
    record.screenDy = event.screenY - event.clientY;
  }
  if (event.type === "click") record.detail = event.detail;
  if (event.type === "pointerdown") Object.assign(record, pressPremove(interaction, event.pointerType, t));
  if (event.type === "keydown" || event.type === "keypress" || event.type === "keyup") {
    record.keyClass = keyClass(event.key);
    record.repeat = event.repeat === true;
  }
  if (event.type === "beforeinput" || event.type === "input") record.inputType = typeof event.inputType === "string" ? event.inputType : "";

  interaction.events.push(record);
  if (interaction.events.length > MAX_INTERACTION_EVENTS) interaction.events.shift();
}

function pressPremove(interaction, pointerType, t) {
  const samples = interaction.trail.filter((sample) => sample.t >= t - PREMOVE_WINDOW_MS && sample.pointerType === pointerType);
  const trusted = samples.filter((sample) => sample.isTrusted).map((sample) => sample.coalesced);
  return {
    pointerType,
    premoveSamples: samples.length,
    premovePathPx: roundOne(samples.reduce((sum, sample) => sum + sample.step, 0)),
    coalescedMin: trusted.length ? Math.min(...trusted) : null
  };
}

// Only the class of a key is kept: printable, space or control. The key itself is never stored.
function keyClass(key) {
  if (key === " ") return "space";
  return typeof key === "string" && key.length === 1 ? "printable" : "control";
}

function roundOne(value) {
  return Math.round(value * 10) / 10;
}

export function setupRafProbe(state) {
  let last = performance.now();
  const loop = (timestamp) => {
    state.rafSamples.push(timestamp - last);
    if (state.rafSamples.length > 240) state.rafSamples.shift();
    last = timestamp;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

export function setupPerformanceProbe(state, onSample = null) {
  const record = () => {
    const sample = collectPerformanceMemorySnapshot(performance.now() - state.startedAt);
    if (!sample.supported) return;
    state.performanceSamples.push(sample);
    if (state.performanceSamples.length > 100) state.performanceSamples.shift();
    if (onSample) onSample(buildPerformanceMemorySurface(state));
  };

  record();
  window.setInterval(record, 500);
}

export function setupSensorProbe(state) {
  const pushSample = (name, sample) => {
    const bucket = state.sensorSamples[name];
    if (!bucket) return;
    bucket.push({ t: Math.round(performance.now() - state.startedAt), ...sample });
    if (bucket.length > 40) bucket.shift();
  };

  window.addEventListener("deviceorientation", (event) => {
    pushSample("orientation", {
      alpha: roundSensorValue(event.alpha),
      beta: roundSensorValue(event.beta),
      gamma: roundSensorValue(event.gamma),
      absolute: event.absolute === true
    });
  }, { passive: true });

  window.addEventListener("devicemotion", (event) => {
    pushSample("motion", {
      x: roundSensorValue(event.acceleration?.x),
      y: roundSensorValue(event.acceleration?.y),
      z: roundSensorValue(event.acceleration?.z),
      interval: roundSensorValue(event.interval)
    });
  }, { passive: true });
}

export function computeBehavior(state, now = performance.now()) {
  const elapsedMs = now - state.startedAt;
  const counts = {};
  for (const event of state.events) counts[event.type] = (counts[event.type] || 0) + 1;

  const pointerMoves = state.events.filter((event) => event.type === "pointermove");
  let pointerDistance = 0;
  const speeds = [];
  for (let i = 1; i < pointerMoves.length; i += 1) {
    const prev = pointerMoves[i - 1];
    const curr = pointerMoves[i];
    const distance = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    pointerDistance += distance;
    const dt = Math.max(1, curr.t - prev.t);
    speeds.push(distance / dt);
  }

  const rafStdDev = standardDeviation(state.rafSamples.slice(-120));
  const speedStdDev = standardDeviation(speeds);
  let score = 0.12;
  if (elapsedMs > 1200) score += 0.08;
  if (elapsedMs > 4000) score += 0.08;
  if (pointerMoves.length >= 5) score += 0.17;
  if (pointerDistance > 120) score += 0.16;
  if (speedStdDev > 0.02) score += 0.10;
  if ((counts.click || 0) > 0 || (counts.pointerdown || 0) > 0) score += 0.10;
  if ((counts.keydown || 0) > 0) score += 0.08;
  if ((counts.scroll || 0) > 0) score += 0.08;
  if (rafStdDev > 0.3) score += 0.05;
  if (state.challenge.completed) score += 0.16;
  if (elapsedMs > 3500 && Object.keys(counts).length === 0) score = 0.03;

  score = Math.max(0, Math.min(1, score));
  return {
    score: Math.round(score * 1000) / 1000,
    checkpointsMs: BEHAVIOR_CHECKPOINTS_MS,
    summary: {
      elapsedMs: Math.round(elapsedMs),
      eventCounts: counts,
      pointerMoveSamples: pointerMoves.length,
      pointerDistance: Math.round(pointerDistance),
      pointerSpeedStdDev: Math.round(speedStdDev * 10000) / 10000,
      rafStdDev: Math.round(rafStdDev * 1000) / 1000,
      challengeCompleted: state.challenge.completed
    },
    recentEvents: state.events.slice(-30)
  };
}

function roundSensorValue(value) {
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
}
