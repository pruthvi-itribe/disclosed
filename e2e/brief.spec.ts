import { expect, test, type Page } from '@playwright/test';

/**
 * The Brief, executed on a phone-sized viewport against the live collection.
 *
 * WHY THIS SUITE EXISTS SEPARATELY FROM `page.spec.ts`. That one asserts the
 * served string, which cannot execute the ordering, cannot resolve a
 * percentage height, and cannot tell a deck that snaps from a deck that
 * scrolls freely — and scroll-snap at a viewport height is the least portable
 * thing in the codebase. Everything below is measured on the rendered page.
 *
 * The ordering function lives inside a template literal and therefore cannot
 * be reached by Jest at all; `orders the deck on countable evidence` is the
 * only test of it anywhere until slice 2 moves it to a real module.
 *
 * EVERY CARD IS PINNED BY `data-symbol` OR `data-seq`, never by index. The page
 * repaints every four seconds and a Playwright locator is a lazy query.
 */

/** The phone this design was drawn for: the widest viewport the deck defaults on. */
const PHONE = { width: 430, height: 900 };

/** Fails the test if the page logged an uncaught error, whatever else it did. */
const watchConsole = (page: Page): string[] => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
};

/** The deck's own window, asked for exactly as the page asks for it. */
const briefWindow = async (page: Page) => {
  const response = await page.request.get(
    'api/filings?tier=verified&offset=0&limit=200',
  );
  expect(response.ok()).toBe(true);
  return (await response.json()) as {
    data: readonly {
      symbol: string;
      seqId: number;
      disseminatedAt: string;
      enrichment: {
        results: unknown | null;
        claims: readonly { text: string; echo?: boolean }[];
      };
    }[];
    meta: { returned: number };
  };
};

const openBrief = async (page: Page) => {
  await page.setViewportSize(PHONE);
  await page.goto('/');
  await expect(page.locator('#live-text')).not.toHaveText('connecting');
  await expect(page.locator('#view-brief')).toBeVisible();
};

test.describe('where the deck lives', () => {
  test('is what a phone lands on, without touching a tab', async ({ page }) => {
    // The feed's card grid is a desktop object and the deck is a phone object.
    // Each is default where it is right.
    const errors = watchConsole(page);
    await openBrief(page);

    await expect(page.locator('#tab-brief')).toHaveClass(/active/);
    await expect(page.locator('#view-feed')).toBeHidden();
    await expect(page.locator('#view-admin')).toBeHidden();
    expect(errors).toEqual([]);
  });

  test('is behind a tab on a desktop, where the feed still leads', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await expect(page.locator('#live-text')).not.toHaveText('connecting');

    await expect(page.locator('#view-feed')).toBeVisible();
    await expect(page.locator('#view-brief')).toBeHidden();

    await page.locator('#tab-brief').click();
    await expect(page.locator('#view-brief')).toBeVisible();
    await expect(page.locator('#view-feed')).toBeHidden();
    await expect(page.locator('#brief-deck')).toBeVisible();

    // And back, without a reload. The two views ask the server different
    // questions, so this costs a request — it must not cost the feed.
    await page.locator('#tab-feed').click();
    await expect(page.locator('#view-feed')).toBeVisible();
    await expect(page.locator('#view-brief')).toBeHidden();
    await expect(page.locator('#feed .card, #feed .emptyfeed')).not.toHaveCount(
      0,
    );
  });

  test('asks for the verified window and no new route', async ({ page }) => {
    const asked: string[] = [];
    page.on('request', (request) => {
      const url = request.url();
      if (url.includes('/api/')) asked.push(url);
    });

    await openBrief(page);
    await expect
      .poll(() => asked.some((url) => url.includes('tier=verified')))
      .toBe(true);
    expect(asked.some((url) => url.includes('limit=200'))).toBe(true);
    expect(asked.some((url) => url.includes('api/brief'))).toBe(false);
  });
});

test.describe('the deck', () => {
  test('is a cover, a bounded run of cards, and an end', async ({ page }) => {
    await openBrief(page);

    const cards = page.locator('#brief-deck [data-ui="brief-card"]');
    await expect(cards).not.toHaveCount(0);
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(3);
    // The cap is a promise about time: twelve cards is about 54 seconds.
    expect(count).toBeLessThanOrEqual(12);

    await expect(page.locator('#brief-cover')).toBeAttached();
    await expect(page.locator('#brief-end')).toBeAttached();
    await expect(page.locator('#brief-empty')).toBeHidden();

    // The rail counts the deck down, so it must count the same deck.
    await expect(page.locator('[data-ui="brief-rail-seg"]')).toHaveCount(count);
  });

  test('gives every card the whole viewport, and snaps to it', async ({
    page,
  }) => {
    await openBrief(page);
    const first = page.locator('#brief-deck [data-ui="brief-card"]').first();
    const symbol = await first.getAttribute('data-symbol');
    const card = page.locator(
      '#brief-deck [data-ui="brief-card"][data-symbol="' + symbol + '"]',
    );

    const geometry = await card.evaluate((node) => {
      const deck = node.parentElement as HTMLElement;
      const style = getComputedStyle(node);
      return {
        cardHeight: node.getBoundingClientRect().height,
        deckHeight: deck.clientHeight,
        snapAlign: style.scrollSnapAlign,
        deckSnapType: getComputedStyle(deck).scrollSnapType,
        deckOverflow: getComputedStyle(deck).overflowY,
      };
    });

    // One card is one viewport. Asserted as measured pixels rather than as a
    // CSS declaration, because `min-height: 100%` only resolves if the deck's
    // own height is definite — which is the whole reason the body carries a
    // class while the deck is open.
    expect(geometry.cardHeight).toBeGreaterThanOrEqual(
      geometry.deckHeight - 1,
    );
    expect(geometry.cardHeight).toBeLessThanOrEqual(geometry.deckHeight + 1);
    expect(geometry.snapAlign).toBe('start');
    expect(geometry.deckSnapType).toContain('mandatory');
    expect(geometry.deckOverflow).toBe('auto');
  });

  test('moves the rail from the scroll, not from a counter', async ({
    page,
  }) => {
    await openBrief(page);
    const cards = page.locator('#brief-deck [data-ui="brief-card"]');
    test.skip((await cards.count()) < 3, 'fewer than three candidates');

    // PINNED BY SYMBOL. "The third card" names a different node after any
    // repaint that changes the window.
    const symbol = await cards.nth(2).getAttribute('data-symbol');
    await expect(page.locator('[data-ui="brief-rail-seg"].on')).toHaveCount(1);

    await page.evaluate((sym) => {
      const deck = document.getElementById('brief-deck') as HTMLElement;
      const card = deck.querySelector(
        '[data-ui="brief-card"][data-symbol="' + sym + '"]',
      ) as HTMLElement;
      deck.scrollTop = card.offsetTop;
    }, symbol);

    await expect(page.locator('[data-ui="brief-rail-seg"].on')).toHaveCount(3);
  });

  test('orders the deck on countable evidence, with every tie broken', async ({
    page,
  }) => {
    // THE ONLY TEST OF THE ORDERING ANYWHERE. It lives inside a template
    // literal, so Jest cannot reach it; slice 2 moves it to a real module with
    // its own spec. Recomputed here from the same payload the page fetched:
    // a results block, then claims carrying a figure, then claims, then the
    // newest filing, then the symbol — the last so a repaint cannot reshuffle
    // two otherwise-equal candidates under a reader's thumb.
    await openBrief(page);
    const body = await briefWindow(page);

    const groups = new Map<
      string,
      {
        symbol: string;
        hasResults: boolean;
        figures: number;
        claims: number;
        newest: string;
        lede: number;
      }
    >();
    for (const filing of body.data) {
      const entry = groups.get(filing.symbol) ?? {
        symbol: filing.symbol,
        hasResults: false,
        figures: 0,
        claims: 0,
        newest: filing.disseminatedAt,
        lede: 0,
      };
      if (filing.enrichment.results) entry.hasResults = true;
      if (filing.disseminatedAt > entry.newest) {
        entry.newest = filing.disseminatedAt;
      }
      for (const claim of filing.enrichment.claims ?? []) {
        entry.claims += 1;
        if (/\d/.test(claim.text)) entry.figures += 1;
        if (claim.echo !== true) entry.lede += 1;
      }
      groups.set(filing.symbol, entry);
    }

    const expected = [...groups.values()]
      // A company whose every claim is an echo is not a candidate: its facts
      // are already on an earlier card.
      .filter((entry) => entry.lede > 0)
      .sort((a, b) => {
        if (a.hasResults !== b.hasResults) return a.hasResults ? -1 : 1;
        if (a.figures !== b.figures) return b.figures - a.figures;
        if (a.claims !== b.claims) return b.claims - a.claims;
        if (a.newest !== b.newest) return a.newest < b.newest ? 1 : -1;
        return a.symbol < b.symbol ? -1 : 1;
      })
      .slice(0, 12)
      .map((entry) => entry.symbol);

    const drawn = await page
      .locator('#brief-deck [data-ui="brief-card"]')
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('data-symbol')),
      );
    expect(drawn).toEqual(expected);
  });

  test('never scrolls sideways', async ({ page }) => {
    // Vertical only, ever: a horizontal gesture at the left edge is the phone's
    // own back navigation, and a deck that competes with it loses and takes the
    // reader out of the app.
    await openBrief(page);
    const width = await page.evaluate(() => ({
      body: document.body.scrollWidth,
      deck: (document.getElementById('brief-deck') as HTMLElement).scrollWidth,
      client: (document.getElementById('brief-deck') as HTMLElement)
        .clientWidth,
    }));
    expect(width.body).toBeLessThanOrEqual(PHONE.width);
    expect(width.deck).toBeLessThanOrEqual(width.client + 1);
  });
});

test.describe('one card', () => {
  test('shows a claim as text, and never as markup', async ({ page }) => {
    // THE ABSOLUTE RULE OF THIS PAGE, asserted on the deck's own nodes: a claim
    // is exchange-derived text that reached the browser through an
    // unauthenticated database. Every child of a claim line is either a text
    // node or the `span.fig` that `writeClaim` uses to mark a figure the
    // document printed — there is no third kind, and an element with any other
    // tag would mean something built a node out of a string.
    await openBrief(page);
    const strays = await page.evaluate(() =>
      [
        ...document.querySelectorAll(
          '[data-ui="brief-lede"], [data-ui="brief-rest"] li',
        ),
      ].flatMap((line) =>
        [...line.childNodes]
          .filter(
            (node) =>
              node.nodeType !== Node.TEXT_NODE &&
              !(
                node.nodeType === Node.ELEMENT_NODE &&
                (node as Element).tagName === 'SPAN' &&
                (node as Element).className === 'fig'
              ),
          )
          .map((node) => (node as Element).tagName ?? node.nodeName),
      ),
    );
    expect(strays).toEqual([]);
  });

  test('leads with a claim the server actually sent, character for character', async ({
    page,
  }) => {
    // The lede is not summarised, reordered or re-written on the way to the
    // screen: 54.8% of claims already lead with a figure and the ones that do
    // not are shown as they were verified.
    await openBrief(page);
    const body = await briefWindow(page);

    const first = page.locator('#brief-deck [data-ui="brief-card"]').first();
    const symbol = await first.getAttribute('data-symbol');
    const card = page.locator(
      '#brief-deck [data-ui="brief-card"][data-symbol="' + symbol + '"]',
    );
    const lede = (
      await card.locator('[data-ui="brief-lede"]').textContent()
    )?.trim();

    const said = body.data
      .filter((filing) => filing.symbol === symbol)
      .flatMap((filing) => filing.enrichment.claims ?? [])
      .map((claim) => claim.text.trim());
    expect(said).toContain(lede);

    // And the document the sentence came from is one tap away, on the filing
    // the LEDE was matched against rather than on the company's newest.
    const seq = await card.getAttribute('data-seq');
    const source = card.locator('[data-ui="brief-foot"] .srclink');
    if ((await source.count()) > 0) {
      await expect(source).toHaveAttribute('href', /^https:\/\//);
      await expect(source).toHaveAttribute('rel', /noopener/);
    }
    expect(
      body.data.some((filing) => String(filing.seqId) === seq),
    ).toBe(true);
  });

  test('hides the topic rather than filing a null claim under a label', async ({
    page,
  }) => {
    // 15.4% of claims carry no topic, all of them on the newest day, because
    // the classifier's backfill has not reached it. A card has no sum to
    // preserve, so absence is the honest render.
    await openBrief(page);
    const body = await briefWindow(page);

    const cards = await page
      .locator('#brief-deck [data-ui="brief-card"]')
      .evaluateAll((nodes) =>
        nodes.map((node) => ({
          symbol: node.getAttribute('data-symbol'),
          seq: node.getAttribute('data-seq'),
          topics: node.querySelectorAll('[data-ui="brief-topic"]').length,
        })),
      );
    expect(cards.length).toBeGreaterThan(0);

    for (const card of cards) {
      const filing = body.data.find(
        (item) => String(item.seqId) === card.seq,
      );
      const lede = (filing?.enrichment.claims ?? []).find(
        (claim) => claim.echo !== true,
      ) as { topic?: string | null } | undefined;
      const hasTopic =
        lede !== undefined && lede.topic !== null && lede.topic !== undefined;
      expect([card.symbol, card.topics]).toEqual([
        card.symbol,
        hasTopic ? 1 : 0,
      ]);
    }
  });

  test('keeps every control on the foot a thumb-sized target', async ({
    page,
  }) => {
    // The foot is the row a reader reaches for on a moving train, and it holds
    // the only route to the source document.
    await openBrief(page);
    const small = await page.evaluate(() =>
      [
        ...document.querySelectorAll(
          '[data-ui="brief-foot"] .copy, [data-ui="brief-foot"] .srclink, [data-ui="brief-topic"]',
        ),
      ]
        .map((node) => ({
          text: (node.textContent ?? '').trim(),
          height: node.getBoundingClientRect().height,
        }))
        .filter((control) => control.height < 44),
    );
    expect(small).toEqual([]);
  });
});

test.describe('the cover and the end', () => {
  test('states the window it was ordered over, and the rule', async ({
    page,
  }) => {
    // A selection is only honest when it comes with a stated cut. The cover is
    // where the cut is stated and the end card is where the remainder is.
    await openBrief(page);

    await expect(page.locator('#brief-day')).not.toBeEmpty();
    await expect(page.locator('#brief-cover-line')).not.toBeEmpty();
    await expect(page.locator('#brief-cover-rule')).toContainText(
      'most recent verified filings',
    );
    await expect(page.locator('#brief-cover-rule')).toContainText(
      'Ordered by how much of what each company said could be checked against its own document',
    );
    await expect(page.locator('#brief-cover-rule')).toContainText(
      'not by how much it matters. That judgement is yours.',
    );
    // The day's shape, from the summary the page already polls.
    await expect(page.locator('#brief-mix .mixseg')).not.toHaveCount(0);
  });

  test('states the remainder on the end card, in numbers', async ({ page }) => {
    // The deck is a few per cent of the day. A reader who only ever opens the
    // Brief would otherwise believe they had seen the market.
    await openBrief(page);
    const shown = await page
      .locator('#brief-deck [data-ui="brief-card"]')
      .count();

    const line = (await page.locator('#brief-end-line').textContent()) ?? '';
    const numbers = line
      .replace(/,/g, '')
      .match(/\d+/g)
      ?.map((value) => Number(value));
    expect(numbers?.[0]).toBe(shown);
    // "N of M companies in this window", and M is at least what is drawn.
    expect(numbers?.[1]).toBeGreaterThanOrEqual(shown);
    expect(line).toContain('said something a document verified');
    if ((numbers?.[1] ?? 0) > shown) {
      expect(line).toContain('The rest are in the feed');
      expect(numbers?.[2]).toBe((numbers?.[1] ?? 0) - shown);
    }

    await page.locator('#brief-to-feed').click();
    await expect(page.locator('#view-feed')).toBeVisible();
    await expect(page.locator('#view-brief')).toBeHidden();
  });

  test('says nothing qualified rather than drawing an empty deck', async ({
    page,
  }) => {
    // "Nothing was found" and "nothing was looked for" are different facts and
    // must not render the same. Forced rather than waited for: the collection
    // is never empty, and this state has to be provable.
    await page.route('**/api/filings*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [],
          error: null,
          meta: {
            total: 0,
            limit: 200,
            offset: 0,
            returned: 0,
            hasMore: false,
          },
        }),
      }),
    );

    await page.setViewportSize(PHONE);
    await page.goto('/');
    await expect(page.locator('#live-text')).not.toHaveText('connecting');

    await expect(page.locator('#brief-empty')).toBeVisible();
    await expect(page.locator('#brief-empty')).toContainText(
      'carried a claim matched against its source document',
    );
    await expect(page.locator('#brief-deck')).toBeHidden();
    await expect(page.locator('[data-ui="brief-rail-seg"]')).toHaveCount(0);
  });
});

test('the deck survives the four-second repaint without moving', async ({
  page,
}) => {
  // THE BUG THIS GUARDS. The page repaints on every poll, and a deck rebuilt
  // under a reader's thumb loses their scroll position — worse than a deck
  // that never updated, because they cannot tell whether they mis-swiped. The
  // cards are rebuilt only when the deck's contents actually change.
  await openBrief(page);
  const cards = page.locator('#brief-deck [data-ui="brief-card"]');
  test.skip((await cards.count()) < 3, 'fewer than three candidates');

  const symbol = await cards.nth(2).getAttribute('data-symbol');
  const target = await page.evaluate((sym) => {
    const deck = document.getElementById('brief-deck') as HTMLElement;
    const card = deck.querySelector(
      '[data-ui="brief-card"][data-symbol="' + sym + '"]',
    ) as HTMLElement;
    deck.scrollTop = card.offsetTop;
    return card.offsetTop;
  }, symbol);

  // READ AFTER IT SETTLES. The deck scrolls smoothly, so scrollTop immediately
  // after the assignment is still the position it is leaving.
  await expect
    .poll(() =>
      page.evaluate(
        () => (document.getElementById('brief-deck') as HTMLElement).scrollTop,
      ),
    )
    .toBe(target);
  const at = target;

  // Longer than one poll interval, so a repaint is guaranteed to have run.
  await page.waitForTimeout(6000);
  const after = await page.evaluate(
    () => (document.getElementById('brief-deck') as HTMLElement).scrollTop,
  );
  expect(after).toBe(at);
  expect(
    await page
      .locator('#brief-deck [data-ui="brief-card"]')
      .nth(2)
      .getAttribute('data-symbol'),
  ).toBe(symbol);
});
