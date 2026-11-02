import { describe, expect, it } from "vitest";
import { evaluateInteractionChecks, INTERACTION_CHECK_IDS, INTERACTION_THRESHOLDS } from "../public/interaction-checks.js";

// A minimal report in the schema shape. Each test changes only the numbers it is about.
function report({ completed = true, durationMs = 2000, clicks = [click()], typing = {}, fullscreen = false } = {}) {
  return {
    schemaVersion: 2,
    task: { phraseLength: 14, completed, durationMs: completed ? durationMs : null, fullscreen },
    click: { clicks },
    typing: {
      counts: { keydown: 14, keypress: 14, beforeinput: 14, input: 14, keyup: 14, paste: 0 },
      untrusted: 0,
      inputTypes: { insertText: 14 },
      inputWithoutKeydown: 0,
      valueMatches: true,
      valueSetterNative: true,
      intervalMs: { n: 13, mean: 200, median: 200, stdDev: 40, cv: 0.2, min: 120 },
      dwellMs: { n: 14, mean: 90, median: 90, stdDev: 20, cv: 0.22, min: 60 },
      ...typing
    },
    checks: []
  };
}

function click(overrides = {}) {
  return {
    target: "start",
    isTrusted: true,
    activation: "pointer",
    pointerType: "mouse",
    chain: ["pointerdown", "mousedown", "focus", "pointerup", "mouseup", "click"],
    detail: 1,
    offsetFromCentre: { dx: 3, dy: -3 },
    screenMinusClient: { dx: 2, dy: 80 },
    premoveSamples: 10,
    premovePathPx: 120,
    coalescedMin: 1,
    pressMs: 100,
    ...overrides
  };
}

function status(rep, id) {
  return evaluateInteractionChecks(rep).find((check) => check.id === id).status;
}

describe("interaction check thresholds", () => {
  it("is the single source of thresholds and check ids, in report order", () => {
    expect(INTERACTION_CHECK_IDS).toHaveLength(13);
    expect(INTERACTION_THRESHOLDS.centrePassPx).toBe(1);
    expect(evaluateInteractionChecks(report()).map((check) => check.id)).toEqual(INTERACTION_CHECK_IDS);
  });

  it("judges nothing for a report whose test was not completed", () => {
    expect(new Set(evaluateInteractionChecks(report({ completed: false })).map((check) => check.status))).toEqual(new Set(["na"]));
  });

  it("int_trusted: every event trusted passes, one script-made event fails", () => {
    expect(status(report(), "int_trusted")).toBe("pass");
    expect(status(report({ typing: { untrusted: 1 } }), "int_trusted")).toBe("fail");
  });

  it("int_trusted: a script-made click fails even when typing.untrusted says 0", () => {
    expect(status(report({ clicks: [click({ isTrusted: false })] }), "int_trusted")).toBe("fail");
  });

  it("int_click_chain: missing press fails, reordered press warns, full chain passes", () => {
    expect(status(report({ clicks: [click({ chain: ["focus", "click"] })] }), "int_click_chain")).toBe("fail");
    expect(status(report({ clicks: [click({ chain: ["pointerdown", "mousedown", "click", "pointerup", "mouseup"] })] }), "int_click_chain")).toBe("warn");
    expect(status(report({ clicks: [click()] }), "int_click_chain")).toBe("pass");
  });

  it("int_click_chain: a touch tap whose mouse events follow pointerup passes, a mouse event ahead of its pointer event warns", () => {
    const touch = click({ pointerType: "touch", chain: ["pointerdown", "pointerup", "mousedown", "focus", "mouseup", "click"] });
    expect(status(report({ clicks: [touch] }), "int_click_chain")).toBe("pass");
    expect(status(report({ clicks: [click({ chain: ["mousedown", "pointerdown", "pointerup", "mouseup", "click"] })] }), "int_click_chain")).toBe("warn");
    expect(status(report({ clicks: [click({ chain: ["pointerdown", "mousedown", "mouseup", "pointerup", "click"] })] }), "int_click_chain")).toBe("warn");
  });

  it("int_click_detail: a trusted click with detail 0 fails", () => {
    expect(status(report({ clicks: [click({ detail: 0 })] }), "int_click_detail")).toBe("fail");
    expect(status(report({ clicks: [click({ detail: 0, isTrusted: false })] }), "int_click_detail")).toBe("na");
  });

  it("int_screen_coords: equal on every click warns, differing passes, fullscreen is not judged", () => {
    expect(status(report({ clicks: [click({ screenMinusClient: { dx: 0, dy: 0 } })] }), "int_screen_coords")).toBe("warn");
    expect(status(report({ clicks: [click({ screenMinusClient: { dx: 0, dy: 0 } }), click({ screenMinusClient: { dx: 1, dy: 0 } })] }), "int_screen_coords")).toBe("pass");
    expect(status(report({ fullscreen: true, clicks: [click({ screenMinusClient: { dx: 0, dy: 0 } })] }), "int_screen_coords")).toBe("na");
  });

  it.each([
    [[1, 2], "pass"],
    [[0, 2], "warn"],
    [[0, 0], "warn"],
    [[], "na"]
  ])("int_coalesced over %j is %s: missing coalesced events warn, they never fail", (values, expected) => {
    const clicks = values.map((coalescedMin) => click({ coalescedMin }));
    expect(status(report({ clicks: clicks.length ? clicks : [click({ coalescedMin: null })] }), "int_coalesced")).toBe(expected);
  });

  it.each([
    ["no samples before any press", { premoveSamples: 0, premovePathPx: 0 }, "fail"],
    ["three samples and 25 px", { premoveSamples: 3, premovePathPx: 25 }, "pass"],
    ["two samples", { premoveSamples: 2, premovePathPx: 90 }, "warn"],
    ["three samples but 15 px", { premoveSamples: 3, premovePathPx: 15 }, "warn"]
  ])("int_premove: %s", (_label, premove, expected) => {
    expect(status(report({ clicks: [click(premove)] }), "int_premove")).toBe(expected);
  });

  it("int_premove is not judged for touch or pen", () => {
    expect(status(report({ clicks: [click({ pointerType: "touch", premoveSamples: 0, premovePathPx: 0 })] }), "int_premove")).toBe("na");
  });

  it.each([
    [0.4, "fail"],
    [0.7, "warn"],
    [1.5, "pass"]
  ])("int_centre: farthest click %d px from centre is %s", (distance, expected) => {
    expect(status(report({ clicks: [click({ offsetFromCentre: { dx: distance, dy: 0 } })] }), "int_centre")).toBe(expected);
  });

  it.each([
    [[5], "fail"],
    [[20], "warn"],
    [[100], "pass"],
    [[100, 5], "warn"]
  ])("int_press: presses %j ms are %s", (presses, expected) => {
    expect(status(report({ clicks: presses.map((pressMs) => click({ pressMs })) }), "int_press")).toBe(expected);
  });

  it.each([
    [{ n: 13, mean: 200, cv: 0.2 }, "pass"],
    [{ n: 13, mean: 200, cv: 0.1 }, "warn"],
    [{ n: 13, mean: 200, cv: 0.02 }, "fail"],
    [{ n: 13, mean: 20, cv: 0.3 }, "fail"],
    [{ n: 5, mean: 200, cv: 0.2 }, "na"]
  ])("int_key_rhythm: %j is %s", (intervalMs, expected) => {
    expect(status(report({ typing: { intervalMs: { median: 200, stdDev: 40, min: 120, ...intervalMs } } }), "int_key_rhythm")).toBe(expected);
  });

  it("int_dwell: a human spread passes, identical holds warn, zero or missing holds fail", () => {
    expect(status(report(), "int_dwell")).toBe("pass");
    expect(status(report({ typing: { dwellMs: { n: 14, mean: 80, median: 80, stdDev: 0, cv: 0, min: 80 } } }), "int_dwell")).toBe("warn");
    expect(status(report({ typing: { dwellMs: { n: 14, mean: 0, median: 0, stdDev: 0, cv: 0, min: 0 } } }), "int_dwell")).toBe("fail");
    expect(status(report({ typing: { dwellMs: null } }), "int_dwell")).toBe("fail");
    expect(status(report({ typing: { dwellMs: { n: 14, mean: 400, median: 400, stdDev: 30, cv: 0.07, min: 300 } } }), "int_dwell")).toBe("warn");
  });

  it("int_key_chain: text with no key presses fails, a missing beforeinput, input or keyup warns, keypress is not judged", () => {
    expect(status(report({ typing: { inputWithoutKeydown: 1 } }), "int_key_chain")).toBe("fail");
    expect(status(report({ typing: { counts: { keydown: 14, keypress: 14, beforeinput: 14, input: 12, keyup: 14, paste: 0 } } }), "int_key_chain")).toBe("warn");
    expect(status(report({ typing: { counts: { keydown: 14, keypress: 14, beforeinput: 14, input: 14, keyup: 13, paste: 0 } } }), "int_key_chain")).toBe("warn");
    expect(status(report({ typing: { counts: { keydown: 14, keypress: 0, beforeinput: 14, input: 14, keyup: 14, paste: 0 } } }), "int_key_chain")).toBe("pass");
    expect(status(report(), "int_key_chain")).toBe("pass");
    expect(status(report({ typing: { counts: { keydown: 0, keypress: 0, beforeinput: 0, input: 0, keyup: 0, paste: 1 } } }), "int_key_chain")).toBe("na");
  });

  it("int_value_source: a non-native setter or a value with no input events fails; a paste warns", () => {
    expect(status(report({ typing: { valueSetterNative: false } }), "int_value_source")).toBe("fail");
    expect(status(report({ typing: { counts: { keydown: 0, keypress: 0, beforeinput: 0, input: 0, keyup: 0, paste: 0 } } }), "int_value_source")).toBe("fail");
    expect(status(report({ typing: { counts: { keydown: 0, keypress: 0, beforeinput: 1, input: 1, keyup: 0, paste: 1 }, inputWithoutKeydown: 0 } }), "int_value_source")).toBe("warn");
    expect(status(report({ typing: { valueMatches: false } }), "int_value_source")).toBe("na");
    expect(status(report(), "int_value_source")).toBe("pass");
  });

  it.each([
    [2000, "pass"],
    [1000, "warn"],
    [500, "fail"]
  ])("int_task_speed: Start to Submit in %d ms is %s", (durationMs, expected) => {
    expect(status(report({ durationMs }), "int_task_speed")).toBe(expected);
  });

  it("int_dwell: paste with no key holds is not applicable, while no holds from typed keys still fails", () => {
    const noHolds = { dwellMs: null };
    expect(status(report({ typing: { ...noHolds, counts: { keydown: 0, keypress: 0, beforeinput: 0, input: 1, keyup: 0, paste: 1 } } }), "int_dwell")).toBe("na");
    expect(status(report({ typing: { ...noHolds, counts: { keydown: 14, keypress: 14, beforeinput: 14, input: 14, keyup: 0, paste: 1 } } }), "int_dwell")).toBe("fail");
    expect(status(report({ typing: { ...noHolds } }), "int_dwell")).toBe("fail");
  });

  describe("keyboard activation", () => {
    const keyboardClick = (overrides = {}) => click({
      activation: "keyboard",
      chain: ["focus", "click"],
      detail: 0,
      offsetFromCentre: null,
      screenMinusClient: null,
      pointerType: "",
      premoveSamples: undefined,
      premovePathPx: undefined,
      coalescedMin: undefined,
      pressMs: null,
      ...overrides
    });

    it("int_click_chain: a keyboard activation is a valid chain, so a keyboard-only run passes", () => {
      expect(status(report({ clicks: [keyboardClick()] }), "int_click_chain")).toBe("pass");
      expect(status(report({ clicks: [keyboardClick({ target: "submit" })] }), "int_click_chain")).toBe("pass");
    });

    it("int_click_chain: a keyboard activation next to a broken pointer click still judges the pointer click", () => {
      expect(status(report({ clicks: [keyboardClick(), click({ chain: ["focus", "click"] })] }), "int_click_chain")).toBe("fail");
    });

    it("pointer geometry checks return na when only keyboard activations remain", () => {
      const rep = report({ clicks: [keyboardClick(), keyboardClick({ target: "submit" })] });
      for (const id of ["int_click_detail", "int_screen_coords", "int_centre", "int_press", "int_premove", "int_coalesced"]) {
        expect(status(rep, id), id).toBe("na");
      }
    });

    it("pointer geometry checks still judge the pointer clicks beside a keyboard activation", () => {
      const rep = report({ clicks: [keyboardClick(), click({ offsetFromCentre: { dx: 0, dy: 0 } })] });
      expect(status(rep, "int_centre")).toBe("fail");
      expect(status(rep, "int_click_detail")).toBe("pass");
    });
  });
});
