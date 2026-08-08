import { request } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'fs';
import {
  ACCOUNT_FILE,
  originUrl,
  RUN_PASSWORD,
  runEmail,
  SIGNED_IN_STATE,
  STATE_DIR,
} from './session';

/**
 * Registers the one account the whole browser run signs in with.
 *
 * Runs once, before any spec. See `session.ts` for why there is one account
 * rather than one per file, and why there is no test bypass in the server.
 */
export default async function globalSetup(): Promise<void> {
  const origin = originUrl();
  mkdirSync(STATE_DIR, { recursive: true });

  const context = await request.newContext({ baseURL: origin });
  const email = runEmail();

  // The Origin header is not optional: every mutation is Origin-guarded, and
  // Playwright's API request context sends none of its own. A browser sets it
  // automatically, which is why the pages themselves need no help.
  const response = await context.post('/api/auth/register', {
    data: { email, password: RUN_PASSWORD },
    headers: { Origin: origin },
  });

  if (response.status() !== 201) {
    const body = await response.text();
    await context.dispose();
    // NAMES THE LIKELY CAUSE. A 409 here means the dashboard under test is
    // running in firebase mode, where the in-house register route is closed on
    // purpose — and a suite that limped on without a session would fail forty
    // times without once saying why.
    throw new Error(
      `Could not register the e2e account at ${origin} (HTTP ${response.status()}): ${body}\n` +
        'The browser suite signs in through the in-house path, so the dashboard ' +
        'under test must be running with AUTH_MODE=local — which is what an ' +
        'environment with no FIREBASE_* keys resolves to. There is deliberately ' +
        'no bypass in the server for this.',
    );
  }

  // The cookie register just set, saved for every spec to start from.
  await context.storageState({ path: SIGNED_IN_STATE });
  // The address, so global teardown can find the row it has to delete.
  writeFileSync(ACCOUNT_FILE, JSON.stringify({ email }), 'utf8');
  await context.dispose();
}
