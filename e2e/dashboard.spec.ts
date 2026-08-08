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

  test('marks a printed movement, quotes it, and colours nothing', async ({
    page,
  }) => {
    // Executed rather than string-matched: the glyph, its accessible name, the
    // quote in its title and the absence of colour are four separate ways this
    // could ship broken while every unit test still passed.
    await page.goto('/');
    await expect(page.locator('#live-text')).not.toHaveText('connecting');

    const mark = page.locator('#feed [data-ui="claim-direction"]').first();
    test.skip(
      (await mark.count()) === 0,
      'no claim in view carries a printed movement',
    );

    // PINNED BY data-seq, not by position: the feed repaints every four
    // seconds and "the first mark" names a different node after a repaint.
    const seq = await mark
      .locator('xpath=ancestor::article[@data-ui="card"]')
      .getAttribute('data-seq');
    const pinned = page
      .locator('#feed .card[data-seq="' + seq + '"] [data-ui="claim-direction"]')
      .first();

    await expect(pinned).toHaveText(/[▲▼◆]/);
    await expect(pinned).toHaveAttribute(
      'aria-label',
      /(increase|decrease|both) printed/,
    );
    await expect(pinned).toHaveAttribute(
      'title',
      /^Printed in the document: ".+"$/,
    );

    // THE COLOUR DECISION, ASSERTED ON THE RENDERED PIXEL. 13 of the 45 marked
    // decreases in the collection are falling bad loans, debt, borrowing costs
    // or emissions, so a red triangle would be wrong on more than a quarter of
    // them. The mark is the same colour as the sentence it sits in.
    const colours = await pinned.evaluate((node) => ({
      mark: getComputedStyle(node).color,
      line: getComputedStyle(
        node.closest('li') ?? node.parentElement ?? node,
      ).color,
    }));
    expect(colours.mark).toBe(colours.line);

    // And the legend that explains it is on screen with it.
    await expect(page.locator('#dir-legend')).toBeVisible();
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
  test('are gone from the feed, leaving the group filter to Admin', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.locator('#live-text')).not.toHaveText('connecting');

    // THE FEED'S GROUP CHIPS ARE GONE. They were a worse version of the topic
    // row beside them — measured over the whole collection, topic `financial`
    // finds 368 filings against group `results` 152 — and two rows carrying a
    // chip named "Results" one line apart, returning different sets, is a trap
    // rather than a second axis. The group filter lives in Admin now.
    await expect(page.locator('#view-feed .chip[data-group]')).toHaveCount(0);
    await page.locator('#tab-admin').click();
    await expect(page.locator('#group')).toBeVisible();
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

test.describe('the company page', () => {
  test('opens from a card symbol and states what it was computed over', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(String(error)));

    await page.goto('/');
    await expect(page.locator('#live-text')).not.toHaveText('connecting');
    await page.locator('#feed .card button.sym').first().click();

    await expect(page.locator('#view-company')).toBeVisible();
    await expect(page.locator('#view-feed')).toBeHidden();
    await expect(page.locator('#co-symbol')).not.toBeEmpty();

    // THE COVERAGE LINE IS THE POINT. Measured 2026-08-07, 460 of 960 companies
    // had filed exactly once and the collection held four IST days — so every
    // number on this page is computed over a window the reader has to be told
    // about. context-line.ts settled the principle: a claim about thirty days,
    // made by a database holding four, is every word true and the whole
    // sentence false.
    await expect(page.locator('#co-coverage')).toContainText('filings held');
    await expect(page.locator('#co-coverage')).toContainText('IST day');

    await expect(page.locator('#co-strip .stripday')).not.toHaveCount(0);
    await expect(page.locator('#company-feed .card')).not.toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('suppresses the group mix below five filings', async ({ page }) => {
    // A stacked bar over one observation is a single colour claiming to be a
    // distribution. That the widget is usually absent is the widget working.
    await page.goto('/');
    await expect(page.locator('#live-text')).not.toHaveText('connecting');
    await page.locator('#feed .card button.sym').first().click();
    await expect(page.locator('#co-symbol')).not.toBeEmpty();

    const filings = Number(
      (await page.locator('#co-filings').textContent())?.replace(/[^0-9]/g, ''),
    );
    const shown = await page.locator('#co-mix-wrap').isVisible();
    expect(shown).toBe(filings >= 5);
  });

  test('draws the topic mix on the claims, not on the filings', async ({
    page,
  }) => {
    // THE TWO BARS ANSWER DIFFERENT QUESTIONS and are floored on different
    // units, which is why this is not the group-mix test with a new selector.
    // "What they file" counts filings; "what they say" counts the claims inside
    // them, and the counts are only loosely related — CAPACITE holds 23 claims
    // across 2 filings, so a filing floor would hide the company with the most
    // to say. Measured over the 547 companies holding a claim, 257 clear four
    // claims against 128 that clear five filings.
    await page.goto('/');
    await expect(page.locator('#live-text')).not.toHaveText('connecting');
    await page.locator('#feed .card button.sym').first().click();
    await expect(page.locator('#co-symbol')).not.toBeEmpty();

    const claims = await page
      .locator('#company-feed .insights li')
      .count()
      .catch(() => 0);
    const shown = await page.locator('#co-topics-wrap').isVisible();
    // The cards cap what they DISPLAY at two claims apiece, so the count above
    // is a floor on the real total rather than the total. It can therefore only
    // prove the bar should be there, never that it should not.
    if (claims >= 4) expect(shown).toBe(true);

    if (!shown) return;
    const segments = page.locator('#co-topics .mixseg');
    await expect(segments).not.toHaveCount(0);
    // Every segment names its topic and its count, so the colour never has to
    // be decoded from the legend alone.
    await expect(segments.first()).toHaveAttribute('title', /claim\(s\)/);
    // At most three entries, because a legend the width of the bar is a table.
    expect(await page.locator('#co-topics-legend .mixitem').count()).toBeLessThanOrEqual(3);
  });

  test('drops a feed response that lands after a ticker click', async ({
    page,
  }) => {
    // THE RACE: the filings callback decides which view to draw by reading
    // state at RESPONSE time. A poll request sent just before the click has no
    // symbol filter, so if its response is allowed to render after
    // openCompany(), the company page repaints as the ENTIRE feed wearing one
    // company's heading. Fetch promises nothing about ordering, so this is
    // reproduced by delaying exactly that response.
    await page.goto('/');
    await expect(page.locator('#live-text')).not.toHaveText('connecting');

    // From here on, feed-shaped requests (no symbol) crawl; company-shaped
    // ones (symbol=...) pass at full speed.
    await page.route('**/api/filings*', async (route) => {
      if (!route.request().url().includes('symbol=')) {
        await new Promise((resolve) => setTimeout(resolve, 1_500));
      }
      await route.continue();
    });

    // Wait for the poll tick to fire a (now slow) feed request, then click a
    // ticker while it is in flight.
    await page.waitForTimeout(4_100);
    const symbol = (
      await page.locator('#feed .card button.sym').first().textContent()
    )?.trim();
    await page.locator('#feed .card button.sym').first().click();
    await expect(page.locator('#co-symbol')).toHaveText(symbol ?? '');

    // Let the stale feed response land, then check it changed nothing: every
    // card on the company page still belongs to the company.
    await page.waitForTimeout(2_000);
    const symbols = await page
      .locator('#company-feed .card button.sym')
      .allTextContents();
    expect(symbols.length).toBeGreaterThan(0);
    expect(new Set(symbols.map((s) => s.trim()))).toEqual(new Set([symbol]));
  });

  test('does not repeat the company identity on every card', async ({
    page,
  }) => {
    // On a page headed GODREJCP, six cards each reading "GODREJCP Godrej
    // Consumer Products Limited" is six lines answering a question the heading
    // already answered.
    await page.goto('/');
    await expect(page.locator('#live-text')).not.toHaveText('connecting');
    await page.locator('#feed .card button.sym').first().click();
    await expect(page.locator('#company-feed .card')).not.toHaveCount(0);
    await expect(page.locator('#company-feed .who').first()).toBeHidden();
  });

  test('goes back to the feed', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#live-text')).not.toHaveText('connecting');
    await page.locator('#feed .card button.sym').first().click();
    await expect(page.locator('#view-company')).toBeVisible();

    await page.locator('#company-back').click();
    await expect(page.locator('#view-feed')).toBeVisible();
    await expect(page.locator('#view-company')).toBeHidden();
  });
});

test.describe('load more', () => {
  test('loads the next step when the button scrolls into view', async ({
    page,
  }) => {
    // The button is its own sentinel: entering the viewport is the click. One
    // step per entry — the new cards push it back out, so the next request is
    // the reader reaching it again, not a loop.
    await page.goto('/');
    await expect(page.locator('#live-text')).not.toHaveText('connecting');
    const more = page.locator('#feed-more');
    if (await more.isHidden()) return; // not enough rows to page at all
    const before = await page.locator('#feed .card').count();
    await more.scrollIntoViewIfNeeded();
    await expect
      .poll(async () => page.locator('#feed .card').count(), { timeout: 8_000 })
      .toBeGreaterThan(before);
    // And the limit select still holds a real option.
    expect(['50', '100', '200']).toContain(
      await page.locator('#limit').inputValue(),
    );
  });

  test('grows through values the limit select can hold', async ({ page }) => {
    // The limit is TWO controls over one filter: this button, and a select in
    // Admin holding 25/50/100/200. Growing by +25 assigned the select 75,
    // which a select with no such option answers by BLANKING — and the next
    // filter change read Number('') || DEFAULT_LIMIT and silently snapped the
    // feed back to 25 under the reader.
    await page.goto('/');
    await expect(page.locator('#live-text')).not.toHaveText('connecting');

    const more = page.locator('#feed-more');
    if (await more.isHidden()) return; // fewer filings than one page holds
    await more.click();
    await more.click();

    const value = await page.locator('#limit').inputValue();
    expect(['50', '100', '200']).toContain(value);
    expect(value).not.toBe('');
  });
});

test.describe('the topic chips', () => {
  test('filter by what a filing SAID, not what kind it is', async ({
    page,
  }) => {
    // The two rows ask different questions and both are right: a dividend
    // declaration arrives as an Outcome of Board Meeting (group `results`) and
    // says something about a payout (topic `dividend`). Before topics existed
    // there was no way to ask the second — 67% of claims sat under one kind.
    const asked: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('api/filings')) asked.push(r.url());
    });

    await page.goto('/');
    await expect(page.locator('#live-text')).not.toHaveText('connecting');

    await page.locator('.chip[data-topic="dividend"]').click();
    await expect(page.locator('.chip[data-topic="dividend"]')).toHaveClass(
      /active/,
    );
    await expect
      .poll(() => asked.some((url) => url.includes('topic=dividend')))
      .toBe(true);
    await expect(page.locator('#feed .card, #feed .emptyfeed')).not.toHaveCount(
      0,
    );
  });

  test('Clear resets the topic row too', async ({ page }) => {
    // A Clear that left one chip lit would leave the feed narrowed by a control
    // the reader believes they just reset.
    await page.goto('/');
    await expect(page.locator('#live-text')).not.toHaveText('connecting');
    await page.locator('.chip[data-topic="financial"]').click();
    await expect(page.locator('.chip[data-topic="financial"]')).toHaveClass(
      /active/,
    );

    await page.locator('#tab-admin').click();
    await page.locator('#clear').click();
    await page.locator('#tab-feed').click();
    await expect(page.locator('.chip[data-topic=""]')).toHaveClass(/active/);
    await expect(page.locator('.chip[data-topic="financial"]')).not.toHaveClass(
      /active/,
    );
  });
});

test.describe('the feed layout', () => {
  test('fills the width with columns instead of one card per row', async ({
    page,
  }) => {
    // A card carrying a single short claim is a full-width strip of mostly
    // empty space on anything wider than a laptop, and at ~2.4 claims a filing
    // most cards are three lines tall.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await expect(page.locator('#live-text')).not.toHaveText('connecting');

    const columns = await page
      .locator('#feed')
      .evaluate(
        (node) =>
          getComputedStyle(node).gridTemplateColumns.split(' ').length,
      );
    expect(columns).toBeGreaterThan(1);
  });

  test('collapses to a single column on a narrow screen', async ({ page }) => {
    await page.setViewportSize({ width: 560, height: 900 });
    await page.goto('/');
    await expect(page.locator('#live-text')).not.toHaveText('connecting');

    const columns = await page
      .locator('#feed')
      .evaluate(
        (node) =>
          getComputedStyle(node).gridTemplateColumns.split(' ').length,
      );
    expect(columns).toBe(1);
  });

  test('never lets a card overflow its column', async ({ page }) => {
    // Claim text is exchange-derived and can carry a very long unbroken token.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await expect(page.locator('#live-text')).not.toHaveText('connecting');

    const overflowing = await page.evaluate(
      () =>
        [...document.querySelectorAll('#feed .card')].filter(
          (card) => card.scrollWidth > card.clientWidth + 1,
        ).length,
    );
    expect(overflowing).toBe(0);
  });

  test('ends every card in a row at the same height', async ({ page }) => {
    // THE RAGGED EDGE, and it is the reason the cap is two claims rather than
    // three. Cards used to keep their own heights, so a row ran 149px between
    // its tallest and its shortest and the feed's bottom edge stepped up and
    // down across every row. Grid rows match heights now; a future change that
    // reintroduces 'align-items: start' passes every other test in this file
    // and fails here.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await expect(page.locator('#live-text')).not.toHaveText('connecting');

    const worstRowGap = await page.evaluate(() => {
      const rows = new Map<number, number[]>();
      for (const card of document.querySelectorAll('#feed .card')) {
        const box = card.getBoundingClientRect();
        const top = Math.round(box.top);
        rows.set(top, [...(rows.get(top) ?? []), box.height]);
      }
      return Math.max(
        0,
        ...[...rows.values()].map((hs) => Math.max(...hs) - Math.min(...hs)),
      );
    });
    // A pixel of tolerance for subpixel layout, not a pixel of raggedness.
    expect(worstRowGap).toBeLessThanOrEqual(1);
  });

  test('puts every footer in a row on the same baseline', async ({ page }) => {
    // What makes the space above a short card's footer read as air rather than
    // as a card that gave up early. Equal heights alone do not do it — a
    // footer that sits directly under its last line leaves the emptiness
    // BELOW itself, which is what `.card.quiet` did until its own margin rule
    // stopped overriding the push.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await expect(page.locator('#live-text')).not.toHaveText('connecting');

    const worstSpaceBelow = await page.evaluate(() =>
      Math.max(
        0,
        ...[...document.querySelectorAll('#feed .card')].map((card) => {
          const foot = card.querySelector('.cardfoot');
          if (foot === null) return 0;
          return (
            card.getBoundingClientRect().bottom -
            foot.getBoundingClientRect().bottom
          );
        }),
      ),
    );
    // The card's own bottom padding, and nothing else.
    expect(worstSpaceBelow).toBeLessThanOrEqual(20);
  });

  test('keeps every card footer on one line', async ({ page }) => {
    // The badge, the category and the two buttons. This wrapped on the longest
    // category NSE publishes — "Analysts/Institutional Investor Meet/Con. Call
    // Updates" is 47 characters and pushed Source onto a row by itself, which
    // in a stretched grid takes the extra height off every other card in that
    // row. The category truncates instead; it is the only part a reader can
    // recover, from the element's own title.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await expect(page.locator('#live-text')).not.toHaveText('connecting');

    const tallest = await page.evaluate(() =>
      Math.max(
        0,
        ...[...document.querySelectorAll('#feed [data-ui="card-foot"]')].map(
          (foot) => foot.getBoundingClientRect().height,
        ),
      ),
    );
    // One row of controls plus the footer's own top padding. A wrap doubles it.
    expect(tallest).toBeLessThan(50);

    // Copy and Source keep their full labels at every width.
    for (const width of [1600, 1280, 900, 620]) {
      await page.setViewportSize({ width, height: 900 });
      const clipped = await page.evaluate(() =>
        [...document.querySelectorAll('#feed .copy, #feed .srclink')].filter(
          (control) => control.scrollWidth > control.clientWidth + 1,
        ).length,
      );
      expect([width, clipped]).toEqual([width, 0]);
    }
  });

  test('keeps every card header on one line', async ({ page }) => {
    // A long company name pushed the timestamp onto a second row, so cards in
    // the same grid row started at different heights for no visible reason.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await expect(page.locator('#live-text')).not.toHaveText('connecting');

    const wrapped = await page.evaluate(
      () =>
        [...document.querySelectorAll('#feed .cardhead')].filter(
          (head) => head.getBoundingClientRect().height > 30,
        ).length,
    );
    expect(wrapped).toBe(0);
  });
});
