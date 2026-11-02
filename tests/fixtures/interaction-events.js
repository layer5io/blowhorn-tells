// Recorded event fixtures for the interaction test, in the shape runtime.js captures.
// Each family returns { events, task } exactly as the page would hand them to buildInteractionReport.
// Times are milliseconds from page start. Jitter comes from a seeded generator, so runs are repeatable.

import { INTERACTION_PHRASE as PHRASE } from "../../public/collect-interaction.js";

const START_MS = 2000;

function seeded(seed) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

function between(random, min, max) {
  return min + random() * (max - min);
}

// One button press: optional pointerover, pointerdown, mousedown, focus, pointerup, mouseup, click.
// A touch tap fires its compatibility mouse events together after pointerup, as browsers do.
export function clickEvents({
  target = "start",
  t,
  trusted = true,
  pointerType = "mouse",
  detail = 1,
  dx = 0,
  dy = 0,
  screenDx = 0,
  screenDy = 0,
  pressMs = 110,
  premove = { samples: 0, pathPx: 0, coalescedMin: null },
  pointerEvents = true
}) {
  const base = (type, offset, extra = {}) => ({ type, t: t + offset, target, isTrusted: trusted, ...extra });
  const position = { dx, dy, screenDx, screenDy };
  const events = [];
  if (pointerEvents) {
    events.push(base("pointerover", -60, { ...position, pointerType }));
    events.push(base("pointerdown", 0, { ...position, pointerType, detail: 1, premoveSamples: premove.samples, premovePathPx: premove.pathPx, coalescedMin: premove.coalescedMin }));
  }
  if (pointerEvents && pointerType === "touch") {
    events.push(base("pointerup", pressMs, { ...position, pointerType }));
    events.push(base("mousedown", pressMs, { ...position, detail: 1 }));
    events.push(base("focus", pressMs));
    events.push(base("mouseup", pressMs, { ...position, detail: 1 }));
  } else {
    if (pointerEvents) events.push(base("mousedown", 0, { ...position, detail: 1 }));
    events.push(base("focus", 0));
    if (pointerEvents) {
      events.push(base("pointerup", pressMs, { ...position, pointerType }));
      events.push(base("mouseup", pressMs, { ...position, detail: 1 }));
    }
  }
  events.push(base("click", pressMs + 1, { ...position, detail }));
  return events;
}

// One printable or space keystroke: keydown, keypress, beforeinput, input, keyup. With chain false,
// only keydown and keyup are dispatched, as a script that fires keyboard events by hand does.
function keystroke({ char, t, dwellMs, trusted = true, chain = true, inputType = "insertText" }) {
  const keyClass = char === " " ? "space" : "printable";
  const base = (type, time, extra = {}) => ({ type, t: time, target: "phrase", isTrusted: trusted, ...extra });
  const events = [base("keydown", t, { keyClass, repeat: false })];
  if (chain) {
    events.push(base("keypress", t, { keyClass }));
    events.push(base("beforeinput", t, { inputType }));
    events.push(base("input", t, { inputType }));
  }
  events.push(base("keyup", t + dwellMs, { keyClass, repeat: false }));
  return events;
}

// The phrase typed with per-key dwell and gap supplied by the caller.
function typedPhrase({ startT, dwell, gap, trusted = true, chain = true, inputType = "insertText" }) {
  const events = [];
  let t = startT;
  for (const char of PHRASE) {
    const dwellMs = dwell(char);
    events.push(...keystroke({ char, t, dwellMs, trusted, chain, inputType }));
    t += dwellMs + gap(char);
  }
  return { events, endT: t };
}

// The Submit click's time: the end of the task, as the page records it.
function lastClickT(events) {
  return events.filter((event) => event.type === "click").at(-1).t;
}

function task(events, overrides = {}) {
  return {
    startMs: START_MS,
    endMs: lastClickT(events),
    completed: true,
    valueMatches: true,
    valueSetterNative: true,
    fullscreen: false,
    phraseLength: PHRASE.length,
    ...overrides
  };
}

// A person: ghost-cursor-like moves before each press (samples and travel), 60 to 140 ms
// holds, and keys with jittered dwell and gaps. Every check should pass.
export function humanLike(seed = 7) {
  const random = seeded(seed);
  const start = clickEvents({
    t: START_MS,
    dx: 4.2,
    dy: -6.1,
    screenDx: 3,
    screenDy: 84,
    pressMs: 96,
    premove: { samples: 54, pathPx: 512, coalescedMin: 1 }
  });
  const phraseTap = clickEvents({ target: "phrase", t: START_MS + 900, dx: 1, dy: 2, screenDx: 3, screenDy: 84, pressMs: 80, premove: { samples: 30, pathPx: 210, coalescedMin: 1 } });
  const typed = typedPhrase({
    startT: START_MS + 1500,
    dwell: () => between(random, 60, 140),
    gap: () => between(random, 60, 260)
  });
  const submitT = typed.endT + 700;
  const submit = clickEvents({ target: "submit", t: submitT, dx: -12.4, dy: 5.2, screenDx: 3, screenDy: 84, pressMs: 118, premove: { samples: 43, pathPx: 650, coalescedMin: 1 } });
  const events = [...start, ...phraseTap, ...typed.events, ...submit];
  return { events, task: task(events, { valueMatches: true }) };
}

// script-made clicks and keys, plus a value assignment: el.click(), dispatchEvent of keyboard events,
// el.value = phrase. Every event is untrusted, and no press precedes any click.
export function scriptedElementClick() {
  const events = [
    { type: "click", t: START_MS, target: "start", isTrusted: false, detail: 0, dx: -113.6, dy: -604.4, screenDx: 0, screenDy: 0 }
  ];
  const typed = typedPhrase({ startT: START_MS + 2, dwell: () => 0, gap: () => 0, trusted: false, chain: false });
  events.push(...typed.events);
  events.push({ type: "click", t: START_MS + 30, target: "submit", isTrusted: false, detail: 1, dx: -123.1, dy: -800.7, screenDx: 0, screenDy: 0 });
  return { events, task: task(events, { valueMatches: true, valueSetterNative: true }) };
}

// Full synthetic chains: every press and key is dispatched with new MouseEvent and KeyboardEvent,
// so the chain order is right and the timing is zero. Only the isTrusted checks can tell it apart.
export function dispatchedChains() {
  const start = clickEvents({ t: START_MS, trusted: false, pointerType: "", dx: 0, dy: 0, screenDx: 0, screenDy: 0, pressMs: 0 });
  const typed = typedPhrase({ startT: START_MS + 2, dwell: () => 0, gap: () => 0, trusted: false });
  const submit = clickEvents({ target: "submit", t: START_MS + 40, trusted: false, pointerType: "", dx: 0, dy: 0, screenDx: 0, screenDy: 0, pressMs: 0 });
  const events = [...start, ...typed.events, ...submit];
  return { events, task: task(events, { valueMatches: true, valueSetterNative: true }) };
}

// A raw CDP press at the exact centre, with no mouseMoved before it. Chromium synthesizes one move,
// so premove counts one sample of no travel. Presses last 2 ms. Keys come as insertText.
export function cdpClickNoMoves() {
  const start = clickEvents({ t: START_MS, pressMs: 2, screenDx: 2, screenDy: 84, premove: { samples: 1, pathPx: 0, coalescedMin: 1 } });
  const submit = clickEvents({ target: "submit", t: START_MS + 2400, pressMs: 2, screenDx: 2, screenDy: 84, premove: { samples: 1, pathPx: 0, coalescedMin: 1 } });
  const text = [{ type: "beforeinput", t: START_MS + 1200, target: "phrase", isTrusted: true, inputType: "insertText" },
    { type: "input", t: START_MS + 1200, target: "phrase", isTrusted: true, inputType: "insertText" }];
  const events = [...start, ...text, ...submit];
  return { events, task: task(events, { valueMatches: true, valueSetterNative: true }) };
}

// A raw CDP insertText of the whole phrase: trusted text with no key presses at all.
export function cdpInsertText() {
  const start = clickEvents({ t: START_MS, pressMs: 80, screenDx: 2, screenDy: 84, premove: { samples: 40, pathPx: 300, coalescedMin: 1 } });
  const text = [{ type: "beforeinput", t: START_MS + 900, target: "phrase", isTrusted: true, inputType: "insertText" },
    { type: "input", t: START_MS + 900, target: "phrase", isTrusted: true, inputType: "insertText" }];
  const submit = clickEvents({ target: "submit", t: START_MS + 1500, pressMs: 80, screenDx: 2, screenDy: 84, premove: { samples: 40, pathPx: 300, coalescedMin: 1 } });
  const events = [...start, ...text, ...submit];
  return { events, task: task(events, { valueMatches: true, valueSetterNative: true }) };
}

// Trusted keys with exact timing, as a CDP per-key driver sends them: every key held 50 ms,
// one key every 100 ms. The keys are trusted, the rhythm is machine-perfect.
export function cdpPerKeyExactTiming() {
  const start = clickEvents({ t: START_MS, pressMs: 80, screenDx: 2, screenDy: 84, premove: { samples: 40, pathPx: 300, coalescedMin: 1 } });
  const typed = typedPhrase({ startT: START_MS + 500, dwell: () => 50, gap: () => 50 });
  const submit = clickEvents({ target: "submit", t: typed.endT + 300, pressMs: 80, screenDx: 2, screenDy: 84, premove: { samples: 40, pathPx: 300, coalescedMin: 1 } });
  const events = [...start, ...typed.events, ...submit];
  return { events, task: task(events, { valueMatches: true, valueSetterNative: true }) };
}
// A keyboard activation: focus, then Enter or Space on the button, then a click with detail 0 and no pointer
// events. Enter clicks on keydown; Space clicks on keyup. Trusted, as a real keyboard produces.
export function keyboardActivation({ target, t, key, trusted = true }) {
  const base = (type, time, extra = {}) => ({ type, t: time, target, isTrusted: trusted, ...extra });
  const keyClass = key === " " ? "space" : "enter";
  const events = [base("focus", t - 40), base("keydown", t, { keyClass, repeat: false })];
  if (keyClass === "space") events.push(base("keyup", t + 60, { keyClass, repeat: false }));
  events.push(base("click", keyClass === "space" ? t + 61 : t + 1, { detail: 0 }));
  return events;
}

// Start and Submit both activated from the keyboard, with the phrase typed in between. Every check that
// needs a pointer should be not judged, and the key checks should pass.
export function keyboardRun() {
  const start = keyboardActivation({ target: "start", t: START_MS, key: "Enter" });
  const typed = typedPhrase({ startT: START_MS + 900, dwell: () => 90, gap: () => 120 });
  const submit = keyboardActivation({ target: "submit", t: typed.endT + 700, key: " " });
  const events = [...start, ...typed.events, ...submit];
  return { events, task: task(events, { valueMatches: true, valueSetterNative: true }) };
}

export const FIXTURE_START_MS = START_MS;
