import { collectPerformanceMemorySnapshot, buildPerformanceMemorySurface } from "./performance-memory.js";
import { standardDeviation } from "./utils.js";

export const BEHAVIOR_CHECKPOINTS_MS = [1500, 4000, 7000, 10000, 15000];

// The interaction test's three buttons. Only events on these elements are recorded for it.
const INTERACTION_TARGETS = new Set(["start", "phrase", "submit"]);
const INTERACTION_TYPES = ["pointerover", "pointerenter", "pointerdown", "mousedown", "pointerup", "mouseup", "click", "focus", "keydown", "keypress", "keyup", "beforeinput", "input", "paste"];
const INTERACTION_POINTER_TYPES = new Set(["pointerover", "pointerenter", "pointerdown", "mousedown", "pointerup", "mouseup", "click"]);
const HOVER_TYPES = new Set(["pointerover", "pointerenter", "focus"]);
const INTERACTION_KEY_TYPES = new Set(["keydown", "keypress", "keyup", "beforeinput", "input", "paste"]);
// Keys that activate a button. collect-interaction.js uses them to mark a click as keyboard-made.
export const ACTIVATION_KEY_CLASSES = new Set(["enter", "space"]);
const PREMOVE_WINDOW_MS = 1000;
const PREMOVE_NEAR_PX = 200;
const MAX_INTERACTION_EVENTS = 400;
// pointerdown, pointerup, click and keydown on the test's targets that bubble up to window land in both
// state.events and state.interaction.events. These link the two records of one event, so inputEvents counts it once.
const interactionRecordOf = new WeakMap(); // Event -> its interaction record
const stateLogCopyOf = new WeakMap(); // interaction record -> the state.events entry for the same event

export function setupEventCapture(state) {
  const record = (type, detail = {}, event = null) => {
    const entry = { type, t: Math.round(performance.now() - state.startedAt), ...detail };
    state.events.push(entry);
    if (state.events.length > 700) state.events.shift();
    // recordInteraction listens on document in the capture phase, so it has already seen this event.
    const interactionRecord = event && interactionRecordOf.get(event);
    if (interactionRecord) stateLogCopyOf.set(interactionRecord, entry);
  };

  const pointerHandler = (event) => {
    if (event.type === "pointermove") {
      if (state.interaction.endMs === null) recordPointerTrail(state, event);
      else state.interaction.trail.length = 0;
    }
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
    }, event);
  };

  ["pointermove", "pointerdown", "pointerup", "click"].forEach((type) => {
    window.addEventListener(type, pointerHandler, { passive: true });
  });
  window.addEventListener("keydown", (event) => record("keydown", { ...inputContext(event), code: event.code, repeat: event.repeat }, event), { passive: true });
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

// Keeps each pointer move from the last 1 s in memory only: its client position, step length and
// coalesced count. The positions stay in the page. The report carries only counts and path length
// for the moves that count as premove (see pressPremove).
function recordPointerTrail(state, event) {
  const interaction = state.interaction;
  const t = Math.round(performance.now() - state.startedAt);
  const last = interaction.lastMove;
  interaction.trail.push({
    t,
    clientX: event.clientX,
    clientY: event.clientY,
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
  // The one exception is Enter or Space on Start, which is how a keyboard user starts the test; collect-interaction.js reads it only to tell the click apart.
  const activationKey = (event.type === "keydown" || event.type === "keyup") && ACTIVATION_KEY_CLASSES.has(keyClass(event));
  if (INTERACTION_KEY_TYPES.has(event.type) && interaction.startMs === null && !(target === "start" && activationKey)) return;
  // OS auto-repeat keydowns are ignored by buildTyping, so they are not recorded either; they would fill the buffer.
  if (event.type === "keydown" && event.repeat) return;
  // Once Start is armed, later clicks on it do nothing in challenge.js, so they are not recorded either.
  // The arming click's own pointer chain runs before challenge.js sets startMs, so it is still recorded.
  if (target === "start" && interaction.startMs !== null && INTERACTION_POINTER_TYPES.has(event.type)) return;
  if (interaction.events.length >= MAX_INTERACTION_EVENTS && !evictInteractionEvent(interaction.events)) {
    // Nothing left to evict: the event is lost, and challenge.js refuses to score a run that lost any.
    interaction.dropped += 1;
    return;
  }

  const t = Math.round(performance.now() - state.startedAt);
  // hidden and hasFocus feed tells.input through inputEvents; buildInteractionReport does not send them.
  const record = { type: event.type, t, target, ...inputContext(event) };
  if (INTERACTION_POINTER_TYPES.has(event.type)) {
    const rect = element.getBoundingClientRect();
    record.dx = roundOne(event.clientX - (rect.left + rect.width / 2));
    record.dy = roundOne(event.clientY - (rect.top + rect.height / 2));
    record.screenDx = event.screenX - event.clientX;
    record.screenDy = event.screenY - event.clientY;
  }
  if (event.type === "click") record.detail = event.detail;
  if (event.type === "pointerdown") Object.assign(record, pressPremove(interaction, event.pointerType, t, element.getBoundingClientRect()));
  if (event.type === "keydown" || event.type === "keypress" || event.type === "keyup") {
    record.keyClass = keyClass(event);
    record.repeat = event.repeat === true;
  }
  if (event.type === "beforeinput" || event.type === "input") record.inputType = typeof event.inputType === "string" ? event.inputType : "";

  interaction.events.push(record);
  interactionRecordOf.set(event, record);
}

// Every input event the page holds, each counted once: the state log, plus the interaction events it has no copy of.
// An interaction event has no state-log copy when its type is one the state log does not record (hovers, mousedown,
// keyup, beforeinput, input, paste), when it did not bubble to window (a script's dispatchEvent without
// bubbles: true), or when the state log has since shifted its copy out.
export function inputEvents(state) {
  const logged = new Set(state.events);
  return [...state.events, ...state.interaction.events.filter((event) => !logged.has(stateLogCopyOf.get(event)))];
}

// Over the cap, drop the oldest hover or focus event first so the Start click chain survives a flood of hovers.
// Then the oldest key or input event, so the Submit click chain survives heavy typing.
// Pointer press and click events are never evicted. With none to drop, returns false and the new event is dropped instead.
function evictInteractionEvent(events) {
  const index = events.findIndex((event) => HOVER_TYPES.has(event.type));
  const victim = index === -1 ? events.findIndex((event) => INTERACTION_KEY_TYPES.has(event.type)) : index;
  if (victim === -1) return false;
  events.splice(victim, 1);
  return true;
}

// Called when challenge.js rejects a Submit press, before Start, for a wrong phrase, or when the report
// fails validation. Removes that attempt's Submit events, from the pointerdown or keydown that started it
// to the end, so the rejected attempts do not fill the buffer and only the accepted Submit chain stays.
// Hovers before the press are left alone.
export function discardSubmitAttempt(state) {
  const events = state.interaction.events;
  let start = events.length;
  while (start > 0 && events[start - 1].target === "submit") {
    start -= 1;
    if (events[start].type === "pointerdown" || events[start].type === "keydown") break;
  }
  events.splice(start);
}

// Counts the moves before a press that show the pointer heading for the pressed element: a move
// within PREMOVE_NEAR_PX of it, or a move closer to it than the move before. Moves far away and
// moving away are left out, so pointer wander elsewhere on the page does not count as premove.
export function pressPremove(interaction, pointerType, t, rect) {
  const samples = interaction.trail.filter((sample) => sample.t >= t - PREMOVE_WINDOW_MS && sample.pointerType === pointerType);
  const counted = [];
  let previous = null;
  for (const sample of samples) {
    const distance = distanceToRect(sample.clientX, sample.clientY, rect);
    if (distance <= PREMOVE_NEAR_PX || (previous !== null && distance < previous)) counted.push(sample);
    previous = distance;
  }
  const trusted = counted.filter((sample) => sample.isTrusted).map((sample) => sample.coalesced);
  return {
    pointerType,
    premoveSamples: counted.length,
    premovePathPx: roundOne(counted.reduce((sum, sample) => sum + sample.step, 0)),
    coalescedMin: trusted.length ? Math.min(...trusted) : null
  };
}

// Distance from a point to a rect, 0 when the point is inside it.
function distanceToRect(x, y, rect) {
  const dx = Math.max(rect.left - x, 0, x - rect.right);
  const dy = Math.max(rect.top - y, 0, y - rect.bottom);
  return Math.hypot(dx, dy);
}

// Only the class of a key is kept: printable, space, enter or control. The key itself is never stored.
// A character pressed with Ctrl or Meta is a shortcut (Ctrl+V, Cmd+A), not typing. AltGr sets ctrlKey too, but types.
function keyClass(event) {
  const { key } = event;
  if (key === " ") return "space";
  if (key === "Enter") return "enter";
  if (typeof key !== "string" || key.length !== 1) return "control";
  const shortcut = (event.ctrlKey || event.metaKey) && !event.getModifierState?.("AltGraph");
  return shortcut ? "control" : "printable";
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
  if (interactionCompleted(state)) score += 0.16;
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
      rafStdDev: Math.round(rafStdDev * 1000) / 1000
    },
    recentEvents: state.events.slice(-30)
  };
}

// The interaction test counts as complete once its report says so. Used by the behavior score and the UI.
export function interactionCompleted(state) {
  return state.interaction.report?.task.completed === true;
}

function roundSensorValue(value) {
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
}
