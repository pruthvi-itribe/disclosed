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

  test('gives every card the whole screen, in a row that snaps sideways', async ({
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
      const deckStyle = getComputedStyle(deck);
      return {
        cardHeight: node.getBoundingClientRect().height,
        cardWidth: node.getBoundingClientRect().width,
        deckHeight: deck.clientHeight,
        deckWidth: deck.clientWidth,
        snapAlign: style.scrollSnapAlign,
        deckSnapType: deckStyle.scrollSnapType,
        deckOverflowX: deckStyle.overflowX,
        deckOverflowY: deckStyle.overflowY,
        touchAction: deckStyle.touchAction,
        overscroll: deckStyle.overscrollBehavior,
      };
    });

    // One card is one screen, on both axes now: the deck pages sideways, so a
    // card that was not exactly the deck's width would let the reader stop
    // between two of them. Measured pixels rather than CSS declarations,
    // because a percentage only resolves if the deck's own box is definite —
    // which is the whole reason the body carries a class while the deck is
    // open.
    expect(geometry.cardHeight).toBeGreaterThanOrEqual(
      geometry.deckHeight - 1,
    );
    expect(geometry.cardHeight).toBeLessThanOrEqual(geometry.deckHeight + 1);
    expect(geometry.cardWidth).toBeGreaterThanOrEqual(geometry.deckWidth - 1);
    expect(geometry.cardWidth).toBeLessThanOrEqual(geometry.deckWidth + 1);

    expect(geometry.snapAlign).toBe('start');
    expect(geometry.deckSnapType).toBe('x mandatory');
    expect(geometry.deckOverflowX).toBe('auto');
    // Sideways only: a vertical drag has nowhere to go, which is what keeps
    // the gesture unambiguous.
    expect(geometry.deckOverflowY).toBe('hidden');
    expect(geometry.touchAction).toBe('pan-x');
    // A swipe past the last card must not become the browser's own back.
    expect(geometry.overscroll).toContain('contain');
  });

  test('advances on a tap in the right third and goes back on the left', async ({
    page,
  }) => {
    // THE STORY GESTURE, AND IT IS STILL SOMETHING THE READER DID. No timer
    // moves a card here; these are taps.
    const errors = watchConsole(page);
    await openBrief(page);

    const at = async (): Promise<number> =>
      page.evaluate(() =>
        Math.round(
          (document.getElementById('brief-deck') as HTMLElement).scrollLeft,
        ),
      );
    expect(await at()).toBe(0);

    // ONE CARD PER TAP, so the landing offset is exactly the deck's width. The
    // scroll is smooth, so this is polled to its resting place rather than
    // read once — a reading taken mid-flight is a number on the way somewhere.
    const step = await page.evaluate(
      () => (document.getElementById('brief-deck') as HTMLElement).clientWidth,
    );

    // The right third, well clear of the foot's controls.
    await page.mouse.click(PHONE.width - 24, 420);
    await expect.poll(at, { timeout: 5_000 }).toBe(step);

    // The middle third is not a control: it is where the claim is, and where a
    // thumb rests while reading it.
    await page.mouse.click(PHONE.width / 2, 420);
    await page.waitForTimeout(400);
    expect(await at()).toBe(step);

    // And the left third goes back.
    await page.mouse.click(24, 420);
    await expect.poll(at, { timeout: 5_000 }).toBe(0);

    expect(errors).toEqual([]);
  });

  test('leaves the controls on a card tappable inside the tap zones', async ({
    page,
  }) => {
    // THE FAILURE THIS WOULD SHIP. Copy and Source sit in the bottom corners
    // of the card — squarely inside the two live thirds — so a tap handler
    // that did not stand down for them would advance the card instead of
    // copying the claim.
    await openBrief(page);

    const at = async (): Promise<number> =>
      page.evaluate(() =>
        Math.round(
          (document.getElementById('brief-deck') as HTMLElement).scrollLeft,
        ),
      );
    const step = await page.evaluate(
      () => (document.getElementById('brief-deck') as HTMLElement).clientWidth,
    );

    // Onto the first company card, whose foot carries the controls.
    await page.mouse.click(PHONE.width - 24, 420);
    await expect.poll(at, { timeout: 5_000 }).toBe(step);

    const copy = page
      .locator('#brief-deck [data-ui="brief-card"] .copy')
      .first();
    const box = await copy.boundingBox();
    expect(box).not.toBeNull();
    // IT REALLY IS IN A LIVE THIRD, asserted rather than assumed: the whole
    // point is that the tap zone had to stand down for it.
    expect(box!.x + box!.width).toBeGreaterThan(PHONE.width * (2 / 3));

    await copy.click();
    // THE BUTTON ANSWERED. Which answer it gives is the clipboard's business —
    // headless Chromium refuses the write and the button honestly says so —
    // and either way it is proof the click reached the button rather than the
    // deck.
    await expect(copy).not.toHaveText(/^copy$/i);
    // AND THE DECK DID NOT MOVE UNDER IT, which is the assertion this test is
    // for.
    await page.waitForTimeout(400);
    expect(await at()).toBe(step);
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
      // The deck pages sideways on a phone, so this is the axis the reader's
      // thumb moves and the axis the observer watches.
      deck.scrollLeft = card.offsetLeft;
    }, symbol);

    await expect(page.locator('[data-ui="brief-rail-seg"].on')).toHaveCount(3);
  });

  test('keeps the arrow keys driving the deck, whichever way it lies', async ({
    page,
  }) => {
    // A phone-width window with a keyboard attached is a real configuration,
    // and a reader on one should not have to work out that this deck turned
    // sideways. Right and Down both mean forward.
    await openBrief(page);
    await page.locator('#brief-deck').focus();

    const at = async (): Promise<number> =>
      page.evaluate(() =>
        Math.round(
          (document.getElementById('brief-deck') as HTMLElement).scrollLeft,
        ),
      );

    await page.keyboard.press('ArrowRight');
    await expect.poll(at, { timeout: 5_000 }).toBeGreaterThan(0);
    await page.keyboard.press('ArrowLeft');
    await expect.poll(at, { timeout: 5_000 }).toBe(0);

    // The vertical pair still works, because one stepper answers all four.
    await page.keyboard.press('ArrowDown');
    await expect.poll(at, { timeout: 5_000 }).toBeGreaterThan(0);
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

  test('scrolls sideways in the deck and nowhere else on the page', async ({
    page,
  }) => {
    // THIS TEST USED TO SAY THE OPPOSITE, and the reason it gave is still
    // true: a horizontal gesture at the left EDGE of the screen is the phone's
    // own back navigation, and a deck that competes with it loses. What
    // changed is that the deck now wants that axis, so the two are separated
    // rather than one of them given up — `overscroll-behavior: contain` stops
    // the swipe propagating out of the deck, and the tap zones give a reader
    // who never swipes a way through that no edge gesture can take.
    //
    // ON iOS SAFARI THE EDGE SWIPE IS SYSTEM-LEVEL and cannot be verified in
    // headless Chromium. A real-device pass is the only thing that settles it;
    // the tap zones are what makes the deck usable if it turns out the first
    // card cannot be swiped backwards there.
    await openBrief(page);
    const width = await page.evaluate(() => ({
      body: document.body.scrollWidth,
      deck: (document.getElementById('brief-deck') as HTMLElement).scrollWidth,
      client: (document.getElementById('brief-deck') as HTMLElement)
        .clientWidth,
      cards: (document.getElementById('brief-deck') as HTMLElement)
        .getElementsByClassName('bcard').length,
    }));

    // THE PAGE ITSELF STILL DOES NOT MOVE SIDEWAYS. Only the deck does, and it
    // moves exactly one card's width per card.
    expect(width.body).toBeLessThanOrEqual(PHONE.width);
    expect(width.deck).toBe(width.client * width.cards);
  });

  test('scrolls the deck and not the page, on either axis', async ({
    page,
  }) => {
    // The body is height:100dvh and overflow:hidden while the deck is open, so
    // there is no page scroll for the horizontal deck to fight — which is the
    // other half of why the axis could be taken at all.
    await openBrief(page);
    const body = await page.evaluate(() => {
      const style = getComputedStyle(document.body);
      return {
        overflow: style.overflow,
        scrollHeight: document.body.scrollHeight,
        clientHeight: document.body.clientHeight,
      };
    });
    expect(body.overflow).toBe('hidden');
    expect(body.scrollHeight).toBeLessThanOrEqual(body.clientHeight + 1);
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
    expect(line).toContain('filed something a document verified');
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

/**
 * THE DECK ON A DESKTOP, which is a different reader with the same content.
 *
 * The complaint this answers was one sentence: "not easy to use, looks like a
 * mobile interface blown up." It was — a 480px column adrift in a 1440px
 * window, every card locked to 650px whatever it held, and the only two things
 * that moved it (the wheel and the arrow keys) advertised by nothing. Scroll
 * snap has no affordance and a pointer has no swipe.
 *
 * WHAT IS ASSERTED HERE IS THE SHAPE, not the styling: the reading column's
 * width, that a card is its content's height rather than the window's, that the
 * pager exists and steps, and that it says so at both ends. The phone's own
 * behaviour is every test above this one, unchanged.
 */
const DESKTOP = { width: 1440, height: 900 };

const openDeck = async (page: Page): Promise<void> => {
  await page.setViewportSize(DESKTOP);
  await page.goto('/');
  await expect(page.locator('#live-text')).not.toHaveText('connecting');
  await page.locator('#tab-brief').click();
  await expect(page.locator('#brief-deck')).toBeVisible();
  // A COMPANY card, not any .bcard: both clients show the deck with its
  // blank cover while the window is still being fetched, so the cover
  // satisfies a bare .bcard wait before the rail or the counts exist.
  await expect(
    page.locator('#brief-deck [data-ui="brief-card"]').first(),
  ).toBeVisible();
};

test.describe('the deck above 900px', () => {
  test('reads in a column, with the gutters a wide window has to spare', async ({
    page,
  }) => {
    await openDeck(page);

    const box = await page.locator('#brief-deck').boundingBox();
    expect(box).not.toBeNull();
    // 600-680px is about 70 characters of the 27px lede. The old 480px broke
    // the same sentence at 44, which is a phone's line length on a monitor.
    expect(box!.width).toBeGreaterThanOrEqual(600);
    expect(box!.width).toBeLessThanOrEqual(680);
    // And it is a column in the middle, not a panel against an edge: the
    // gutter on each side is generous and neither is zero.
    expect(box!.x).toBeGreaterThan(200);
    expect(DESKTOP.width - (box!.x + box!.width)).toBeGreaterThan(200);
  });

  test('gives a card the height of what is on it, not of the window', async ({
    page,
  }) => {
    await openDeck(page);

    const heights = await page.evaluate(() =>
      [...document.querySelectorAll('#brief-deck .bcard')].map((card) =>
        Math.round(card.getBoundingClientRect().height),
      ),
    );

    // NOT ALL THE SAME, which is the whole change: one viewport per card made
    // a two-line claim sit above 300px of nothing, because the topic and the
    // foot are pushed to the bottom of whatever the card is.
    expect(new Set(heights).size).toBeGreaterThan(1);
    // And none of them is a viewport tall.
    for (const height of heights) expect(height).toBeLessThan(DESKTOP.height);
    // With a floor, so a card still reads as a card.
    for (const height of heights) expect(height).toBeGreaterThan(240);
  });

  test('draws the rail beside the column rather than above it', async ({
    page,
  }) => {
    await openDeck(page);

    const rail = await page.locator('#brief-rail').boundingBox();
    const deck = await page.locator('#brief-deck').boundingBox();
    expect(rail).not.toBeNull();
    expect(deck).not.toBeNull();

    // A hairline to the LEFT of the reading column, as tall as it — a chapter
    // marker rather than a progress bar, costing no vertical space at all.
    expect(rail!.width).toBeLessThan(12);
    expect(rail!.x).toBeLessThan(deck!.x);
    expect(rail!.height).toBeGreaterThan(deck!.height / 2);
  });

  test('steps a card when the pager is clicked, and says where the ends are', async ({
    page,
  }) => {
    await openDeck(page);

    const prev = page.locator('#brief-prev');
    const next = page.locator('#brief-next');
    await expect(prev).toBeVisible();
    await expect(next).toBeVisible();

    // AT THE TOP, BACK IS NOT A CONTROL. A live button that does nothing is
    // the page pretending it moved.
    await expect(prev).toBeDisabled();
    await expect(next).toBeEnabled();

    const at = async (): Promise<number> =>
      page.evaluate(() =>
        Math.round(document.getElementById('brief-deck')!.scrollTop),
      );

    expect(await at()).toBe(0);
    await next.click();
    await expect.poll(at, { timeout: 5_000 }).toBeGreaterThan(0);

    const afterOne = await at();
    await expect(prev).toBeEnabled();

    // And back to where it started, through the same step.
    await prev.click();
    await expect.poll(at, { timeout: 5_000 }).toBeLessThan(afterOne);
  });

  test('reaches the end of the deck and stops claiming another card', async ({
    page,
  }) => {
    await openDeck(page);

    const next = page.locator('#brief-next');

    // SETTLED BEFORE ASKED, because the scroll is smooth: reading the button
    // mid-flight sees the state it had before the step landed, and clicking on
    // that reading races the animation to the last card.
    const settle = async (): Promise<void> => {
      let previous = -1;
      for (let tick = 0; tick < 40; tick += 1) {
        const now = await page.evaluate(
          () => document.getElementById('brief-deck')!.scrollTop,
        );
        if (now === previous) return;
        previous = now;
        await page.waitForTimeout(100);
      }
    };

    // The deck holds at most twelve company cards plus a cover and an end.
    for (let step = 0; step < 20; step += 1) {
      await settle();
      if (await next.isDisabled()) break;
      await next.click();
    }
    await settle();

    await expect(next).toBeDisabled();
    await expect(page.locator('#brief-prev')).toBeEnabled();
    // The last card is the one that states the remainder, and it is reachable
    // by the pointer alone.
    await expect(page.locator('#brief-end')).toBeInViewport();
  });

  test('leaves the keyboard driving the same step it always did', async ({
    page,
  }) => {
    // The pager calls `briefStep`, which is what ArrowDown calls. One way to
    // move a card, two ways to ask for it.
    await openDeck(page);
    await page.locator('#brief-deck').focus();

    const at = async (): Promise<number> =>
      page.evaluate(() =>
        Math.round(document.getElementById('brief-deck')!.scrollTop),
      );

    await page.keyboard.press('ArrowDown');
    await expect.poll(at, { timeout: 5_000 }).toBeGreaterThan(0);
    // And the pager caught up with a move it did not make.
    await expect(page.locator('#brief-prev')).toBeEnabled();
  });

  test('hides the pager where there is no pointer to need it', async ({
    page,
  }) => {
    // A phone has a gesture for this and 38px of chrome it does not need.
    await page.setViewportSize(PHONE);
    await page.goto('/');
    await expect(page.locator('#live-text')).not.toHaveText('connecting');
    await expect(page.locator('#brief-deck')).toBeVisible();

    await expect(page.locator('#brief-prev')).toBeHidden();
    await expect(page.locator('#brief-next')).toBeHidden();
  });
});
