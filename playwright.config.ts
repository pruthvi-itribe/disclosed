import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests for the dashboard.
 *
 * WHY THESE EXIST ALONGSIDE `page.spec.ts`. That suite asserts against the
 * rendered HTML string, which is fast and catches a missing element or a
 * changed contract — and cannot catch the failure that actually shipped: a
 * stray backtick inside `PAGE_SCRIPT` produced a document that served with a
 * 200, contained every id the tests looked for, and threw on load so the table
 * stayed empty. A string test cannot execute JavaScript, so it cannot tell a
 * page that renders from a page that merely parses.
 *
 * These run against the real server and the real database, on purpose. The
 * dashboard is a read-only view whose whole job is to show what the pipeline
 * produced, and a fixture would be asserting that a mock renders.
 *
 * NOT PART OF `npm test`. Jest runs in seconds with no network and no browser
 * and should stay that way; this is `npm run test:e2e`, and it needs the
 * dashboard running on its usual loopback port.
 */
export default defineConfig({
  testDir: './e2e',
  // One worker: every test reads the same live collection, and a parallel run
  // would be several browsers polling the same database the poller is writing
  // to for no benefit on a suite this size.
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.DASHBOARD_URL ?? 'http://127.0.0.1:7717',
    // A screenshot of a failed dashboard assertion is worth more than its
    // stack: the question is nearly always "what did it actually look like".
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
