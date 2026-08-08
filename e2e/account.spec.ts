import { expect, test, type Page } from '@playwright/test';
import mongoose from 'mongoose';
import { mongoUri, originUrl, RUN_PASSWORD } from './session';

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
 * ITS OWN ACCOUNT, UNLIKE EVERY OTHER FILE HERE
 * ================================================================
 *
 * The rest of the suite starts from the one session `global-setup.ts` created,
 * because `POST api/auth/*` is limited to ten a minute per IP and every request
 * comes from 127.0.0.1. This file is the exception because its SUBJECT is
 * registration and sign-in, and it cannot test those from a saved cookie.
 *
 * The budget is spent deliberately: one register, one deliberately wrong
 * password, two sign-ins in the loop test, and one in the cleanup — five of the
 * ten, on top of global setup's one.
 *
 * ================================================================
 * THE SIGN-IN SURFACE IS `/auth` NOW, NOT A PANEL ON THE FEED
 * ================================================================
 *
 * A signed-out browser never receives the dashboard document — the front door
 * serves the landing page — so the modal that used to hold these two fields is
 * gone, along with the `#signin` button that opened it. Everything below drives
 * the real page a person would use.
 *
 * The account is created with a unique address per run and REMOVED at the end —
 * the user, its sessions and its watchlist — through the driver, because there
 * is no account-deletion route yet (follow-on F8) and a browser suite that left
 * a user document behind on every run would be a slow leak in a real collection.
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
const origin = originUrl;

/** Unique per run, so a killed run cannot collide with the next one. */
const EMAIL = `e2e-loop-${Date.now()}-${Math.floor(Math.random() * 1e6)}@turret.test`;
const PASSWORD = RUN_PASSWORD;

/** Signs the page in through the real page, exactly as a person would. */
const signInThroughTheForm = async (page: Page): Promise<void> => {
  await page.goto('/auth');
  await page.locator('#auth-email').fill(EMAIL);
  await page.locator('#auth-password').fill(PASSWORD);
  await page.locator('#auth-go').click();
  // The page navigates to the app itself on success.
  await expect(page.locator('#signout')).toBeVisible();
};

/** A symbol the live collection actually holds, so the star watches something real. */
const aKnownSymbol = async (page: Page): Promise<string> => {
  const response = await page.request.get('/api/filings?limit=1');
  const body = (await response.json()) as { data: Array<{ symbol: string }> };
  expect(body.data.length).toBeGreaterThan(0);
  return body.data[0].symbol;
};

/**
 * A symbol that is ON SCREEN, which is not the same question.
 *
 * `aKnownSymbol` asks the server for the newest filing; the feed shows only
 * filings carrying a verified claim, because "Only filings that said something"
 * is on by default. The two disagree whenever the newest filing said nothing
 * verifiable — which is most of them, and which is how this test came to be
 * looking for a star on a card that was never drawn. A test about a control
 * has to find the control the way a reader does.
 */
const aSymbolOnScreen = async (page: Page): Promise<string> => {
  await expect(page.locator('#live-text')).not.toHaveText('connecting');
  await expect(page.locator('#feed .card[data-seq]')).not.toHaveCount(0);
  const symbol = await page
    .locator('#feed .card[data-seq] .sym')
    .first()
    .textContent();
  expect(symbol).toBeTruthy();
  return (symbol as string).trim();
};

/**
 * A company that filed a long time ago and not since — the "quiet" half of a
 * watchlist.
 *
 * Read from the OLDEST page of `api/filings` rather than from the driver: the
 * route already orders newest-first, so the tail of it is the companies whose
 * last word was longest ago, and one request answers the whole question.
 *
 * `exclude` keeps this from returning the company the caller already watched,
 * which would collapse a two-company test into a one-company one and still
 * pass.
 */
const aCompanyThatFiledLongAgo = async (
  page: Page,
  exclude: string,
): Promise<string> => {
  const counted = await page.request.get('/api/filings?limit=1');
  const { meta } = (await counted.json()) as { meta: { total: number } };
  expect(meta.total).toBeGreaterThan(1);

  const offset = Math.max(0, meta.total - 25);
  const tail = await page.request.get(`/api/filings?limit=25&offset=${offset}`);
  const { data } = (await tail.json()) as { data: Array<{ symbol: string }> };

  // Last row first: the very oldest filing held.
  const symbol = data
    .map((row) => row.symbol)
    .reverse()
    .find((candidate) => candidate !== exclude);
  expect(symbol).toBeTruthy();
  return symbol as string;
};

test.beforeAll(async ({ request }) => {
  const response = await request.post('/api/auth/register', {
    data: { email: EMAIL, password: PASSWORD },
    headers: { Origin: origin() },
  });
  expect(response.status()).toBe(201);
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

  // The account itself, removed through the driver. Named collections rather
  // than models: this file has no schemas and needs none to delete three
  // documents.
  const connection = mongoose.createConnection(mongoUri());
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

test.describe('the sign-in page', () => {
  // SIGNED OUT ON PURPOSE, against the config's signed-in default. These four
  // are about the way in, and starting them from a session would test nothing.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('is where the landing page sends a visitor', async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto('/');

    await page.locator('[data-ui="signin-top"]').click();
    await expect(page).toHaveURL(/\/auth$/);
    await expect(page.locator('#auth-email')).toBeVisible();
    await expect(page.locator('#auth-password')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('offers the in-house form, because this host runs AUTH_MODE=local', async ({
    page,
  }) => {
    // The suite cannot run any other way — `global-setup.ts` registers through
    // the in-house route and fails loudly if it is closed — so asserting the
    // mode here is asserting the environment the rest of the file assumes.
    await page.goto('/auth');

    await expect(page.locator('#auth-form')).toBeVisible();
    await expect(page.locator('#auth-google')).toHaveCount(0);
  });

  test('switches between signing in and creating an account', async ({
    page,
  }) => {
    await page.goto('/auth');

    await expect(page.locator('#auth-go')).toHaveText('Sign in');
    await page.locator('#auth-alt').click();
    await expect(page.locator('#auth-go')).toHaveText('Create account');
    // The password manager is told which of the two this is, or it offers a
    // saved password on a signup form and a generator on neither.
    await expect(page.locator('#auth-password')).toHaveAttribute(
      'autocomplete',
      'new-password',
    );
  });

  test('says there is no self-serve password reset yet', async ({ page }) => {
    await page.goto('/auth');

    await expect(page.locator('.authnote')).toContainText(
      'No self-serve password reset yet',
    );
  });

  test('refuses a wrong password without saying which half was wrong', async ({
    page,
  }) => {
    await page.goto('/auth');
    await page.locator('#auth-email').fill(EMAIL);
    await page.locator('#auth-password').fill('definitely not it at all');
    await page.locator('#auth-go').click();

    await expect(page.locator('#auth-error')).toHaveText(
      'Email or password is incorrect.',
    );
    await expect(page).toHaveURL(/\/auth$/);
  });
});

test.describe('the loop', () => {
  // STARTS SIGNED OUT, and it has to: `signInThroughTheForm` opens `/auth`, and
  // a browser that already holds a session is redirected off that page to the
  // app. It also means the sign-out below revokes THIS account's session and
  // never the shared one the rest of the run depends on.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('signs in, stars, watches, signs out, and comes back to it', async ({
    page,
  }) => {
    // THE FOUNDER'S "DONE" CRITERION, in one test, because it is one claim: a
    // tester registers, signs in, stars a company, sees it in Watching, signs
    // out, signs back in, and finds the watchlist intact.
    const errors = watchConsole(page);
    await signInThroughTheForm(page);

    // The header fills in and the Watching tab arrives with the session.
    await expect(page.locator('#signout')).toBeVisible();
    await expect(page.locator('#tab-watching')).toBeVisible();

    const symbol = await aSymbolOnScreen(page);
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

    // SIGNING OUT LEAVES THE APP ENTIRELY, and that is the gate rather than a
    // repaint. Every read on the dashboard is behind the session now, so the
    // page reloads and the server answers the front door with the landing
    // page — which takes the tab, the stars and the whole document with it.
    await page.locator('#signout').click();
    await expect(page.locator('[data-ui="sample-notice"]')).toBeVisible();
    await expect(page.locator('#tab-watching')).toHaveCount(0);
    await expect(page.locator('[data-ui="watch"]')).toHaveCount(0);

    // REVOKED SERVER-SIDE, not merely un-cookied. Asked with whatever cookie
    // the browser still holds, which is the only version of this claim worth
    // making: clearing a cookie is something a client does and can undo.
    expect((await page.request.get('/api/watchlist')).status()).toBe(401);

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
  // The run's shared session, applied by playwright.config.ts. These cost no
  // sign-in at all, which is the whole reason the account is created once.

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

  test('lists every watched company, quiet ones included, above the filings', async ({
    page,
  }) => {
    // THE REPORTED GAP, in a browser. The Watching view used to draw one thing:
    // a page of filings, the newest 25 of them ACROSS the whole watchlist. A
    // company that files less often than its neighbours contributed no card, so
    // it had no row anywhere on the view and watching it was indistinguishable
    // from never having pressed the star — "I don't see all my companies".
    //
    // Two companies as far apart as this collection allows: the one whose card
    // is on screen right now, and the one whose last word was longest ago.
    const errors = watchConsole(page);
    await page.goto('/');
    await expect(page.locator('#live-text')).not.toHaveText('connecting');

    const loud = await aSymbolOnScreen(page);
    const quiet = await aCompanyThatFiledLongAgo(page, loud);

    for (const symbol of [loud, quiet]) {
      const added = await page.request.post(
        `/api/watchlist?symbol=${encodeURIComponent(symbol)}`,
        { headers: { Origin: origin() } },
      );
      expect([200, 201]).toContain(added.status());
    }

    try {
      await page.locator('#tab-watching').click();
      await expect(page.locator('#view-watching')).toBeVisible();

      // BOTH OF THEM, WHATEVER THE FEED BELOW HOLDS. This is the assertion the
      // old view could not pass: there was no roster for it to pass against.
      const rows = page.locator('#watch-roster [data-ui="watching-row"]');
      await expect(rows).toHaveCount(2);
      for (const symbol of [loud, quiet]) {
        const row = page.locator(
          `#watch-roster [data-ui="watching-row"][data-symbol="${symbol}"]`,
        );
        await expect(row).toBeVisible();
        // Each row says when that company last spoke, or that nothing is held.
        // Never nothing at all, which is the state a reader cannot read.
        await expect(row.locator('.rosterwhen')).toHaveText(
          /^last filed |^nothing yet in our window$/,
        );
      }

      // And the feed below states what it is showing instead of narrowing in
      // silence.
      await expect(page.locator('#watch-feed-note')).toHaveText(
        /filings from these companies/,
      );

      // THE NARROWING ITSELF, PROVOKED THROUGH THE SAME SESSION. The page always
      // asks for 25 rows and no company in this collection holds enough filings
      // to push another off a page that size — measured 2026-08-09: 3,932
      // filings, and the busiest single company has 19 — so the browser cannot
      // be made to drop one. A page of ONE can: `data` loses a company and
      // `meta.watching` still carries both, which is the whole fix.
      const narrowed = await page.request.get('/api/watchlist/feed?limit=1');
      const body = (await narrowed.json()) as {
        data: Array<{ symbol: string }>;
        meta: { watching: Array<{ symbol: string }>; total: number };
      };
      expect(body.data).toHaveLength(1);
      expect(body.meta.total).toBeGreaterThan(1);
      expect(body.meta.watching.map((row) => row.symbol).sort()).toEqual(
        [loud, quiet].sort(),
      );

      // The star on a roster row takes the row with it, rather than leaving a
      // company the reader just dropped sitting in their watchlist until the
      // next poll notices.
      await page
        .locator(
          `#watch-roster [data-ui="watching-row"][data-symbol="${quiet}"] [data-ui="watch"]`,
        )
        .click();
      await expect(rows).toHaveCount(1);
    } finally {
      // Through the same route a person has, so the shared account goes back to
      // the empty watchlist every other test in this run assumes.
      for (const symbol of [loud, quiet]) {
        await page.request.delete(
          `/api/watchlist/${encodeURIComponent(symbol)}`,
          { headers: { Origin: origin() } },
        );
      }
    }

    expect(errors).toEqual([]);
  });

  test('says which of the two empties an empty Watching view is', async ({
    page,
  }) => {
    // "Nothing was found" and "nothing was looked for" must not read the same.
    // The shared account watches nothing, so this is the second sentence.
    await page.goto('/');
    await expect(page.locator('#live-text')).not.toHaveText('connecting');

    await page.locator('#tab-watching').click();

    await expect(page.locator('#watch-empty')).toContainText(
      'You are not watching anything yet',
    );
    // The roster, its note and the feed heading go with it — two headings over
    // an empty list is a page that looks broken rather than one with nothing
    // yet to show.
    await expect(page.locator('#watch-roster')).toBeHidden();
    await expect(page.locator('#watch-feed-head')).toBeHidden();
    await expect(page.locator('#watch-feed-note')).toBeHidden();
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

});
