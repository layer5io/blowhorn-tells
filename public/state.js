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
      // Events lost because the buffer was full and nothing could be evicted. A run with any cannot be scored.
      dropped: 0,
      trail: [],
      lastMove: null,
      report: null
    }
  };
}

export const state = createInitialState();
