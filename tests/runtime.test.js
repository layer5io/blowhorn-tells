import { describe, expect, it } from "vitest";
import { computeBehavior } from "../public/runtime.js";

function makeState(overrides = {}) {
  return {
    startedAt: 0,
    events: [],
    rafSamples: [],
    challenge: {
      completed: false
    },
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
      challenge: { completed: true }
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
