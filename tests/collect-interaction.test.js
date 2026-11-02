import { describe, expect, it } from "vitest";
import { buildInteractionReport, INTERACTION_PHRASE } from "../public/collect-interaction.js";
import { INTERACTION_CHECK_IDS } from "../public/interaction-checks.js";
import { validateInteractionReport } from "../public/generated/validate-interaction-report.js";
import {
  clickEvents,
  cdpClickNoMoves,
  cdpInsertText,
  cdpPerKeyExactTiming,
  dispatchedChains,
  humanLike,
  FIXTURE_START_MS,
  keyboardActivation,
  keyboardRun,
  scriptedElementClick
} from "./fixtures/interaction-events.js";

const statusesOf = (report) => Object.fromEntries(report.checks.map((check) => [check.id, check.status]));
const build = ({ events, task }) => buildInteractionReport(events, task);

// Task facts for a completed run, from its submit time.
function task(events, overrides = {}) {
  return { startMs: FIXTURE_START_MS, endMs: events.filter((event) => event.type === "click").at(-1).t, completed: true, valueMatches: true, valueSetterNative: true, fullscreen: false, ...overrides };
}

describe("buildInteractionReport", () => {
  it("returns every one of the 13 checks, each marked provisional", () => {
    const report = build(humanLike());
    expect(report.checks.map((check) => check.id)).toEqual(INTERACTION_CHECK_IDS);
    for (const check of report.checks) {
      expect(check.provisional).toBe(true);
      expect(check.observed.length).toBeGreaterThan(0);
    }
    expect(report.schemaVersion).toBe(2);
  });

  it("gives every click both its centre offset and its screen offset", () => {
    const report = build(humanLike());
    expect(report.click.clicks.length).toBeGreaterThan(0);
    for (const click of report.click.clicks) {
      expect(click.offsetFromCentre).toEqual({ dx: expect.any(Number), dy: expect.any(Number) });
      expect(click.screenMinusClient).toEqual({ dx: expect.any(Number), dy: expect.any(Number) });
    }
  });

  it("passes every check for a person-like run", () => {
    const report = build(humanLike());
    expect(report.task).toMatchObject({ phraseLength: INTERACTION_PHRASE.length, completed: true, fullscreen: false });
    expect(report.task.durationMs).toBeGreaterThan(1500);
    expect(statusesOf(report)).toEqual(Object.fromEntries(INTERACTION_CHECK_IDS.map((id) => [id, "pass"])));
  });

  it("fails trust and value source for script-made clicks and keys", () => {
    const statuses = statusesOf(build(scriptedElementClick()));
    expect(statuses.int_trusted).toBe("fail");
    expect(statuses.int_click_chain).toBe("fail");
    expect(statuses.int_value_source).toBe("fail");
    expect(statuses.int_dwell).toBe("fail");
    expect(statuses.int_task_speed).toBe("fail");
    expect(statuses.int_centre).toBe("na");
  });

  it("catches a faithful synthetic chain only through isTrusted", () => {
    const statuses = statusesOf(build(dispatchedChains()));
    expect(statuses.int_trusted).toBe("fail");
    expect(statuses.int_click_chain).toBe("pass");
    expect(statuses.int_key_chain).toBe("pass");
  });

  it("warns on premove for a raw CDP press, since Chromium synthesizes one move to the press point", () => {
    const statuses = statusesOf(build(cdpClickNoMoves()));
    expect(statuses.int_click_detail).toBe("pass");
    expect(statuses.int_premove).toBe("warn");
    expect(statuses.int_press).toBe("fail");
    expect(statuses.int_centre).toBe("fail");
  });

  it("fails premove when a press has no pointer movement at all in the second before it", () => {
    const start = clickEvents({ t: FIXTURE_START_MS, pressMs: 2, premove: { samples: 0, pathPx: 0, coalescedMin: null } });
    const submit = clickEvents({ target: "submit", t: FIXTURE_START_MS + 900, pressMs: 2, premove: { samples: 0, pathPx: 0, coalescedMin: null } });
    const events = [...start, ...submit];
    expect(statusesOf(buildInteractionReport(events, task(events))).int_premove).toBe("fail");
  });

  it("fails the key chain for insertText and reports no key holds", () => {
    const statuses = statusesOf(build(cdpInsertText()));
    expect(statuses.int_key_chain).toBe("fail");
    expect(statuses.int_value_source).toBe("warn");
    expect(statuses.int_dwell).toBe("fail");
    expect(statuses.int_key_rhythm).toBe("na");
  });

  it("fails key rhythm for exact per-key timing and warns on identical holds", () => {
    const report = build(cdpPerKeyExactTiming());
    const statuses = statusesOf(report);
    expect(report.typing.intervalMs).toMatchObject({ mean: 100, cv: 0 });
    expect(statuses.int_key_rhythm).toBe("fail");
    expect(statuses.int_dwell).toBe("warn");
    expect(statuses.int_key_chain).toBe("pass");
  });

  it("warns, not fails, when the value arrives by paste", () => {
    const start = clickEvents({ t: FIXTURE_START_MS, premove: { samples: 40, pathPx: 300, coalescedMin: 1 } });
    const pasted = [
      { type: "paste", t: FIXTURE_START_MS + 900, target: "phrase", isTrusted: true, hidden: false, hasFocus: true },
      { type: "beforeinput", t: FIXTURE_START_MS + 901, target: "phrase", isTrusted: true, inputType: "insertFromPaste", hidden: false, hasFocus: true },
      { type: "input", t: FIXTURE_START_MS + 901, target: "phrase", isTrusted: true, inputType: "insertFromPaste", hidden: false, hasFocus: true }
    ];
    const submit = clickEvents({ target: "submit", t: FIXTURE_START_MS + 1500, premove: { samples: 40, pathPx: 300, coalescedMin: 1 } });
    const events = [...start, ...pasted, ...submit];
    const report = buildInteractionReport(events, task(events));
    const statuses = statusesOf(report);
    expect(statuses.int_value_source).toBe("warn");
    expect(statuses.int_key_chain).toBe("na");
    expect(report.typing.counts.paste).toBe(1);
  });

  it("never carries key values, typed text or page coordinates", () => {
    const serialized = JSON.stringify(build(humanLike()));
    expect(serialized).not.toContain(INTERACTION_PHRASE);
    expect(serialized).not.toMatch(/clientX|clientY|pageX|pageY|"key"|"code"/);
  });

  it("keeps the last ten clicks", () => {
    const { events, task } = humanLike();
    const many = [...events];
    for (let index = 0; index < 12; index += 1) many.push(...clickEvents({ target: "start", t: 5000 + index * 500, pressMs: 80 }));
    const report = buildInteractionReport(many, { ...task, endMs: null, completed: false });
    expect(report.click.clicks).toHaveLength(10);
    expect(report.task.completed).toBe(false);
    expect(report.task.durationMs).toBeNull();
  });

  it("judges nothing for an untaken test: every check is not available", () => {
    const report = buildInteractionReport([], {
      phraseLength: INTERACTION_PHRASE.length,
      startMs: null,
      endMs: null,
      completed: false,
      valueMatches: false,
      valueSetterNative: null,
      fullscreen: false
    });
    expect(report.task).toMatchObject({ completed: false, durationMs: null });
    expect(new Set(report.checks.map((check) => check.status))).toEqual(new Set(["na"]));
  });

  it("marks a click as a keyboard activation only when Enter or Space precedes it with no press", () => {
    const report = build(keyboardRun());
    expect(report.click.clicks.map((click) => [click.target, click.activation])).toEqual([["start", "keyboard"], ["submit", "keyboard"]]);
    expect(validateInteractionReport(report), JSON.stringify(validateInteractionReport.errors)).toBe(true);
    for (const click of report.click.clicks) {
      expect(click).toMatchObject({ detail: 0, offsetFromCentre: null, screenMinusClient: null, pressMs: null });
    }
  });

  it("passes every check a keyboard-only run can be judged on, and leaves the pointer checks not judged", () => {
    const statuses = statusesOf(build(keyboardRun()));
    expect(statuses.int_trusted).toBe("pass");
    expect(statuses.int_click_chain).toBe("pass");
    expect(statuses.int_key_chain).toBe("pass");
    expect(statuses.int_value_source).toBe("pass");
    for (const id of ["int_click_detail", "int_screen_coords", "int_coalesced", "int_premove", "int_centre", "int_press"]) {
      expect(statuses[id], id).toBe("na");
    }
  });

  it("keeps a script-made click that has no press and no key as a pointer click that fails the chain", () => {
    const report = build(scriptedElementClick());
    expect(report.click.clicks.every((click) => click.activation === "pointer")).toBe(true);
    expect(statusesOf(report).int_click_chain).toBe("fail");
  });

  it("counts untrusted keyup, input and paste on the task in typing.untrusted, which is the path that needs those types", () => {
    const events = [
      { type: "keyup", t: 100, target: "phrase", isTrusted: false, keyClass: "printable", repeat: false },
      { type: "input", t: 101, target: "phrase", isTrusted: false, inputType: "insertText" },
      { type: "paste", t: 102, target: "phrase", isTrusted: false }
    ];
    expect(build({ events, task: { startMs: 0, endMs: 200, completed: true, valueMatches: false, valueSetterNative: true, fullscreen: false } }).typing.untrusted).toBe(3);
  });

  it("fails trust for a script-made keyboard activation", () => {
    const events = [...keyboardActivation({ target: "start", t: FIXTURE_START_MS, key: "Enter", trusted: false }), ...clickEvents({ target: "submit", t: FIXTURE_START_MS + 900 })];
    expect(statusesOf(buildInteractionReport(events, task(events))).int_trusted).toBe("fail");
  });
});
