import { expect, test, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'fs';
import mongoose from 'mongoose';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * The whole loop, in a browser, against the real database:
 *
 *   register -> sign in -> star a company -> see it in Watching -> sign out
 *   -> sign back in and find the watchlist intact
 *
 * WHY IT USES A REAL, THROWAWAY USER. Everything interesting here is a
 * property of the round trip — a cookie the browser accepts and re-sends, a
 * star that survives the four-second repaint, a tab that appears only when a
 * session exists. A fixture would be asserting that a mock renders.
 *
 * ================================================================
 * WHY MOST OF THESE TESTS DO NOT SIGN IN THROUGH THE FORM
 * ================================================================
 *
 * `POST api/auth/*` is limited to ten a minute PER IP, and every request in
 * this file comes from 127.0.0.1. Ten UI sign-ins in a suite that runs in under
 * a minute is a suite that rate-limits itself — which is the limiter working,
 * not a bug to route around.
 *
 * So the file spends its budget deliberately: ONE test drives the panel by hand
 * (that is the test whose subject is the form), and the rest start from a saved
 * cookie. Total sign-in calls: register, one wrong password, two UI logins in
 * the loop test, and one in the cleanup — five of the ten.
 *
 * The account is created with a unique address per run and REMOVED at the end —
 * the user, its sessions and its watchlist — by connecting to the same database
 * the dashboard is pointed at. Through the driver rather than through a route,
 * because there is no account-deletion route yet (it is follow-on F8), and a
 * browser suite that left a user document behind on every run would be turning
 * a test into a slow leak in a real collection.
 *
 * A killed run leaves one user with a random address behind it. `MONGO_URI` is
 * read the same way the dashboard reads it, so pointing the suite at a
 * different database is one variable.
 */

/** Fails the test if the page logged an uncaught error, whatever else it did. */
const watchConsole = (page: Page): string[] => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
};

/**
 * The origin the dashboard was started on.
 *
 * Every mutation is Origin-guarded and Playwright's API request context sends
 * no `Origin` of its own, so each non-GET call below has to state it. A browser
 * sets it automatically, which is why the page itself needs no help.
 */
const origin = (): string =>
  process.env.DASHBOARD_URL ?? 'http://127.0.0.1:7717';

/** Unique per run, so a killed run cannot collide with the next one. */
const EMAIL = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@turret.test`;
const PASSWORD = 'rhubarb tuesday lantern';

/** Where the registered session's cookie is kept for the tests that reuse it. */
const stateDir = mkdtempSync(join(tmpdir(), 'turret-e2e-'));
const SIGNED_IN_STATE = join(stateDir, 'signed-in.json');

/** Signs the page in through the panel, exactly as a person would. */
const signInThroughTheForm = async (page: Page): Promise<void> => {
  await expect(page.locator('#signin')).toBeVisible();
  await page.locator('#signin').click();
  await page.locator('#auth-email').fill(EMAIL);
  await page.locator('#auth-password').fill(PASSWORD);
  await page.locator('#auth-go').click();
  await expect(page.locator('#signout')).toBeVisible();
};

/** A symbol the live collection actually holds, so the star watches something real. */
const aKnownSymbol = async (page: Page): Promise<string> => {
  const response = await page.request.get('/api/filings?limit=1');
  const body = (await response.json()) as { data: Array<{ symbol: string }> };
  expect(body.data.length).toBeGreaterThan(0);
  return body.data[0].symbol;
};

test.beforeAll(async ({ request }) => {
  const response = await request.post('/api/auth/register', {
    data: { email: EMAIL, password: PASSWORD },
    headers: { Origin: origin() },
  });
  expect(response.status()).toBe(201);

  // The session cookie register just set, saved so the tests that are not
  // about the form can start from it.
  await request.storageState({ path: SIGNED_IN_STATE });
});

test.afterAll(async ({ request }) => {
  // CLEANS UP AFTER ITSELF, through the same routes a person has: the
  // watchlist is emptied and every session is revoked.
  const signin = await request.post('/api/auth/login', {
    data: { email: EMAIL, password: PASSWORD },
    headers: { Origin: origin() },
  });
  if (signin.status() === 200) {
    const listed = await request.get('/api/watchlist');
    if (listed.status() === 200) {
      const body = (await listed.json()) as { data: Array<{ symbol: string }> };
      for (const row of body.data) {
        await request.delete(
          `/api/watchlist/${encodeURIComponent(row.symbol)}`,
          { headers: { Origin: origin() } },
        );
      }
    }
    await request.post('/api/auth/logout-all', {
      headers: { Origin: origin() },
    });
  }

  rmSync(stateDir, { recursive: true, force: true });

  // The account itself, removed through the driver. Named collections rather
  // than models: this file has no schemas and needs none to delete three
  // documents.
  const uri = process.env.MONGO_URI ?? 'mongodb://localhost:27117/turret';
  const connection = mongoose.createConnection(uri);
  try {
    await connection.asPromise();
    const db = connection.db;
    if (db) {
      const user = await db.collection('users').findOne({ email: EMAIL });
      if (user) {
        await db.collection('sessions').deleteMany({ userId: user._id });
        await db.collection('watchlists').deleteMany({ userId: user._id });
        await db.collection('users').deleteOne({ _id: user._id });
      }
    }
  } finally {
    await connection.close();
  }
});

test.describe('signed out', () => {
  test('offers a way in and hides everything that needs one', async ({
    page,
  }) => {
    const errors = watchConsole(page);
    await page.goto('/');

    await expect(page.locator('#signin')).toBeVisible();
    await expect(page.locator('#signout')).toBeHidden();
    // The tab is meaningless without a watchlist, and a control that is
    // permanently disabled and never explains itself is worse than no control.
    await expect(page.locator('#tab-watching')).toBeHidden();
    expect(errors).toEqual([]);
  });

  test('draws no watch star on any card', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#live-text')).not.toHaveText('connecting');
    await expect(page.locator('#feed .card, #feed .emptyfeed')).not.toHaveCount(
      0,
    );

    // ABSENT, not disabled.
    await expect(page.locator('[data-ui="watch"]')).toHaveCount(0);
  });

  test('says there is no self-serve password reset yet', async ({ page }) => {
    await page.goto('/');
    await page.locator('#signin').click();

    await expect(page.locator('.authnote')).toContainText(
      'No password reset yet',
    );
  });

  test('refuses a wrong password without saying which half was wrong', async ({
    page,
  }) => {
    await page.goto('/');
    await page.locator('#signin').click();
    await page.locator('#auth-email').fill(EMAIL);
    await page.locator('#auth-password').fill('definitely not it at all');
    await page.locator('#auth-go').click();

    await expect(page.locator('#auth-error')).toHaveText(
      'Email or password is incorrect.',
    );
    await expect(page.locator('#signout')).toBeHidden();
  });
});

test.describe('the loop', () => {
  test('signs in, stars, watches, signs out, and comes back to it', async ({
    page,
  }) => {
    // THE FOUNDER'S "DONE" CRITERION, in one test, because it is one claim: a
    // tester registers, signs in, stars a company, sees it in Watching, signs
    // out, signs back in, and finds the watchlist intact.
    const errors = watchConsole(page);
    await page.goto('/');
    const symbol = await aKnownSymbol(page);

    await signInThroughTheForm(page);

    // The header swaps and the Watching tab arrives with the session.
    await expect(page.locator('#signin')).toBeHidden();
    await expect(page.locator('#tab-watching')).toBeVisible();

    await expect(page.locator('#live-text')).not.toHaveText('connecting');
    const star = page
      .locator(`[data-ui="watch"][data-symbol="${symbol}"]`)
      .first();
    await expect(star).toBeVisible();
    await expect(star).toHaveAttribute('aria-pressed', 'false');

    await star.click();
    await expect(star).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#watch-count')).toContainText('of 50');

    // THE REPAINT IS THE TEST. The feed rebuilds every four seconds and no DOM
    // node survives it, so a star kept in the DOM rather than in
    // `state.watched` would un-fill itself right here.
    await page.waitForTimeout(4600);
    await expect(
      page.locator(`[data-ui="watch"][data-symbol="${symbol}"]`).first(),
    ).toHaveAttribute('aria-pressed', 'true');

    // Watching draws the same cards the feed does, for that company only.
    await page.locator('#tab-watching').click();
    await expect(page.locator('#view-watching')).toBeVisible();
    await expect(page.locator('#watch-feed .card')).not.toHaveCount(0);
    const symbols = await page
      .locator('#watch-feed .card .sym')
      .allTextContents();
    expect([...new Set(symbols)]).toEqual([symbol]);

    // Signing out takes the tab, the stars and the view's contents with it.
    await page.locator('#signout').click();
    await expect(page.locator('#signin')).toBeVisible();
    await expect(page.locator('#tab-watching')).toBeHidden();
    await expect(page.locator('#view-watching')).toBeHidden();
    await expect(page.locator('[data-ui="watch"]')).toHaveCount(0);

    // Back in, and the watchlist is a document rather than a tab.
    await signInThroughTheForm(page);
    await expect(page.locator('#live-text')).not.toHaveText('connecting');
    await expect(
      page.locator(`[data-ui="watch"][data-symbol="${symbol}"]`).first(),
    ).toHaveAttribute('aria-pressed', 'true');

    expect(errors).toEqual([]);
  });
});

test.describe('signed in', () => {
  // Started from the cookie `beforeAll` saved, so these cost no sign-in.
  test.use({ storageState: SIGNED_IN_STATE });

  test('offers the same star on the company page', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#signout')).toBeVisible();
    await expect(page.locator('#live-text')).not.toHaveText('connecting');

    await page.locator('#feed .card[data-seq] .sym').first().click();

    await expect(page.locator('#view-company')).toBeVisible();
    await expect(page.locator('#co-watch')).toBeVisible();
    await expect(page.locator('#co-watch')).toHaveAttribute(
      'aria-label',
      /Watch|watching/,
    );
  });

  test('draws the star as a shape, with no glyph and no remote asset', async ({
    page,
  }) => {
    // `page.spec.ts` rejects the emoji range — which holds both star glyphs —
    // and rejects a remote CSS asset. This is the version of that assertion a
    // browser can make: the control has a clip-path and its own words.
    await page.goto('/');
    await expect(page.locator('#live-text')).not.toHaveText('connecting');

    const star = page.locator('[data-ui="watch"]').first();
    await expect(star).toBeVisible();
    const clip = await star.evaluate((node) =>
      window.getComputedStyle(node, '::before').getPropertyValue('clip-path'),
    );

    expect(clip).toContain('polygon');
    await expect(star).toContainText(/Watch/);
  });

  test('refuses a mutation that claims another origin', async ({ page }) => {
    await page.goto('/');
    const symbol = await aKnownSymbol(page);

    const response = await page.request.post(
      `/api/watchlist?symbol=${encodeURIComponent(symbol)}`,
      { headers: { Origin: 'http://evil.example' } },
    );

    expect(response.status()).toBe(403);
  });

  test('refuses the watchlist once the session has been revoked', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.locator('#signout')).toBeVisible();

    await page.locator('#signout').click();
    await expect(page.locator('#signin')).toBeVisible();

    // Asked with whatever cookie the browser still holds. The session was
    // DELETED server-side, not merely un-cookied.
    expect((await page.request.get('/api/watchlist')).status()).toBe(401);
  });
});
