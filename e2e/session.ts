import { tmpdir } from 'os';
import { join } from 'path';

/**
 * The browser suite's one way in.
 *
 * ================================================================
 * THERE IS NO TEST BYPASS, AND THERE MUST NOT BE ONE
 * ================================================================
 *
 * Every page and every read is behind the session now, so a browser suite needs
 * a session. The tempting shortcut is a header or a query parameter the guard
 * honours when some `E2E=1` flag is set — and it is refused here, because a
 * bypass is a second authentication path that exists only where nobody looks at
 * it, shipped in the same binary as the first. The founder's brief allowed one
 * gated to `AUTH_MODE=local`; it turned out not to be needed, which is the
 * better answer.
 *
 * WHAT THE SUITE USES INSTEAD IS THE FRONT DOOR. `AUTH_MODE=local` — which is
 * what an environment with no Firebase keys resolves to, so it needs no setting
 * at all — leaves `POST api/auth/register` live. `globalSetup` registers one
 * throwaway account through it and saves the cookie; `globalTeardown` deletes
 * the user, its sessions and its watchlist. The guard, the session lookup and
 * the cookie are all exercised exactly as a person's would be.
 *
 * IT MUST NOT RUN AGAINST A FIREBASE HOST, and it cannot: in `firebase` mode the
 * register route answers `409 LOCAL_AUTH_DISABLED`, and `globalSetup` fails with
 * a message saying so rather than silently producing an unauthenticated suite
 * that then fails 40 times.
 *
 * ================================================================
 * ONE REGISTRATION FOR THE WHOLE RUN
 * ================================================================
 *
 * `POST api/auth/*` is limited to ten a minute per IP and every request in this
 * suite comes from 127.0.0.1. A per-file registration would rate-limit the suite
 * against itself — which is the limiter working, not a bug to route around. So
 * the account is created ONCE in global setup and every spec starts from the
 * saved cookie, which `playwright.config.ts` applies as the default
 * `storageState`. The specs that are about being signed out opt back out with
 * `test.use({ storageState: { cookies: [], origins: [] } })`.
 */

/** The origin the dashboard was started on. */
export const originUrl = (): string =>
  process.env.DASHBOARD_URL ?? 'http://127.0.0.1:7717';

/** Where the dashboard's mongo is, read exactly as the dashboard reads it. */
export const mongoUri = (): string =>
  process.env.MONGO_URI ?? 'mongodb://localhost:27117/turret';

/**
 * Unique per run, so a killed run cannot collide with the next one, and
 * recognisable in a collection so a leaked one can be found by hand.
 */
export const runEmail = (): string =>
  `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@turret.test`;

/** Long enough to clear the twelve-character floor without being memorable. */
export const RUN_PASSWORD = 'rhubarb tuesday lantern';

/**
 * Where the run's cookie and the address that owns it are kept.
 *
 * In a fixed temp directory rather than a random one, because `globalSetup`,
 * every spec and `globalTeardown` are three processes that have to agree on the
 * path without passing anything to each other.
 */
export const STATE_DIR = join(tmpdir(), 'disclosed-e2e');
export const SIGNED_IN_STATE = join(STATE_DIR, 'signed-in.json');
export const ACCOUNT_FILE = join(STATE_DIR, 'account.json');
