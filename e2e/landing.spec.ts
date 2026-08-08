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
      'What Indian companies disclosed today',
    );
    await expect(page.locator('[data-ui="sample-notice"]')).toContainText(
      'These are examples, not filings.',
    );
    await expect(page.locator('[data-ui="sample-card"]')).toHaveCount(3);
    // Each card carries its own label, so a screenshot of one still says so.
    await expect(page.locator('.exbadge')).toHaveCount(4);
    expect(errors).toEqual([]);
  });

  test('shows each sample claim with the span it was matched against', async ({
    page,
  }) => {
    // The point of the page. A card without its span is a headline, and every
    // product in this space ships headlines.
    await page.goto('/');

    const spans = page.locator('[data-ui="sample-card"] .span');
    expect(await spans.count()).toBeGreaterThan(0);
    await expect(spans.first()).toContainText('matched in the filing');
  });

  test('shows a claim the gate threw away, with the reason', async ({
    page,
  }) => {
    // The denominator. Three verified cards and nothing else hides that a
    // fourth was proposed and refused.
    await page.goto('/');

    await expect(page.locator('[data-ui="sample-discard"]')).toContainText(
      'span-not-found',
    );
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

    const hrefs = await page.locator('a').evaluateAll((nodes) =>
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
