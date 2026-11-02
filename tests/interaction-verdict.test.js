import { describe, expect, it } from "vitest";
import { INTERACTION_CALIBRATED, scoreReport, withValidInteraction } from "../src/report-verdict.js";
import { validateInteractionReport } from "../public/generated/validate-interaction-report.js";
import { buildInteractionReport } from "../public/collect-interaction.js";
import { evaluateInteractionChecks, INTERACTION_CHECK_IDS } from "../public/interaction-checks.js";
import { humanLike, scriptedElementClick } from "./fixtures/interaction-events.js";

const server = { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36" };
const interactionReasons = (verdict) => verdict.reasons.filter((reason) => reason.id.startsWith("int_") || reason.id === "interaction_report_invalid");
const scoreWith = (interaction) => scoreReport({ server, client: { interaction } });

function fromFixture({ events, task }) {
  return buildInteractionReport(events, task);
}

// Every one of the 13 checks fails at once, with the numbers that make each fail.
function allFailingReport() {
  return {
    schemaVersion: 2,
    task: { phraseLength: 14, completed: true, durationMs: 300, fullscreen: false },
    click: {
      clicks: [{
        target: "start",
        isTrusted: true,
        activation: "pointer",
        pointerType: "mouse",
        chain: ["focus", "click"],
        detail: 0,
        offsetFromCentre: { dx: 0, dy: 0 },
        screenMinusClient: { dx: 0, dy: 0 },
        premoveSamples: 0,
        premovePathPx: 0,
        coalescedMin: 0,
        pressMs: 2
      }]
    },
    typing: {
      counts: { keydown: 14, keypress: 0, beforeinput: 14, input: 14, keyup: 14, paste: 0 },
      untrusted: 1,
      inputTypes: { insertText: 14 },
      inputWithoutKeydown: 1,
      valueMatches: true,
      valueSetterNative: false,
      intervalMs: { n: 13, mean: 100, median: 100, stdDev: 1, cv: 0.01, min: 99 },
      dwellMs: null
    },
    checks: []
  };
}

describe("interaction scoring in the Worker", () => {
  it("scores a person-like run with no interaction reason", () => {
    const verdict = scoreWith(fromFixture(humanLike()));
    expect(interactionReasons(verdict)).toEqual([]);
    expect(verdict.score).toBe(100);
  });

  it("reports script-made input as medium or low reasons, never high", () => {
    const verdict = scoreWith(fromFixture(scriptedElementClick()));
    const reasons = interactionReasons(verdict);
    expect(reasons.map((reason) => reason.id)).toEqual(expect.arrayContaining(["int_trusted", "int_value_source", "int_click_chain"]));
    expect(reasons.find((reason) => reason.id === "int_trusted").severity).toBe("medium");
    for (const reason of reasons) expect(["medium", "low"]).toContain(reason.severity);
  });

  it("keeps the calibration switch off, so no raw fail can be high", () => {
    expect(INTERACTION_CALIBRATED).toBe(false);
  });

  it("re-derives every status from the numbers and ignores the client's checks array", () => {
    const forged = { ...fromFixture(scriptedElementClick()), checks: fromFixture(humanLike()).checks };
    expect(interactionReasons(scoreWith(forged)).map((reason) => reason.id)).toContain("int_trusted");

    const hidden = { ...fromFixture(humanLike()), checks: fromFixture(scriptedElementClick()).checks };
    expect(interactionReasons(scoreWith(hidden))).toEqual([]);
  });

  it("drops a report that does not match the schema, with a reason, and scores nothing from it", () => {
    const tampered = { ...fromFixture(scriptedElementClick()), events: [{ type: "keydown", key: "t" }] };
    const verdict = scoreWith(tampered);
    expect(verdict.reasons.map((reason) => reason.id)).toEqual(["interaction_report_invalid"]);
    expect(verdict.reasons[0].severity).toBe("low");
  });

  it("removes an invalid interaction report from the response copy of the client", () => {
    const tampered = { ...fromFixture(humanLike()), click: { clicks: [{ target: "menu" }] } };
    expect(withValidInteraction({ browser: {}, interaction: tampered })).toEqual({ browser: {} });
    const valid = fromFixture(humanLike());
    expect(withValidInteraction({ interaction: valid }).interaction).toEqual({ ...valid, checks: evaluateInteractionChecks(valid) });
    expect(withValidInteraction({ browser: {} })).toEqual({ browser: {} });
  });

  it("returns server-derived checks, not a forged all-pass array, for a valid report with failing metrics", () => {
    const report = allFailingReport();
    const allPass = INTERACTION_CHECK_IDS.map((id) => ({ id, status: "pass", observed: "forged", provisional: true }));
    const response = withValidInteraction({ interaction: { ...report, checks: allPass } });
    expect(response.interaction.checks).toEqual(evaluateInteractionChecks(report));
    expect(response.interaction.checks.filter((check) => check.status === "fail").length).toBeGreaterThan(0);
    expect(response.interaction.checks.every((check) => check.status === "pass")).toBe(false);
  });

  it("scores nothing for a test that was not completed, even with failing numbers", () => {
    const abandoned = { ...allFailingReport(), task: { ...allFailingReport().task, completed: false, durationMs: null } };
    expect(interactionReasons(scoreWith(abandoned))).toEqual([]);
  });

  it("cannot make a verdict bot on its own: 11 raw fails and two warns take 35 points and leave it suspicious", () => {
    const report = allFailingReport();
    expect(validateInteractionReport(report), JSON.stringify(validateInteractionReport.errors)).toBe(true);
    const verdict = scoreWith(report);
    const reasons = interactionReasons(verdict);
    expect(reasons).toHaveLength(13);
    // int_screen_coords (equal coordinates) and int_coalesced (no coalesced events) are warns, so each costs 1 point at low severity.
    const warns = ["int_screen_coords", "int_coalesced"];
    for (const id of warns) expect(reasons.find((reason) => reason.id === id).severity).toBe("low");
    expect(new Set(reasons.filter((reason) => !warns.includes(reason.id)).map((reason) => reason.severity))).toEqual(new Set(["medium"]));
    expect(verdict.score).toBe(65);
    expect(verdict.classification).toBe("suspicious");
  });

  it("scores a synthetic-input run's script-made events once: synthetic_input carries the penalty and int_trusted only shows its status", () => {
    const { events, task } = scriptedElementClick();
    const interaction = buildInteractionReport(events, task);
    const client = { tells: { input: { count: 3, untrusted: 3, trustedWhileHidden: 0, trustedWithoutFocus: 0 } }, interaction };

    const verdict = scoreReport({ server, client });
    const ids = verdict.reasons.map((reason) => reason.id);
    expect(ids.filter((id) => id === "synthetic_input")).toHaveLength(1);
    expect(ids).not.toContain("int_trusted");
    expect(ids).toEqual(expect.arrayContaining(["int_value_source", "int_click_chain"]));

    const shown = withValidInteraction(client).interaction.checks.find((check) => check.id === "int_trusted");
    expect(shown.status).toBe("fail");

    // The same run with no remote-control tell still gets the int_trusted penalty, so only the duplicate is removed.
    const withoutTell = scoreReport({ server, client: { interaction } });
    expect(interactionReasons(withoutTell).map((reason) => reason.id)).toContain("int_trusted");
    // The tell swaps int_trusted's 3-point penalty for synthetic_input's 30, so the score is 27 points lower.
    expect(verdict.score).toBe(withoutTell.score - 27);
  });
});
