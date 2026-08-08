import { expect, test, type Page } from '@playwright/test';

/**
 * What a signed-out visitor actually gets, in a browser, against the live
 * database.
 *
 * WHY THIS CANNOT BE A STRING TEST. `landing.spec.ts` (Jest) proves the rendered
 * document contains no fetch and no API path. It cannot prove that the running
 * server, pointed at a collection with real filings in it, hands an anonymous
 * browser that document and nothing else — which is the founder's decision and
 * the only claim worth making here. A signed-out visitor performing even one
 * read would be a hole in the gate that every string assertion would sail past.
 */

/** SIGNED OUT ON PURPOSE, against the config's signed-in default. */
test.use({ storageState: { cookies: [], origins: [] } });

/** Fails the test if the page logged an uncaught error, whatever else it did. */
const watchConsole = (page: Page): string[] => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
};

test.describe('signed out', () => {
  test('lands on the landing page, with its examples labelled', async ({
    page,
  }) => {
    const errors = watchConsole(page);
    await page.goto('/');

    await expect(page.locator('h1.h1')).toContainText(
      'See what companies actually told the exchange',
    );
    await expect(page.locator('[data-ui="sample-notice"]')).toContainText(
      'These are examples, not filings.',
    );
    await expect(page.locator('[data-ui="sample-card"]')).toHaveCount(3);
    // One badge per card, and no others: a screenshot of one card still says so.
    await expect(page.locator('.exbadge')).toHaveCount(3);
    expect(errors).toEqual([]);
  });

  test('shows every line with the sentence it came from', async ({ page }) => {
    // The point of the page. A line without the document's own words under it
    // is a headline, and every product in this space ships headlines.
    await page.goto('/');

    const quotes = page.locator('[data-ui="sample-card"] .span');
    expect(await quotes.count()).toBeGreaterThan(0);
    await expect(quotes.first()).toContainText("the company's own words");
  });

  test("says nothing to a reader in this project's own vocabulary", async ({
    page,
  }) => {
    // The Jest suite asserts this against the rendered string. This asserts it
    // against what a browser actually lays out, which is the thing a stranger
    // reads — and it is the check that would catch copy arriving from somewhere
    // other than landing.ts.
    await page.goto('/');

    const words = await page.locator('body').innerText();

    for (const ours of ['span', 'claim', 'verbatim', 'gate', 'pipeline']) {
      expect([ours, new RegExp(`\\b${ours}\\b`, 'i').test(words)]).toEqual([
        ours,
        false,
      ]);
    }
  });

  test('draws the logo, and takes its icon from the document', async ({
    page,
  }) => {
    // The mark is inline SVG that inherits its colour from the text around it —
    // a string test cannot tell drawn from merely present, and a browser can.
    await page.goto('/');

    const mark = page.locator('[data-ui="brand-logo"] svg.logomark');
    await expect(mark).toBeVisible();
    expect(await mark.boundingBox()).not.toBeNull();
    await expect(page.locator('[data-ui="brand-logo"]')).toContainText(
      'Disclosed.',
    );

    const icon = await page
      .locator('link[rel="icon"]')
      .getAttribute('href', { timeout: 5000 });
    expect(icon?.startsWith('data:image/svg+xml,')).toBe(true);
  });

  test('performs no read: nothing from the collection reaches the page', async ({
    page,
  }) => {
    // THE ASSERTION THE WHOLE GATE IS FOR, and it is made two ways.
    //
    // First: the browser is watched, and no request to an api path may leave
    // it. Second: a real symbol is pulled from the live collection through a
    // signed-in request, and the signed-out document is searched for it. The
    // first catches a fetch that was added; the second catches data that
    // arrived some other way — server-rendered into the shell, say.
    const asked: string[] = [];
    page.on('request', (req) => {
      const path = new URL(req.url()).pathname;
      if (path.startsWith('/api/')) asked.push(path);
    });

    await page.goto('/');
    await page.waitForTimeout(5000);

    expect(asked).toEqual([]);

    const html = await page.content();
    expect(html).not.toContain('id="feed"');
    expect(html).not.toContain('<table');
  });

  test('refuses every read route it could be asked for', async ({ page }) => {
    await page.goto('/');

    for (const path of [
      '/api/summary',
      '/api/filings?limit=1',
      '/api/suggest?q=rel',
      '/api/categories',
      '/api/daily?days=3',
      '/api/watchlist',
    ]) {
      const response = await page.request.get(path);
      expect([path, response.status()]).toEqual([path, 401]);
    }
  });

  test('leaves the health probe open, because a monitor has no credential', async ({
    page,
  }) => {
    const response = await page.request.get('/api/health');

    expect(response.status()).toBe(200);
    // AND SAYS NOTHING ELSE. A probe returning a build string or a count is
    // reconnaissance available to anyone who can reach the port.
    expect(await response.json()).toEqual({
      success: true,
      data: { status: 'ok' },
      error: null,
      meta: null,
    });
  });

  test('offers exactly one way in, and it goes to the sign-in page', async ({
    page,
  }) => {
    await page.goto('/');

    const hrefs = await page
      .locator('a')
      .evaluateAll((nodes) =>
        nodes.map((node) => (node as HTMLAnchorElement).getAttribute('href')),
      );
    expect([...new Set(hrefs)]).toEqual(['/auth']);

    await page.locator('[data-ui="signin-hero"]').click();
    await expect(page).toHaveURL(/\/auth$/);
    await expect(page.locator('#auth-form')).toBeVisible();
  });

  test('reads on a phone without scrolling sideways', async ({ page }) => {
    // Phone-first is the claim; a body wider than its viewport is how that
    // claim usually turns out to be false.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await expect(page.locator('[data-ui="signin-hero"]')).toBeVisible();
  });
});
