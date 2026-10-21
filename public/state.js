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
    challenge: {
      formSubmitted: false,
      confirmAccepted: false,
      tableShown: false,
      updatedRows: 0,
      completed: false
    }
  };
}

export const state = createInitialState();
