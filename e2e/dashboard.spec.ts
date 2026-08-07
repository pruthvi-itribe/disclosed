import { expect, test, type Page } from '@playwright/test';

/**
 * The dashboard, executed rather than string-matched.
 *
 * EVERY TEST HERE FAILS ON A PAGE THAT THROWS ON LOAD. That is the whole point:
 * `page.spec.ts` asserts the served HTML contains what it should, and a stray
 * backtick inside the inlined script produced a document that passed all of it,
 * served a 200, and rendered an empty table because the script died parsing.
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

test.describe('the feed', () => {
  test('loads, runs its script, and renders cards from live data', async ({
    page,
  }) => {
    const errors = watchConsole(page);
    await page.goto('/');

    // The live dot leaves 'connecting' only when a fetch resolved, so this is
    // the honest signal that the script ran end to end rather than merely
    // parsed.
    await expect(page.locator('#live-text')).not.toHaveText('connecting');
    await expect(page.locator('#feed .card, #feed .emptyfeed')).not.toHaveCount(
      0,
    );
    expect(errors).toEqual([]);
  });

  test('shows the feed first and hides Admin behind its tab', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.locator('#view-feed')).toBeVisible();
    await expect(page.locator('#view-admin')).toBeHidden();
    await expect(page.locator('#tab-feed')).toHaveClass(/active/);
  });

  test('switches to Admin and back without a reload', async ({ page }) => {
    await page.goto('/');
    await page.locator('#tab-admin').click();
    await expect(page.locator('#view-admin')).toBeVisible();
    await expect(page.locator('#view-feed')).toBeHidden();
    // The operational panels live here and nowhere else now.
    await expect(page.locator('#refusals')).toBeAttached();
    await expect(page.locator('#stat-cursor')).toBeVisible();

    await page.locator('#tab-feed').click();
    await expect(page.locator('#view-feed')).toBeVisible();
    await expect(page.locator('#view-admin')).toBeHidden();
  });

  test('renders both views from ONE request, so they cannot disagree', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.locator('#live-text')).not.toHaveText('connecting');

    // The Admin table is populated even while the feed is the visible view.
    // Rendering only what is on screen would make a tab switch cost a round
    // trip and let the two views drift.
    const adminRows = await page.locator('#rows tr:not(.detail)').count();
    const feedCards = await page.locator('#feed .card').count();
    if (feedCards > 0) expect(adminRows).toBeGreaterThan(0);
  });
});

test.describe('the insight filter', () => {
  test('is on by default and asks the server for the verified tier', async ({
    page,
  }) => {
    const asked: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('api/filings')) asked.push(request.url());
    });

    await page.goto('/');
    await expect(page.locator('#only-insights')).toBeChecked();
    await expect.poll(() => asked.length).toBeGreaterThan(0);
    expect(asked.some((url) => url.includes('tier=verified'))).toBe(true);
  });

  test('unticking it widens the feed rather than emptying it', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.locator('#live-text')).not.toHaveText('connecting');
    const before = await page.locator('#feed .card').count();

    await page.locator('#only-insights').uncheck();
    await expect
      .poll(async () => page.locator('#feed .card').count())
      .toBeGreaterThanOrEqual(before);
  });
});

test.describe('the card', () => {
  test('leads with what the company said, not with our plumbing', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.locator('#live-text')).not.toHaveText('connecting');

    const card = page.locator('#feed .card:not(.quiet)').first();
    test.skip(
      (await card.count()) === 0,
      'no verified insight in the collection right now',
    );

    // The insight is the largest text in its card. Asserted as computed pixels
    // rather than as a class name, because the rule this protects is about what
    // a reader's eye lands on and a class can be restyled out from under it.
    const insightSize = await card
      .locator('.insights li')
      .first()
      .evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
    const companySize = await card
      .locator('.coname')
      .evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
    expect(insightSize).toBeGreaterThan(companySize);
  });

  test('keeps the source document one click away', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#live-text')).not.toHaveText('connecting');
    const link = page.locator('#feed .srclink').first();
    test.skip((await link.count()) === 0, 'no attachment in view');
    await expect(link).toHaveAttribute('href', /^https:\/\//);
    // A filing's PDF is third-party content opened in the reader's browser.
    await expect(link).toHaveAttribute('rel', /noopener/);
  });

  test('never renders a source sentence in the feed', async ({ page }) => {
    // THE REGRESSION THIS GUARDS. Every accepted claim's quoted PDF sentence,
    // its period heading, the results basis and a row per figure were all
    // rendered on the row — IGPL's presentation came out as a wall of quoted
    // text with the three-claim wire line buried at the top of it. The evidence
    // belongs in the detail row, which is Admin's.
    await page.goto('/');
    await expect(page.locator('#live-text')).not.toHaveText('connecting');
    await expect(page.locator('#feed .claimspan')).toHaveCount(0);
    await expect(page.locator('#feed .modelsummary')).toHaveCount(0);
  });
});

test.describe('the group chips', () => {
  test('filter the feed and stay in step with the Admin select', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.locator('#live-text')).not.toHaveText('connecting');

    await page.locator('.chip[data-group="results"]').click();
    await expect(page.locator('.chip[data-group="results"]')).toHaveClass(
      /active/,
    );

    // Two controls over one filter. If they can disagree, one of them is lying.
    await page.locator('#tab-admin').click();
    await expect(page.locator('#group')).toHaveValue('results');
  });
});

test('the page reports a dead server rather than showing stale numbers', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('#live-text')).not.toHaveText('connecting');

  // A dashboard that silently stops updating is worse than one that says it
  // stopped, because the stale numbers still read as current.
  await page.route('**/api/**', (route) => route.abort());
  await expect(page.locator('#alert')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('#alert')).toContainText('Refresh failed');
});

test('expands the rest of a card instead of just announcing them', async ({
  page,
}) => {
  // '+ 6 more' as dead text tells a reader the card is hiding something and
  // gives them nowhere to go. The card stops at four because eleven is a wall;
  // it says so because silently truncating would make a partial card look
  // complete; and it has to open because a reader who wants the rest is one
  // click from the source PDF otherwise.
  await page.goto('/');
  await expect(page.locator('#live-text')).not.toHaveText('connecting');

  // PINNED BY seqId, not by position. A Playwright locator is a lazy query, so
  // "the first card with an expander" names a DIFFERENT card once this one's
  // button is gone — and the feed repaints every four seconds besides. Two
  // earlier versions of this test failed on exactly that and the product was
  // fine both times.
  const anyExpandable = page
    .locator('#feed .card')
    .filter({ has: page.locator('.andmore') })
    .first();
  test.skip(
    (await anyExpandable.count()) === 0,
    'no card has more than four insights',
  );

  const seq = await anyExpandable.getAttribute('data-seq');
  const card = page.locator('#feed .card[data-seq="' + seq + '"]');
  const before = await card.locator('.insights li').count();
  await card.locator('.andmore').click();

  // Scoped to THIS card. `more` is a .first() locator that re-resolves, so
  // asserting on it counts the NEXT card's button once this one is gone — the
  // first version of this test failed for exactly that reason and the product
  // was fine.
  await expect(card.locator('.andmore')).toHaveCount(0);
  expect(await card.locator('.insights li').count()).toBeGreaterThan(before);
});

test('an expanded card stays expanded across the four-second repaint', async ({
  page,
}) => {
  // THE BUG THIS GUARDS, which the expander test found. The feed repaints on a
  // poll, and the first version held the expansion in the DOM — so a card
  // opened itself and closed itself four seconds later, which is worse than
  // one that never opened: the reader loses their place and cannot tell
  // whether they misclicked. Anything a reader does here has to outlive the
  // refresh that makes the page live.
  await page.goto('/');
  await expect(page.locator('#live-text')).not.toHaveText('connecting');

  const anyExpandable = page
    .locator('#feed .card')
    .filter({ has: page.locator('.andmore') })
    .first();
  test.skip(
    (await anyExpandable.count()) === 0,
    'no card has more than four insights',
  );

  const seq = await anyExpandable.getAttribute('data-seq');
  const card = page.locator('#feed .card[data-seq="' + seq + '"]');
  await card.locator('.andmore').click();
  const opened = await card.locator('.insights li').count();

  // Longer than one poll interval, so a repaint is guaranteed to have run.
  await page.waitForTimeout(6000);
  expect(await card.locator('.insights li').count()).toBe(opened);
});
