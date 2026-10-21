import { defineConfig } from "@playwright/test";

const port = Number(process.env.E2E_PORT || 8788);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL
  },
  webServer: {
    command: "node tests/e2e/support/worker-server.js",
    url: `${baseURL}/api/check`,
    reuseExistingServer: !process.env.CI,
    timeout: 10_000
  }
});
