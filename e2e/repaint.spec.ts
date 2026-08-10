import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * ================================================================
 * WHAT THE FOUR-SECOND POLL IS ALLOWED TO TAKE FROM A READER
 * ================================================================
 *
 * The page repaints every four seconds and, until the signature skip, it
 * rebuilt the feed, the operator table and the watch roster from scratch on
 * every one of them — whether or not a single byte had changed. A rebuilt node
 * is a different node, so a repaint took the reader's text selection with it,
 * dropped their hover, and closed any detail row they had opened. Reading a
 * filing takes longer than four seconds, which made the panel's one expandable
 * surface unusable.
 *
 * THE PAYLOAD IS PINNED HERE, and that is forcing a state rather than mocking
 * a fixture — the same move `brief.spec.ts` makes for the empty deck, for the
 * same reason: the ingest is live, so "the data did not change" cannot be
 * waited for on a market day, and it is the precondition of every assertion
 * below. The FIRST response is the real server's, captured and replayed
 * byte-for-byte afterwards, so what these tests run against is real data that
 * has been held still.
 *
 * The last test is the control: with the payload allowed to change, the feed
 * must still repaint. Without it, a signature that never moved would pass
 * everything above.
 */

type Held = { status: number; body: string; type: string };

/**
 * A PINNED PAYLOAD IS NOT YET A STILL SCREEN.
 *
 * `feedBucket` moves a filing out of 'Just now' thirty minutes after it was
 * disseminated, and that heading is deliberately part of the signature — so a
 * feed whose newest filing is 29 minutes old rebuilds, correctly, part way
 * through a test. On a market day a filing arrives every few seconds and there
 * is nearly always one about to cross, which made these tests fail on the
 * product working.
 *
 * Every filing is moved to a fixed 45 minutes old: past the boundary, and
 * staying past it. The only thing left moving on the screen is the relative
 * time each card prints, which is the thing under test.
 */
const holdDividersStill = (body: string): string => {
  const envelope = JSON.parse(body);
  if (!Array.isArray(envelope.data)) return body;
  const at = new Date(Date.now() - 45 * 60_000).toISOString();
  for (const item of envelope.data) item.disseminatedAt = at;
  return JSON.stringify(envelope);
};

/**
 * Replays every API response after the first, so the page goes idle.
 *
 * Returns the store, so a test can change what the server "says" mid-run.
 * `edit` sees the first real body and may rewrite it — used to place a filing
 * at a known age, which is not something a live collection can be asked for.
 */
const pinApi = async (
  page: Page,
  edit?: (url: string, body: string) => string,
): Promise<Map<string, Held>> => {
  const held = new Map<string, Held>();
  await page.route('**/api/**', async (route: Route) => {
    const url = route.request().url();
    const known = held.get(url);
    if (known) {
      await route.fulfill({
        status: known.status,
        contentType: known.type,
        body: known.body,
      });
      return;
    }
    const response = await route.fetch();
    const raw = await response.text();
    const text = url.includes('api/filings') ? holdDividersStill(raw) : raw;
    const fresh: Held = {
      status: response.status(),
      body: edit ? edit(url, text) : text,
      type: response.headers()['content-type'] ?? 'application/json',
    };
    held.set(url, fresh);
    await route.fulfill(fresh);
  });
  return held;
};

/**
 * The cold start is over, and the first paint that will not be revised is up.
 *
 * `api/me` is a request of its own, so a feed painted before it answers has no
 * watch star on any card — and legitimately rebuilds once when it lands, which
 * is the signature working rather than failing. The star existing IS that
 * having happened, so waiting for one is waiting for the page to stop being
 * new. Without this the tests below race the page's own first seconds and fail
 * on a rebuild the product owed the reader.
 */
const settled = async (page: Page): Promise<void> => {
  await expect(page.locator('#live-text')).not.toHaveText('connecting');
  await expect(page.locator('#feed [data-ui="watch"]').first()).toBeVisible();
};

/** Two full poll ticks and a margin, so a rebuild has had every chance. */
const TWO_TICKS = 9_000;

/** Marks a node so a later look can tell it apart from a rebuilt copy. */
const brand = async (page: Page, selector: string): Promise<void> => {
  await page
    .locator(selector)
    .evaluate((node) => ((node as HTMLElement).dataset.probe = 'kept'));
};

const stillTheSameNode = async (
  page: Page,
  selector: string,
): Promise<string | null> =>
  page.locator(selector).evaluate(
    (node) => (node as HTMLElement).dataset.probe ?? null,
  );

test.describe('the poll, on a screen that did not change', () => {
  test('leaves a text selection in a card standing', async ({ page }) => {
    // THE REPORTED SYMPTOM. A reader selecting a claim to paste into a message
    // lost the selection to the next tick, every four seconds, for good.
    await pinApi(page);
    await page.goto('/');
    await settled(page);

    const seq = await page
      .locator('#feed [data-ui="card"]')
      .first()
      .getAttribute('data-seq');
    // PINNED BY data-seq, never by position — the sharp edge in CLAUDE.md.
    const card = `#feed [data-seq="${seq}"]`;
    await brand(page, card);

    // Selected through the Range API rather than by dragging, because a drag
    // ends in a click and the card opens the focus dialog on one. The end
    // state is what a drag leaves behind and it is what the poll destroys.
    const selected = await page.locator(card).evaluate((node) => {
      const target = node.querySelector('.coname') ?? node;
      const range = document.createRange();
      range.selectNodeContents(target);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      return selection?.toString() ?? '';
    });
    expect(selected.length).toBeGreaterThan(0);

    await page.waitForTimeout(TWO_TICKS);

    expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe(
      selected,
    );
    // The selection surviving is only meaningful if the node did: a rebuilt
    // card carries no probe, because the probe was set on the one that is gone.
    expect(await stillTheSameNode(page, card)).toBe('kept');
    await expect(page.locator('#alert')).toBeHidden();
  });

  test('still advances the relative time, without rebuilding the card', async ({
    page,
  }) => {
    // THE COST OF SKIPPING, PAID. "a minute ago" is read against the browser's
    // clock, so it is wrong a minute later whether or not the filing changed.
    // The newest filing is placed at 80 seconds old — `relativeTime` says "a
    // minute ago" below 90 and "2 min ago" above it — so the boundary falls
    // ten seconds into the test rather than whenever the collection allows.
    await pinApi(page, (url, body) => {
      if (!url.includes('api/filings')) return body;
      const envelope = JSON.parse(body);
      if (!Array.isArray(envelope.data) || envelope.data.length === 0) {
        return body;
      }
      envelope.data[0].disseminatedAt = new Date(
        Date.now() - 80_000,
      ).toISOString();
      return JSON.stringify(envelope);
    });

    await page.goto('/');
    await settled(page);
    const seq = await page
      .locator('#feed [data-ui="card"]')
      .first()
      .getAttribute('data-seq');
    const card = `#feed [data-seq="${seq}"]`;

    await expect(page.locator(`${card} .when`)).toHaveText('a minute ago');
    await brand(page, card);

    await expect(page.locator(`${card} .when`)).toHaveText('2 min ago', {
      timeout: 20_000,
    });
    // WRITTEN IN PLACE. If the time only moved because the card was rebuilt,
    // this is a different node and the whole exercise was pointless.
    expect(await stillTheSameNode(page, card)).toBe('kept');
  });

  test('leaves an open detail row open in the operator table', async ({
    page,
  }) => {
    await pinApi(page);
    await page.goto('/');
    await settled(page);

    const built = (await page.locator('#tab-admin').count()) > 0;
    // The panel is absent on a host built without it, and this is a test about
    // the panel. See `admin.spec.ts` for why the suite reads the mode.
    test.skip(!built, 'the dashboard under test was built without the panel');

    await page.locator('#tab-admin').click();
    const row = page.locator('#rows tr[data-seq]').first();
    const seq = await row.getAttribute('data-seq');
    const detail = page.locator(`#rows tr[data-seq="${seq}"] + tr.detail`);

    await expect(detail).toBeHidden();
    await row.click();
    await expect(detail).toBeVisible();

    // THE BUG THIS FIXES: the rebuild replaced the row and its detail together,
    // so the box closed on the next tick and could not be read.
    await page.waitForTimeout(TWO_TICKS);
    await expect(detail).toBeVisible();
    await expect(page.locator('#alert')).toBeHidden();
  });

  test('does not skip into a container something else emptied', async ({
    page,
  }) => {
    // THE ONE WAY A SIGNATURE CAN LIE. `renderWatching` empties `#watch-feed`
    // itself when the watchlist goes empty, so the signature describing the
    // cards that WERE there would outlive them — and watching the same company
    // again produces an identical payload, which would match and skip into a
    // container somebody else had cleared. Silent, and permanent until the
    // watchlist filed something new.
    //
    // The watchlist is taken away and given back rather than pressed twice:
    // the throwaway account watches nothing, and the empty state is the
    // precondition rather than the subject.
    const real = await page.request.get('api/filings?limit=3&offset=0');
    const body = await real.json();
    const items = (body.data as Record<string, string>[]).slice(0, 3);
    expect(items.length).toBeGreaterThan(0);

    const envelope = (rows: Record<string, string>[]): string =>
      JSON.stringify({
        success: true,
        data: rows,
        error: null,
        meta: {
          total: rows.length,
          limit: 25,
          offset: 0,
          returned: rows.length,
          hasMore: false,
          watching: rows.map((row) => ({
            symbol: row.symbol,
            companyName: row.companyName,
            lastFiledAt: row.disseminatedAt,
            lastFiledAtIst: row.disseminatedAtIst,
          })),
        },
      });

    let watching = true;
    await page.route('**/api/watchlist/feed*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: envelope(watching ? items : []),
      }),
    );

    await page.goto('/');
    // Quiet first. `state.limit` is in the signature and the feed grows itself
    // once on load when Load more starts in view, so a tab clicked into that
    // moment would see the signature move for a reason that is not the bug.
    await settled(page);
    await page.waitForTimeout(5_000);

    await page.locator('#tab-watching').click();
    await expect(page.locator('#watch-feed [data-ui="card"]').first()).toBeVisible();

    watching = false;
    await expect(page.locator('#watch-empty')).toBeVisible();
    await expect(page.locator('#watch-feed [data-ui="card"]')).toHaveCount(0);

    // Byte-for-byte the payload that was drawn the first time.
    watching = true;
    await expect(page.locator('#watch-feed [data-ui="card"]').first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test('repaints as soon as the data does change', async ({ page }) => {
    // THE CONTROL. Everything above is satisfied by a page that never repaints
    // at all, which would be a far worse bug than the one being fixed.
    const held = await pinApi(page);
    await page.goto('/');
    await page.waitForSelector('#feed [data-ui="card"]');
    const first = page.locator('#feed [data-ui="card"]').first();
    const seq = await first.getAttribute('data-seq');
    expect(seq).toBeTruthy();

    // The same response with its newest filing dropped, which is what the feed
    // looks like from four seconds earlier.
    for (const [url, body] of held) {
      if (!url.includes('api/filings')) continue;
      const envelope = JSON.parse(body.body);
      if (!Array.isArray(envelope.data) || envelope.data.length < 2) continue;
      envelope.data.shift();
      held.set(url, { ...body, body: JSON.stringify(envelope) });
    }

    await expect(page.locator('#feed [data-ui="card"]').first()).not.toHaveAttribute(
      'data-seq',
      seq ?? '',
      { timeout: 15_000 },
    );
  });
});
