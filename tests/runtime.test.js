import { describe, expect, it } from "vitest";
import { computeBehavior, pressPremove } from "../public/runtime.js";

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
      pointerDistance: 0,
      challengeCompleted: false
    });
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
    expect(behavior.summary.challengeCompleted).toBe(true);
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
