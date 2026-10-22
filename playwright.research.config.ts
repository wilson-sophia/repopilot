import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.RESEARCH_TEST_PORT ?? "3100");
const baseURL = `http://127.0.0.1:${port}`;
const testDataDirectory =
  process.env.RESEARCH_TEST_DATA_DIR ??
  `.data/test-e2e-${process.pid}-${Date.now()}`;

export default defineConfig({
  expect: { timeout: 15_000 },
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: false,
  outputDir: "test-results/research",
  reporter: [
    ["list"],
    ["json", { outputFile: "test-results/research-results.json" }],
    ["html", { open: "never", outputFolder: "playwright-report/research" }],
  ],
  retries: 0,
  testDir: "./tests",
  testMatch: ["research/**/*.test.ts", "research-e2e/**/*.test.ts"],
  timeout: 90_000,
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
  },
  webServer: {
    command: `pnpm dev --hostname 127.0.0.1 --port ${port}`,
    env: {
      AUTH_SECRET: "research-tests-only-not-a-production-secret-2026",
      AUTH_URL: baseURL,
      NEXT_DIST_DIR: ".next-research-test",
      PGLITE_DATA_DIR: testDataDirectory,
      POSTGRES_URL: "",
      RESEARCH_FIXTURES: "1",
      RESEARCH_MODE: "demo",
    },
    reuseExistingServer: false,
    timeout: 180_000,
    url: `${baseURL}/ping`,
  },
  workers: 1,
});
