import { afterEach, describe, expect, it } from "vitest";
import { createInitialState } from "../public/state.js";
import { buildInteractionReport } from "../public/collect-interaction.js";
import { collectTells, summarizeInput } from "../public/collect-tells.js";
import { computeBehavior, discardSubmitAttempt, inputEvents, pressPremove, setupEventCapture } from "../public/runtime.js";
import { validateInteractionReport } from "../public/generated/validate-interaction-report.js";
import { scoreReport, withValidInteraction } from "../src/report-verdict.js";

function makeState(overrides = {}) {
  return {
    startedAt: 0,
    events: [],
    rafSamples: [],
    interaction: { startMs: null, report: null },
    ...overrides
  };
}

describe("computeBehavior", () => {
  it("keeps long idle sessions low confidence", () => {
    const behavior = computeBehavior(makeState(), 5000);

    expect(behavior.score).toBe(0.03);
    expect(behavior.summary).toMatchObject({
      elapsedMs: 5000,
      eventCounts: {},
      pointerMoveSamples: 0,
      pointerDistance: 0
    });
    expect(behavior.summary).not.toHaveProperty("challengeCompleted");
  });

  it("scores varied interaction evidence higher", () => {
    const state = makeState({
      events: [
        { type: "pointermove", t: 100, x: 0, y: 0 },
        { type: "pointermove", t: 180, x: 20, y: 0 },
        { type: "pointermove", t: 260, x: 65, y: 30 },
        { type: "pointermove", t: 360, x: 130, y: 35 },
        { type: "pointermove", t: 480, x: 190, y: 80 },
        { type: "click", t: 560 },
        { type: "keydown", t: 620 },
        { type: "scroll", t: 740 }
      ],
      rafSamples: [16, 17, 18, 22, 14],
      interaction: { startMs: 50, report: { task: { completed: true } } }
    });

    const behavior = computeBehavior(state, 5000);

    expect(behavior.score).toBeGreaterThan(0.8);
    expect(behavior.summary.eventCounts).toEqual({
      pointermove: 5,
      click: 1,
      keydown: 1,
      scroll: 1
    });
    expect(behavior.summary.pointerDistance).toBeGreaterThan(190);
  });

  it("adds the interaction score for a completed test, and leaves the summary without a completion flag", () => {
    // Only a keydown and time passed, so the score sits well below 1 and the 0.16 is not clipped.
    const events = [{ type: "keydown", t: 620 }];
    const open = computeBehavior(makeState({ events }), 5000);
    const completed = computeBehavior(makeState({ events, interaction: { startMs: 50, report: { task: { completed: true } } } }), 5000);

    expect(completed.score - open.score).toBeCloseTo(0.16, 2);
    expect(completed.summary).not.toHaveProperty("challengeCompleted");
  });

  it("returns only the most recent thirty events", () => {
    const events = Array.from({ length: 35 }, (_, index) => ({ type: "click", t: index }));
    const behavior = computeBehavior(makeState({ events }), 1000);

    expect(behavior.recentEvents).toHaveLength(30);
    expect(behavior.recentEvents[0].t).toBe(5);
  });
});

describe("pressPremove", () => {
  // The pressed button: 100 px wide and 40 px tall, at (500, 300).
  const rect = { left: 500, right: 600, top: 300, bottom: 340 };
  const sample = (t, clientX, clientY, extra = {}) => ({ t, clientX, clientY, isTrusted: true, pointerType: "mouse", coalesced: 1, step: 10, ...extra });
  const press = (trail, pointerType = "mouse") => pressPremove({ trail }, pointerType, 1000, rect);

  it("counts moves near the pressed element and moves getting closer to it, not moves far away or moving away", () => {
    const result = press([
      sample(800, 100, 320, { step: 5 }), // 400 px away, first move: left out
      sample(850, 50, 320, { step: 7 }), // 450 px away and moving away: left out
      sample(900, 400, 320, { step: 350 }), // 100 px away: near
      sample(950, 450, 320, { step: 50 }), // 50 px away: near and closer
      sample(980, 550, 320, { step: 100 }) // inside the button: 0 px away
    ]);
    expect(result).toMatchObject({ pointerType: "mouse", premoveSamples: 3, premovePathPx: 500 });
  });

  it("counts a move that is closer than the one before, even when still far away", () => {
    const result = press([sample(900, 100, 320, { step: 4 }), sample(950, 200, 320, { step: 6 })]);
    expect(result).toMatchObject({ premoveSamples: 1, premovePathPx: 6 });
  });

  it("takes the smallest coalesced count from counted trusted moves only", () => {
    const result = press([
      sample(850, 50, 320, { coalesced: 0 }), // far and moving away: not counted
      sample(900, 400, 320, { coalesced: 3 }), // counted
      sample(950, 450, 320, { coalesced: 2, isTrusted: false }) // counted, but script-made
    ]);
    expect(result.coalescedMin).toBe(3);
  });

  it("reports nothing when no move counts", () => {
    expect(press([sample(850, 50, 320, { coalesced: 0 })])).toMatchObject({ premoveSamples: 0, premovePathPx: 0, coalescedMin: null });
  });

  it("ignores moves from another pointer type and moves older than one second", () => {
    expect(press([sample(-50, 400, 320), sample(900, 400, 320, { pointerType: "touch" })])).toMatchObject({ premoveSamples: 0 });
  });
});

describe("discardSubmitAttempt", () => {
  // The events one Submit press leaves in the buffer, from pointerdown through the click.
  const submitPress = (t) => [
    { type: "pointerdown", t, target: "submit", isTrusted: true },
    { type: "mousedown", t, target: "submit", isTrusted: true },
    { type: "pointerup", t: t + 80, target: "submit", isTrusted: true },
    { type: "mouseup", t: t + 80, target: "submit", isTrusted: true },
    { type: "click", t: t + 80, target: "submit", isTrusted: true, detail: 1 }
  ];
  const startClick = [
    { type: "pointerdown", t: 10, target: "start", isTrusted: true },
    { type: "click", t: 90, target: "start", isTrusted: true, detail: 1 }
  ];
  const phraseTyping = [
    { type: "keydown", t: 200, target: "phrase", keyClass: "printable", repeat: false },
    { type: "input", t: 201, target: "phrase", inputType: "insertText" }
  ];

  it("removes the Submit events of a rejected attempt and keeps everything before it", () => {
    const state = makeState({ interaction: { startMs: 0, report: null, events: [...startClick, ...phraseTyping, ...submitPress(300)] } });

    discardSubmitAttempt(state);

    expect(state.interaction.events).toEqual([...startClick, ...phraseTyping]);
  });

  it("keeps the final Submit click chain and the buffer under the cap after many rejected Submits", () => {
    const state = makeState({ interaction: { startMs: 0, report: null, events: [...startClick, ...phraseTyping] } });
    for (let attempt = 0; attempt < 100; attempt += 1) {
      state.interaction.events.push(...submitPress(300 + attempt * 500));
      discardSubmitAttempt(state);
    }

    const correct = submitPress(60000);
    state.interaction.events.push(...correct);

    expect(state.interaction.events.length).toBeLessThan(400);
    expect(state.interaction.events.slice(-correct.length)).toEqual(correct);
    expect(state.interaction.events.filter((event) => event.target === "submit")).toEqual(correct);
  });

  it("removes a keyboard Submit attempt that starts with keydown", () => {
    const keyboardPress = [
      { type: "keydown", t: 400, target: "submit", keyClass: "control", repeat: false },
      { type: "keyup", t: 420, target: "submit", keyClass: "control", repeat: false },
      { type: "click", t: 421, target: "submit", isTrusted: true, detail: 0 }
    ];
    const state = makeState({ interaction: { startMs: 0, report: null, events: [...startClick, ...keyboardPress] } });

    discardSubmitAttempt(state);

    expect(state.interaction.events).toEqual(startClick);
  });
});

// setupEventCapture listens on window and document. These tests stand in for both with plain objects,
// and call the listeners directly with the events they need, in the browser's order: the document
// capture listener first, then the window listener once the event bubbles up.
class FakeElement {
  constructor(target) {
    this.dataset = { tellsTarget: target };
  }

  closest() {
    return this;
  }

  getBoundingClientRect() {
    return { left: 0, top: 0, right: 100, bottom: 40, width: 100, height: 40 };
  }
}

const NON_BUBBLING_TYPES = new Set(["focus", "pointerenter"]);

function pageWithCapture() {
  const listeners = {};
  const windowListeners = {};
  globalThis.window = { addEventListener: (type, handler) => { windowListeners[type] = handler; }, scrollX: 0, scrollY: 0 };
  globalThis.document = { addEventListener: (type, handler) => { listeners[type] = handler; }, hidden: false, hasFocus: () => true };
  globalThis.Element = FakeElement;
  const state = createInitialState({ now: () => 0 });
  setupEventCapture(state);
  const dispatch = (type, target, extra = {}) => {
    const event = { type, target: new FakeElement(target), isTrusted: true, bubbles: !NON_BUBBLING_TYPES.has(type), ...extra };
    listeners[type]?.(event);
    if (event.bubbles) windowListeners[type]?.(event);
  };
  return { state, dispatch };
}

describe("recordInteraction", () => {
  afterEach(() => {
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.Element;
  });

  it("records Enter or Space on Start before the test starts, for keyboard activation only", () => {
    const { state, dispatch } = pageWithCapture();
    dispatch("keydown", "start", { key: "Enter", code: "Enter", repeat: false });
    dispatch("keyup", "start", { key: " ", code: "Space", repeat: false });
    dispatch("keydown", "start", { key: "a", code: "KeyA", repeat: false });
    dispatch("keydown", "phrase", { key: "a", code: "KeyA", repeat: false });

    expect(state.interaction.events.map((event) => [event.type, event.target, event.keyClass])).toEqual([
      ["keydown", "start", "enter"],
      ["keyup", "start", "space"]
    ]);
  });

  it("builds a keyboard-only run into keyboard activations that pass every check that does not need a pointer", () => {
    const { state, dispatch } = pageWithCapture();
    // Tab to Start, Enter: the page records the focus, the key and the click before challenge.js sets startMs.
    dispatch("focus", "start");
    dispatch("keydown", "start", { key: "Enter", repeat: false });
    dispatch("click", "start", { detail: 0, clientX: 0, clientY: 0, screenX: 0, screenY: 0 });
    state.interaction.startMs = 1;
    // Tab to the phrase field and type one key, then Tab to Submit and press Space.
    dispatch("keydown", "phrase", { key: "t", repeat: false });
    dispatch("keyup", "phrase", { key: "t", repeat: false });
    dispatch("keydown", "submit", { key: " ", repeat: false });
    dispatch("keyup", "submit", { key: " ", repeat: false });
    dispatch("click", "submit", { detail: 0, clientX: 0, clientY: 0, screenX: 0, screenY: 0 });

    const report = buildInteractionReport(state.interaction.events, { startMs: 1, endMs: 1e9, completed: true, valueMatches: false, valueSetterNative: true, fullscreen: false });
    expect(validateInteractionReport(report), JSON.stringify(validateInteractionReport.errors)).toBe(true);
    expect(report.click.clicks.map((click) => [click.target, click.activation, click.offsetFromCentre])).toEqual([
      ["start", "keyboard", null],
      ["submit", "keyboard", null]
    ]);
    const statuses = Object.fromEntries(report.checks.map((check) => [check.id, check.status]));
    expect(statuses.int_click_chain).toBe("pass");
    expect(statuses.int_click_detail).toBe("na");
    expect(statuses.int_centre).toBe("na");
    expect(statuses.int_press).toBe("na");
  });

  it("records a Ctrl+V or Cmd+V paste as a shortcut, not a typed key, so dwell and the key chain are not judged", () => {
    for (const modifier of [{ key: "Control", flag: "ctrlKey", keyup: true }, { key: "Meta", flag: "metaKey", keyup: false }]) {
      const { state, dispatch } = pageWithCapture();
      state.interaction.startMs = 1;
      dispatch("keydown", "phrase", { key: modifier.key, repeat: false, [modifier.flag]: true });
      dispatch("keydown", "phrase", { key: "v", repeat: false, [modifier.flag]: true });
      dispatch("paste", "phrase");
      dispatch("beforeinput", "phrase", { inputType: "insertFromPaste" });
      dispatch("input", "phrase", { inputType: "insertFromPaste" });
      // macOS sends no keyup for a key pressed while Cmd is held.
      if (modifier.keyup) dispatch("keyup", "phrase", { key: "v", repeat: false, [modifier.flag]: true });
      dispatch("keyup", "phrase", { key: modifier.key, repeat: false });

      const report = buildInteractionReport(state.interaction.events, { startMs: 1, endMs: 1e9, completed: true, valueMatches: true, valueSetterNative: true, fullscreen: false });
      expect(report.typing.counts, modifier.key).toMatchObject({ keydown: 0, keyup: 0, paste: 1 });
      const statuses = Object.fromEntries(report.checks.map((check) => [check.id, check.status]));
      expect(statuses.int_dwell, modifier.key).toBe("na");
      expect(statuses.int_key_chain, modifier.key).toBe("na");
    }
  });

  it("does not count the keyup of a shortcut whose modifier was released first, and still counts a typed key after it", () => {
    const { state, dispatch } = pageWithCapture();
    state.interaction.startMs = 1;
    dispatch("keydown", "phrase", { key: "Control", code: "ControlLeft", repeat: false, ctrlKey: true });
    dispatch("keydown", "phrase", { key: "v", code: "KeyV", repeat: false, ctrlKey: true });
    dispatch("paste", "phrase");
    dispatch("beforeinput", "phrase", { inputType: "insertFromPaste" });
    dispatch("input", "phrase", { inputType: "insertFromPaste" });
    dispatch("keyup", "phrase", { key: "Control", code: "ControlLeft", repeat: false });
    dispatch("keyup", "phrase", { key: "v", code: "KeyV", repeat: false });

    const report = () => buildInteractionReport(state.interaction.events, { startMs: 1, endMs: 1e9, completed: true, valueMatches: true, valueSetterNative: true, fullscreen: false });
    expect(report().typing.counts).toMatchObject({ keydown: 0, keyup: 0, paste: 1 });

    dispatch("keydown", "phrase", { key: "v", code: "KeyV", repeat: false });
    dispatch("keyup", "phrase", { key: "v", code: "KeyV", repeat: false });
    expect(report().typing.counts).toMatchObject({ keydown: 1, keyup: 1 });
  });

  it("counts the keyup of a typed key that is still held when a modifier goes down", () => {
    const { state, dispatch } = pageWithCapture();
    state.interaction.startMs = 1;
    dispatch("keydown", "phrase", { key: "t", code: "KeyT", repeat: false });
    dispatch("keydown", "phrase", { key: "Control", code: "ControlLeft", repeat: false, ctrlKey: true });
    dispatch("keyup", "phrase", { key: "t", code: "KeyT", repeat: false, ctrlKey: true });
    dispatch("keyup", "phrase", { key: "Control", code: "ControlLeft", repeat: false });

    const report = buildInteractionReport(state.interaction.events, { startMs: 1, endMs: 1e9, completed: true, valueMatches: false, valueSetterNative: true, fullscreen: false });
    expect(report.typing.counts).toMatchObject({ keydown: 1, keyup: 1 });
    expect(report.typing.dwellMs).toMatchObject({ n: 1 });
  });

  it("records a character typed with AltGr as a typed key, though AltGr sets ctrlKey and altKey, and Ctrl or Alt with a key as a shortcut", () => {
    const { state, dispatch } = pageWithCapture();
    state.interaction.startMs = 1;
    const altGr = { ctrlKey: true, altKey: true, getModifierState: (name) => name === "AltGraph" };
    dispatch("keydown", "phrase", { key: "@", repeat: false, ...altGr });
    dispatch("keydown", "phrase", { key: "a", repeat: false, ctrlKey: true });
    dispatch("keydown", "phrase", { key: "a", repeat: false, altKey: true });

    expect(state.interaction.events.map((event) => event.keyClass)).toEqual(["printable", "control", "control"]);
  });

  it("counts an event it has to drop when the buffer is full and nothing can be evicted", () => {
    const { state, dispatch } = pageWithCapture();
    state.interaction.startMs = 0;
    for (let index = 0; index < 400; index += 1) dispatch("click", "submit", { detail: 1, clientX: 0, clientY: 0, screenX: 0, screenY: 0 });
    dispatch("keydown", "phrase", { key: "a", repeat: false });

    expect(state.interaction.events).toHaveLength(400);
    expect(state.interaction.dropped).toBe(1);
  });

  it("never evicts a key or text event: with no hover to drop, the new event is dropped and counted", () => {
    const { state, dispatch } = pageWithCapture();
    state.interaction.startMs = 0;
    for (let index = 0; index < 200; index += 1) {
      dispatch("keydown", "phrase", { key: "a", repeat: false });
      dispatch("keyup", "phrase", { key: "a", repeat: false });
    }
    const first = state.interaction.events[0];
    dispatch("keydown", "phrase", { key: "b", repeat: false });

    expect(state.interaction.events).toHaveLength(400);
    expect(state.interaction.events[0]).toBe(first);
    expect(state.interaction.dropped).toBe(1);
  });

  it("evicts an older hover to make room, so nothing is counted as dropped", () => {
    const { state, dispatch } = pageWithCapture();
    state.interaction.startMs = 0;
    dispatch("pointerover", "submit", { pointerType: "mouse", clientX: 0, clientY: 0, screenX: 0, screenY: 0 });
    for (let index = 0; index < 399; index += 1) dispatch("click", "submit", { detail: 1, clientX: 0, clientY: 0, screenX: 0, screenY: 0 });
    dispatch("click", "submit", { detail: 1, clientX: 0, clientY: 0, screenX: 0, screenY: 0 });

    expect(state.interaction.events).toHaveLength(400);
    expect(state.interaction.events.some((event) => event.type === "pointerover")).toBe(false);
    expect(state.interaction.dropped).toBe(0);
  });
});

describe("inputEvents", () => {
  afterEach(() => {
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.Element;
  });

  const press = { pointerType: "mouse", clientX: 50, clientY: 20, screenX: 50, screenY: 104, buttons: 1, pressure: 0.5 };
  const server = { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36" };

  it("feeds untrusted input seen only by the interaction test into tells.input, so synthetic_input scores and int_trusted adds no penalty", () => {
    const { state, dispatch } = pageWithCapture();
    dispatch("click", "start", { ...press, detail: 1 });
    state.interaction.startMs = 1;
    // A script types into the phrase field: beforeinput, input and paste reach the document listeners only.
    dispatch("beforeinput", "phrase", { isTrusted: false, inputType: "insertText" });
    dispatch("input", "phrase", { isTrusted: false, inputType: "insertText" });
    dispatch("paste", "phrase", { isTrusted: false });

    expect(summarizeInput(state.events).untrusted).toBe(0);
    const tells = collectTells(state);
    expect(tells.input).toEqual({ count: 4, untrusted: 3, trustedWhileHidden: 0, trustedWithoutFocus: 0 });

    const interaction = buildInteractionReport(state.interaction.events, { startMs: 1, endMs: 1e9, completed: true, valueMatches: true, valueSetterNative: true, fullscreen: false });
    const client = { tells, interaction };
    const ids = scoreReport({ server, client }).reasons.map((reason) => reason.id);
    expect(ids).toContain("synthetic_input");
    expect(ids).not.toContain("int_trusted");
    expect(withValidInteraction(client).interaction.checks.find((check) => check.id === "int_trusted").status).toBe("fail");
  });

  it("counts trusted input seen only by the interaction test while the page is hidden or unfocused", () => {
    const { state, dispatch } = pageWithCapture();
    state.interaction.startMs = 1;
    document.hidden = true;
    dispatch("paste", "phrase");
    document.hidden = false;
    document.hasFocus = () => false;
    dispatch("input", "phrase", { inputType: "insertFromPaste" });

    expect(state.events).toEqual([]);
    expect(collectTells(state).input).toEqual({ count: 2, untrusted: 0, trustedWhileHidden: 1, trustedWithoutFocus: 1 });
    // The report keeps its shape: hidden and hasFocus stay in the page.
    const report = buildInteractionReport(state.interaction.events, { startMs: 1, endMs: 1e9, completed: false, valueMatches: false, valueSetterNative: true, fullscreen: false });
    expect(validateInteractionReport(report), JSON.stringify(validateInteractionReport.errors)).toBe(true);
    expect(JSON.stringify(report)).not.toMatch(/hidden|hasFocus/);
  });

  it("does not count trusted hovers on an unfocused or hidden page as input without focus or while hidden", () => {
    const { state, dispatch } = pageWithCapture();
    document.hasFocus = () => false;
    document.hidden = true;
    dispatch("pointerover", "submit", press);
    dispatch("pointerenter", "submit", press);
    dispatch("pointerover", "start", { ...press, isTrusted: false });

    expect(collectTells(state).input).toEqual({ count: 3, untrusted: 1, trustedWhileHidden: 0, trustedWithoutFocus: 0 });
    expect(state.interaction.events.every((event) => !("hidden" in event) && !("hasFocus" in event))).toBe(true);
  });

  it("counts a trusted event that reaches both buffers once", () => {
    const { state, dispatch } = pageWithCapture();
    dispatch("pointerdown", "start", press);

    expect(state.events.map((event) => event.type)).toEqual(["pointerdown"]);
    expect(state.interaction.events.map((event) => event.type)).toEqual(["pointerdown"]);
    expect(inputEvents(state)).toEqual(state.events);
    expect(summarizeInput(inputEvents(state))).toEqual({ count: 1, untrusted: 0, trustedWhileHidden: 0, trustedWithoutFocus: 0 });
  });

  it("counts the interaction copy when the state log never had one or has shifted it out", () => {
    const { state, dispatch } = pageWithCapture();
    dispatch("pointerdown", "start", press);
    // A script's dispatchEvent without bubbles: true never reaches the window listener.
    state.interaction.startMs = 1;
    dispatch("keydown", "phrase", { isTrusted: false, bubbles: false, key: "t", repeat: false });
    expect(summarizeInput(inputEvents(state))).toMatchObject({ count: 2, untrusted: 1 });

    // 700 keydowns outside the test's targets push the pointerdown out of the state log; its interaction copy stays.
    for (let index = 0; index < 700; index += 1) dispatch("keydown", "elsewhere", { code: "KeyA", repeat: false });
    expect(state.events.some((event) => event.type === "pointerdown")).toBe(false);
    expect(summarizeInput(inputEvents(state))).toMatchObject({ count: 702, untrusted: 1 });
  });
});
