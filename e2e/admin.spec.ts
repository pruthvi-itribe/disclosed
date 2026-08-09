import { expect, test, type Page } from '@playwright/test';

/**
 * The operator panel, in whichever mode the server under test was started in.
 *
 * ================================================================
 * WHY THIS SPEC READS THE MODE RATHER THAN SETTING IT
 * ================================================================
 *
 * `ADMIN_ENABLED` is decided at boot and the suite runs against ONE already
 * running dashboard — there is no way for a browser test to restart it, and a
 * spec that only ran under one setting would leave the other unproven in a
 * browser for good. So this asks the served document which host it is talking
 * to and then holds that host to the whole of its own contract.
 *
 * Both branches are real and both are exercised in CI by running the suite
 * twice; `page.spec.ts` and `dashboard.controller.spec.ts` prove the two
 * documents and the two routing tables without a browser at all. What only a
 * browser can say is the thing that actually broke pages here before: whether
 * the script RUNS. Six `<select>` elements and four buttons live inside the
 * Admin section, and `el('limit').value` on a missing node is a TypeError
 * thrown at load in the one scope the feed, the deck and the search box share.
 * A string test cannot tell a page that renders from a page that merely parses.
 */

/** Errors the poll caught and reported, which no `pageerror` listener sees. */
const watchAlert = async (page: Page): Promise<void> => {
  await expect(page.locator('#alert')).toBeHidden();
};

const adminIsBuilt = async (page: Page): Promise<boolean> =>
  (await page.locator('#tab-admin').count()) > 0;

test.describe('the operator panel', () => {
  test('is consistent with itself: tab, section, and the three routes', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(String(error)));

    await page.goto('/');
    await expect(page.locator('#live-text')).not.toHaveText('connecting');

    const built = await adminIsBuilt(page);

    // THE PAGE AND THE ROUTING TABLE MUST AGREE. A document without the tab
    // whose routes still answered would be the surface removed and the data
    // left behind it; a document with the tab whose routes 404 is a panel that
    // paints a red banner over a working feed every slow cycle.
    for (const route of ['api/enrichment', 'api/categories', 'api/daily']) {
      const response = await page.request.get(route);
      expect([route, response.status()]).toEqual([route, built ? 200 : 404]);
    }

    // The section follows the tab, both ways.
    await expect(page.locator('#view-admin')).toHaveCount(built ? 1 : 0);
    await expect(page.locator('#rows')).toHaveCount(built ? 1 : 0);
    await expect(page.locator('#limit')).toHaveCount(built ? 1 : 0);

    expect(errors).toEqual([]);
    await watchAlert(page);
  });

  test('leaves the reader views working either way', async ({ page }) => {
    // THE ASSERTION THE WHOLE FLAG RISKS. The filter selects the feed's own
    // code reads live inside the Admin section, so switching the panel off is
    // the change most likely to take the product down with it.
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(String(error)));

    await page.goto('/');
    await expect(page.locator('#live-text')).not.toHaveText('connecting');
    await expect(page.locator('#feed .card')).not.toHaveCount(0);

    // The search box still drives the feed, and a ticker still answers with
    // that company — the two things a reader does most.
    await page.locator('#symbol').fill('MOTHERSON');
    await page.locator('#symbol').press('Enter');
    await expect(page.locator('#feed .card button.sym').first()).toHaveText(
      'MOTHERSON',
    );

    // The insight toggle is the feed's own control and writes the same state
    // the missing `#tier` select would have.
    await page.locator('#only-insights').uncheck();
    await expect(page.locator('#feed .card')).not.toHaveCount(0);

    // Both other reader views still open.
    await page.locator('#tab-brief').click();
    await expect(page.locator('#view-brief')).toBeVisible();
    await page.locator('#tab-feed').click();
    await expect(page.locator('#view-feed')).toBeVisible();

    expect(errors).toEqual([]);
    await watchAlert(page);
  });

  test('survives a slow cycle without asking for a route that is not there', async ({
    page,
  }) => {
    // The three panel reads ride the slow cycle rather than the four-second
    // one, so a 404 from them takes longer than a normal test to appear — and
    // it appears as a red banner over a feed that is working perfectly.
    const notFound: string[] = [];
    page.on('response', (response) => {
      if (response.status() === 404) notFound.push(response.url());
    });

    await page.goto('/');
    await expect(page.locator('#live-text')).not.toHaveText('connecting');
    await page.waitForTimeout(9_000);

    expect(notFound).toEqual([]);
    await watchAlert(page);
    await expect(page.locator('#live-text')).toHaveText('live');
  });
});
