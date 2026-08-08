import { defineConfig, devices } from '@playwright/test';
import { SIGNED_IN_STATE } from './e2e/session';

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
  /**
   * ONE REGISTRATION FOR THE WHOLE RUN, and one deletion after it.
   *
   * Every page and every read is behind the session now, so the suite needs a
   * session — and `POST api/auth/*` is limited to ten a minute per IP, all of
   * which arrive from 127.0.0.1. A per-file registration would rate-limit the
   * suite against itself, which is the limiter working rather than a bug to
   * route around. See `e2e/session.ts` for why there is no bypass in the server.
   */
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL: process.env.DASHBOARD_URL ?? 'http://127.0.0.1:7717',
    /**
     * SIGNED IN BY DEFAULT, because that is what almost every test here is
     * about: the feed, the deck, the type-ahead and the focus card are all
     * behind the gate. The specs whose subject IS being signed out opt back
     * out with `test.use({ storageState: { cookies: [], origins: [] } })`,
     * which reads as the deliberate choice it is.
     */
    storageState: SIGNED_IN_STATE,
    // A screenshot of a failed dashboard assertion is worth more than its
    // stack: the question is nearly always "what did it actually look like".
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
