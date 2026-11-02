export function createInitialState(clock = performance) {
  return {
    startedAt: clock.now(),
    report: null,
    events: [],
    rafSamples: [],
    performanceSamples: [],
    sensorSamples: {
      orientation: [],
      motion: []
    },
    lastPointerSampleAt: 0,
    interaction: {
      startMs: null,
      endMs: null,
      events: [],
      trail: [],
      lastMove: null,
      report: null
    }
  };
}

export const state = createInitialState();
