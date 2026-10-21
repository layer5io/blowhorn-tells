export function collectPerformanceMemorySnapshot(nowMs = performance.now()) {
  const memory = performance.memory;
  if (!memory) return { supported: false, t: Math.round(nowMs) };
  return {
    supported: true,
    t: Math.round(nowMs),
    usedJSHeapSize: memory.usedJSHeapSize,
    totalJSHeapSize: memory.totalJSHeapSize,
    jsHeapSizeLimit: memory.jsHeapSizeLimit,
    usedRatio: ratio(memory.usedJSHeapSize, memory.totalJSHeapSize)
  };
}

export function buildPerformanceMemorySurface(state) {
  const samples = Array.isArray(state.performanceSamples) ? state.performanceSamples.slice(-120) : [];
  const latest = samples.length ? samples[samples.length - 1] : collectPerformanceMemorySnapshot(performance.now() - state.startedAt);

  return {
    memory: latest.supported ? {
      supported: true,
      usedJSHeapSize: latest.usedJSHeapSize,
      totalJSHeapSize: latest.totalJSHeapSize,
      jsHeapSizeLimit: latest.jsHeapSizeLimit,
      usedRatio: latest.usedRatio
    } : { supported: false },
    samples,
    fps: collectFpsSummary(state)
  };
}

function collectFpsSummary(state) {
  const samples = Array.isArray(state.rafSamples) ? state.rafSamples.slice(-120) : [];
  const frameTimes = samples.filter((value) => Number.isFinite(value) && value > 0);
  if (!frameTimes.length) return { supported: false };
  const avgFrameMs = frameTimes.reduce((acc, value) => acc + value, 0) / frameTimes.length;
  return {
    supported: true,
    avgFrameMs: Math.round(avgFrameMs * 100) / 100,
    approximateFps: Math.round(1000 / avgFrameMs),
    samples: frameTimes.length
  };
}

function ratio(used, total) {
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) return null;
  return Math.round((used / total) * 1000) / 1000;
}
