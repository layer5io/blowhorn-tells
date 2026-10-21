export function createWorkerEnv(overrides = {}) {
  return {
    IP_INTEL_PROVIDER: "none",
    API_RATE_LIMITER: {
      async limit() {
        return { success: true };
      }
    },
    ...overrides
  };
}
