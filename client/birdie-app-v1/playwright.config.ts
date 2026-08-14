import { defineConfig } from "@playwright/test";

const environment = (globalThis as { process?: { env?: Record<string, string | undefined> } })
  .process?.env;
const isCI = Boolean(environment?.CI);
const browserExecutablePath = environment?.BIRDIE_CHROME_PATH;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }]
  ],
  use: {
    baseURL: "http://127.0.0.1:4173",
    locale: "de-DE",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    launchOptions: {
      ...(browserExecutablePath ? { executablePath: browserExecutablePath } : {}),
      args: [
        "--enable-webgl",
        "--ignore-gpu-blocklist",
        "--use-gl=angle",
        "--use-angle=swiftshader-webgl"
      ]
    }
  },
  webServer: {
    command: "npm run preview -- --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !isCI,
    timeout: 30_000
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" }
    }
  ]
});
