import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end configuration.
 *
 * The suite runs against a REAL running application — API plus SPA — because
 * the things worth testing end to end (the demo data actually reaching the
 * dashboard, filters round-tripping through the API, a scan run reporting
 * honestly when nmap is absent) are exactly the things a mocked front-end test
 * cannot see.
 *
 * By default Playwright starts the server itself via `webServer` below. Point
 * E2E_BASE_URL at an already-running instance to skip that.
 */
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:5150';

export default defineConfig({
    testDir: './e2e',
    // The API is a shared, stateful SQLite database: parallel workers mutating
    // the same rows (acknowledging alerts, editing devices) would flake.
    workers: 1,
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
    timeout: 30_000,
    expect: { timeout: 10_000 },

    use: {
        baseURL,
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
    },

    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ],

    // Build once and serve the SPA from the API so the E2E run exercises the
    // same single-origin setup as a real deployment (no dev-server proxy).
    webServer: process.env.E2E_BASE_URL
        ? undefined
        : {
            command: 'dotnet run --project ../NetworkMonitor.Server/NetworkMonitor.Server.csproj --urls http://localhost:5150',
            url: 'http://localhost:5150/api/dashboard/summary',
            reuseExistingServer: !process.env.CI,
            timeout: 180_000,
            stdout: 'pipe',
            stderr: 'pipe',
        },
});
