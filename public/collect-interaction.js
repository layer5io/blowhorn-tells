// Turns the events captured during the interaction test into the interaction report
// (schemas/interaction-report.schema.json). buildInteractionReport is pure: it reads events
// and returns numbers, never the DOM. The DOM is read only by readFieldFacts.

import { isNative, summarizeInput } from "./collect-tells.js";
import { evaluateInteractionChecks } from "./interaction-checks.js";
import { standardDeviation } from "./utils.js";

// The fixed phrase. It is never user text, so nothing typed is ever recorded.
export const INTERACTION_PHRASE = "tells check 42";

const MAX_CLICKS = 10;
const CHAIN_TYPES = new Set(["pointerover", "pointerenter", "pointerdown", "mousedown", "focus", "pointerup", "mouseup", "click"]);
const POINTER_TYPES = new Set(["mouse", "pen", "touch"]);
const PASTE_INPUT = "insertFromPaste";
const TYPED_KEY_CLASSES = new Set(["printable", "space"]);
// Keys that activate a button. Their keydown and keyup are not in the chain: they only mark the click as keyboard-made.
const ACTIVATION_KEY_CLASSES = new Set(["enter", "space"]);

export function buildInteractionReport(events, task) {
  const endMs = task.endMs ?? Infinity;
  const recorded = events.filter((event) => event.t <= endMs);
  const onPhrase = recorded.filter((event) => event.target === "phrase");
  const completed = task.completed === true && task.endMs != null && task.startMs != null;

  const report = {
    schemaVersion: 2,
    task: {
      phraseLength: task.phraseLength ?? INTERACTION_PHRASE.length,
      completed,
      durationMs: completed ? round1(task.endMs - task.startMs) : null,
      fullscreen: task.fullscreen === true
    },
    click: { clicks: buildClicks(recorded) },
    typing: buildTyping(onPhrase, summarizeInput(recorded).untrusted, task),
    checks: []
  };
  report.checks = evaluateInteractionChecks(report);
  return report;
}

// Reads the phrase field without keeping its value. Only two facts leave the page: whether the
// value equals the fixed phrase, and whether the value setter is still the native one.
export function readFieldFacts(field, phrase = INTERACTION_PHRASE) {
  const own = Object.getOwnPropertyDescriptor(field, "value");
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  return {
    valueMatches: field.value === phrase,
    valueSetterNative: own ? false : setter ? isNative(setter) : null
  };
}

// Groups the events on each button into one chain per click: everything since that button's
// previous click, ending with the click itself. Enter or Space on a button since its previous click
// is noted too, so a click with no press in its chain can be told apart as a keyboard activation.
function buildClicks(recorded) {
  const pending = { start: [], submit: [] };
  const keyActivated = { start: false, submit: false };
  const clicks = [];
  for (const event of recorded) {
    const buffer = pending[event.target];
    if (!buffer) continue;
    if ((event.type === "keydown" || event.type === "keyup") && ACTIVATION_KEY_CLASSES.has(event.keyClass)) {
      keyActivated[event.target] = true;
      continue;
    }
    if (!CHAIN_TYPES.has(event.type)) continue;
    buffer.push(event);
    if (event.type === "click") {
      clicks.push(describeClick(buffer, keyActivated[event.target]));
      buffer.length = 0;
      keyActivated[event.target] = false;
    }
  }
  return clicks.slice(-MAX_CLICKS);
}

// A click with no pointerdown or mousedown and an Enter or Space before it is a keyboard activation.
// Its pointer geometry is null: the event has no pointer position, and its coordinates are zero.
function describeClick(buffer, keyActivated) {
  const click = buffer[buffer.length - 1];
  const pointerDown = lastOfType(buffer, "pointerdown");
  const downIndex = lastIndexOfType(buffer, "mousedown");
  const upIndex = downIndex === -1 ? -1 : buffer.findIndex((event, index) => index > downIndex && event.type === "mouseup");
  const keyboard = keyActivated && pointerDown === undefined && downIndex === -1;
  const described = {
    target: click.target,
    isTrusted: click.isTrusted,
    activation: keyboard ? "keyboard" : "pointer",
    pointerType: pointerDown && POINTER_TYPES.has(pointerDown.pointerType) ? pointerDown.pointerType : "",
    chain: buffer.map((event) => event.type),
    detail: click.detail ?? 0,
    // Set on every pointer event on a task button (runtime.js), so both fields are always present for a pointer click.
    offsetFromCentre: keyboard ? null : { dx: click.dx, dy: click.dy },
    screenMinusClient: keyboard ? null : { dx: click.screenDx, dy: click.screenDy },
    pressMs: upIndex === -1 ? null : round1(buffer[upIndex].t - buffer[downIndex].t)
  };
  if (pointerDown) {
    // Movement before a press is measured in the page at press time (runtime.js), so only counts reach here.
    described.premoveSamples = pointerDown.premoveSamples;
    described.premovePathPx = pointerDown.premovePathPx;
    described.coalescedMin = pointerDown.coalescedMin;
  }
  return described;
}

function buildTyping(onPhrase, untrusted, task) {
  const counts = { keydown: 0, keypress: 0, beforeinput: 0, input: 0, keyup: 0, paste: 0 };
  const inputTypes = {};
  const keyDownTimes = [];
  const openKeys = [];
  const dwells = [];
  let keyPending = false;
  let inputWithoutKeydown = 0;

  for (const event of onPhrase) {
    const typed = TYPED_KEY_CLASSES.has(event.keyClass);
    switch (event.type) {
      case "keydown":
        if (typed && !event.repeat) {
          counts.keydown += 1;
          keyPending = true;
          keyDownTimes.push(event.t);
          openKeys.push(event.t);
        }
        break;
      case "keypress":
        if (typed) counts.keypress += 1;
        break;
      case "keyup":
        if (typed) {
          counts.keyup += 1;
          if (openKeys.length) dwells.push(event.t - openKeys.shift());
        }
        break;
      case "beforeinput":
        counts.beforeinput += 1;
        if (isTextInsert(event.inputType)) {
          // A typed character is preceded by its keydown; text that arrives alone (insertText) is not.
          if (keyPending) keyPending = false;
          else inputWithoutKeydown += 1;
        }
        break;
      case "input": {
        counts.input += 1;
        const type = event.inputType || "unknown";
        inputTypes[type] = (inputTypes[type] || 0) + 1;
        break;
      }
      case "paste":
        counts.paste += 1;
        break;
      default:
        break;
    }
  }

  return {
    counts,
    untrusted,
    inputTypes,
    inputWithoutKeydown,
    valueMatches: task.valueMatches === true,
    valueSetterNative: task.valueSetterNative ?? null,
    intervalMs: stats(keyDownTimes.slice(1).map((time, index) => time - keyDownTimes[index])),
    dwellMs: stats(dwells)
  };
}

function isTextInsert(inputType) {
  return typeof inputType === "string" && inputType.startsWith("insert") && inputType !== PASTE_INPUT;
}

function stats(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((sum, value) => sum + value, 0) / n;
  const middle = Math.floor(n / 2);
  const median = n % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  const stdDev = standardDeviation(values);
  return {
    n,
    mean: round1(mean),
    median: round1(median),
    stdDev: round3(stdDev),
    cv: mean > 0 ? round3(stdDev / mean) : 0,
    min: sorted[0]
  };
}

function lastIndexOfType(buffer, type) {
  for (let index = buffer.length - 1; index >= 0; index -= 1) {
    if (buffer[index].type === type) return index;
  }
  return -1;
}

function lastOfType(buffer, type) {
  const index = lastIndexOfType(buffer, type);
  return index === -1 ? undefined : buffer[index];
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}
