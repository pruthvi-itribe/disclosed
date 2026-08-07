import { expect, test, type Page } from '@playwright/test';

/**
 * The type-ahead, driven by a real keyboard against the live collection.
 *
 * WHY NONE OF THIS COULD BE A STRING TEST. `page.spec.ts` can prove the listbox
 * element is in the served HTML; it cannot prove that ArrowDown moves a
 * highlight, that Enter applies the row under it, that a fast typist produces
 * one request instead of nine, or that a company name is put on the page as text
 * rather than as markup. Every one of those is a claim about a browser executing
 * this page, and every one of them is the kind of thing that breaks silently —
 * the list still appears, it just stops responding to the keys.
 *
 * DERIVED FROM WHATEVER IS IN THE COLLECTION, deliberately. These run against a
 * live database the poller is inserting into, so a test pinned to BRITANNIA is a
 * test that reports a product failure when the fixture moves. They type a prefix
 * that matches broadly, read back whichever company the server offered, and then
 * assert the BEHAVIOUR against that.
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
 * A prefix broad enough that the live collection always has something behind it.
 *
 * Measured on the directory of 954 distinct companies: `in` matches 233 of them,
 * the widest two-letter prefix there is. A narrower one would make this suite
 * skip itself on a quiet day and report green for a broken feature.
 */
const BROAD_PREFIX = 'in';

const openSuggestions = async (page: Page, typed = BROAD_PREFIX) => {
  await page.locator('#symbol').click();
  await page.locator('#symbol').pressSequentially(typed, { delay: 60 });
  await expect(page.locator('#suggest')).toBeVisible();
  return page.locator('#suggest .sopt');
};

test.describe('the type-ahead', () => {
  test('opens a listbox of real companies as the reader types', async ({
    page,
  }) => {
    const errors = watchConsole(page);
    await page.goto('/');
    await expect(page.locator('#live-text')).not.toHaveText('connecting');

    const options = await openSuggestions(page);

    expect(await options.count()).toBeGreaterThan(0);
    // A ticker and a company name on every row — the server sends both because
    // the ticker alone does not tell two similarly-named companies apart.
    await expect(options.first().locator('.ssym')).not.toBeEmpty();
    await expect(options.first().locator('.scount')).not.toBeEmpty();
    await expect(page.locator('#symbol')).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(errors).toEqual([]);
  });

  test('says nothing on one character, so the first keystroke costs no round trip', async ({
    page,
  }) => {
    await page.goto('/');
    await page.locator('#symbol').click();
    await page.locator('#symbol').pressSequentially('i', { delay: 60 });

    // Given time to have fired, and asserted not to have.
    await page.waitForTimeout(500);
    await expect(page.locator('#suggest')).toBeHidden();
  });

  test('debounces, so a typed word is one request and not one per letter', async ({
    page,
  }) => {
    const asked: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('api/suggest')) asked.push(request.url());
    });

    await page.goto('/');
    await expect(page.locator('#live-text')).not.toHaveText('connecting');

    // Nine characters at 40ms apart: faster than the 140ms debounce, so a box
    // without one issues nine requests. THE ASSERTION IS THE POINT — a debounce
    // that silently stopped working would look identical on screen.
    await page.locator('#symbol').click();
    await page
      .locator('#symbol')
      .pressSequentially('industries', { delay: 40 });
    await page.waitForTimeout(600);

    expect(asked.length).toBeGreaterThan(0);
    expect(asked.length).toBeLessThan(4);
  });
});

test.describe('the keyboard', () => {
  test('moves a highlight with the arrow keys and announces where it is', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.locator('#live-text')).not.toHaveText('connecting');
    const options = await openSuggestions(page);
    test.skip((await options.count()) < 2, 'need two rows to move between');

    // NOTHING IS HIGHLIGHTED UNTIL A KEY IS PRESSED. Pre-selecting the first row
    // is how a search box quietly applies a filter nobody chose.
    await expect(page.locator('#suggest .sopt.active')).toHaveCount(0);
    await expect(page.locator('#symbol')).not.toHaveAttribute(
      'aria-activedescendant',
      /./,
    );

    await page.locator('#symbol').press('ArrowDown');
    await expect(options.nth(0)).toHaveClass(/active/);
    await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true');
    // The highlight is announced through the input, because DOM focus never
    // leaves it — the reader is still typing.
    await expect(page.locator('#symbol')).toHaveAttribute(
      'aria-activedescendant',
      'suggest-opt-0',
    );

    await page.locator('#symbol').press('ArrowDown');
    await expect(options.nth(1)).toHaveClass(/active/);
    // EXACTLY ONE highlight. Two rows claiming to be what Enter will pick is
    // worse than none.
    await expect(page.locator('#suggest .sopt.active')).toHaveCount(1);

    await page.locator('#symbol').press('ArrowUp');
    await expect(options.nth(0)).toHaveClass(/active/);
  });

  test('wraps at the top rather than getting stuck', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#live-text')).not.toHaveText('connecting');
    const options = await openSuggestions(page);
    const count = await options.count();
    test.skip(count < 2, 'need two rows to wrap between');

    await page.locator('#symbol').press('ArrowUp');

    await expect(options.nth(count - 1)).toHaveClass(/active/);
  });

  test('Enter applies the highlighted company and the feed follows', async ({
    page,
  }) => {
    const asked: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('api/filings')) asked.push(request.url());
    });

    await page.goto('/');
    await expect(page.locator('#live-text')).not.toHaveText('connecting');
    const options = await openSuggestions(page);
    test.skip((await options.count()) === 0, 'no company matched');

    const symbol = (
      await options.first().locator('.ssym').textContent()
    )?.trim();

    await page.locator('#symbol').press('ArrowDown');
    await page.locator('#symbol').press('Enter');

    // The list closes, the box shows what was picked, and the note says which
    // of the box's two meanings is in force.
    await expect(page.locator('#suggest')).toBeHidden();
    await expect(page.locator('#symbol')).toHaveValue(symbol as string);
    await expect(page.locator('#search-note')).toContainText(symbol as string);

    // AN EXACT SYMBOL FILTER, not a text search. A reader who picked a company
    // from a list has named it, and naming it must not return every filing that
    // merely mentions it.
    await expect
      .poll(() => asked.some((url) => url.includes('symbol=' + symbol)))
      .toBe(true);

    // And every card on screen is that company's.
    await page.locator('#only-insights').uncheck();
    await expect.poll(async () => page.locator('#feed .card').count()).toBeGreaterThan(0);
    const symbols = await page.locator('#feed .card .sym').allTextContents();
    expect(new Set(symbols.map((s) => s.trim()))).toEqual(new Set([symbol]));
  });

  test('Escape dismisses the list without clearing what was typed', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.locator('#live-text')).not.toHaveText('connecting');
    await openSuggestions(page);

    await page.locator('#symbol').press('Escape');

    await expect(page.locator('#suggest')).toBeHidden();
    await expect(page.locator('#symbol')).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    // The text survives. Escape is for getting the list out of the way, not for
    // undoing the typing that produced it.
    await expect(page.locator('#symbol')).toHaveValue(BROAD_PREFIX);

    // And ArrowDown asks for it back, rather than doing nothing.
    await page.locator('#symbol').press('ArrowDown');
    await expect(page.locator('#suggest')).toBeVisible();
  });

  test('Enter with nothing highlighted searches the text instead of picking', async ({
    page,
  }) => {
    const asked: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('api/filings')) asked.push(request.url());
    });

    await page.goto('/');
    await expect(page.locator('#live-text')).not.toHaveText('connecting');

    await page.locator('#symbol').click();
    await page.locator('#symbol').pressSequentially('dividend', { delay: 30 });
    await page.locator('#symbol').press('Enter');

    // `q`, not `symbol`. The reader typed a word rather than choosing a row, and
    // the two mean different things.
    await expect
      .poll(() => asked.some((url) => url.includes('q=dividend')))
      .toBe(true);
    expect(asked.some((url) => url.includes('symbol=dividend'))).toBe(false);
    await expect(page.locator('#search-note')).toContainText('dividend');
  });
});

test.describe('the mouse', () => {
  test('clicking a suggestion applies it, and hovering moves the same highlight', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.locator('#live-text')).not.toHaveText('connecting');
    const options = await openSuggestions(page);
    test.skip((await options.count()) < 2, 'need two rows');

    // The pointer drives the SAME highlight the arrow keys do, so there is only
    // ever one row claiming to be what Enter would pick.
    await options.nth(1).hover();
    await expect(options.nth(1)).toHaveClass(/active/);
    await expect(page.locator('#suggest .sopt.active')).toHaveCount(1);

    const symbol = (await options.nth(1).locator('.ssym').textContent())?.trim();
    // THE REGRESSION THIS GUARDS: the input's blur handler closes the list, so
    // without preventDefault on mousedown the click lands on nothing at all.
    await options.nth(1).click();

    await expect(page.locator('#symbol')).toHaveValue(symbol as string);
    await expect(page.locator('#suggest')).toBeHidden();
  });

  test('clicking away dismisses the list', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#live-text')).not.toHaveText('connecting');
    await openSuggestions(page);

    // ABOVE the box, not below it. The list overlays the chips and the top of
    // the feed on purpose — a control row that jumped 200px down the page every
    // time somebody typed would be a control row that gets misclicked — so a
    // click below the input lands ON the list, which is the correct behaviour
    // and not a dismissal. The first version of this test clicked the feed and
    // failed for exactly that reason.
    await page.locator('.hero').click({ position: { x: 5, y: 5 } });

    await expect(page.locator('#suggest')).toBeHidden();
  });
});

test.describe('untrusted text', () => {
  test('renders a query as text and never as markup', async ({ page }) => {
    // THE ONE ATTACKER-CONTROLLED STRING THIS FEATURE ADDS TO THE PAGE. The
    // suggestion rows carry exchange-supplied company names, which this test
    // cannot inject; the search note echoes the reader's own query, which it
    // can — and both go through the same textContent rule. If innerHTML ever
    // creeps into either, this is where it shows up.
    const errors = watchConsole(page);
    await page.goto('/');
    await expect(page.locator('#live-text')).not.toHaveText('connecting');

    const payload = '<img src=x onerror=alert(1)><script>alert(2)</script>';
    await page.locator('#symbol').click();
    await page.locator('#symbol').fill(payload);
    await page.locator('#symbol').press('Enter');

    await expect(page.locator('#search-note')).toBeVisible();
    // The literal characters, as text.
    await expect(page.locator('#search-note')).toContainText('<img');
    // And no element was created from them, anywhere on the page.
    expect(await page.locator('#search-note img, #search-note script').count()).toBe(0);
    expect(await page.locator('body img').count()).toBe(0);
    expect(errors).toEqual([]);
  });

  test('answers a query of pure punctuation with an empty feed, not an error', async ({
    page,
  }) => {
    const errors = watchConsole(page);
    await page.goto('/');
    await expect(page.locator('#live-text')).not.toHaveText('connecting');

    await page.locator('#symbol').fill('---');
    await page.locator('#symbol').press('Enter');

    // No alert banner: a query holding no searchable term is an empty result,
    // and the page must not render it as the server having failed.
    await expect(page.locator('#feed .emptyfeed')).toBeVisible();
    await expect(page.locator('#alert')).toBeHidden();
    expect(errors).toEqual([]);
  });
});

test('an empty feed after a pick says what the company actually has', async ({
  page,
  request,
}) => {
  // THE TRAP THIS CLOSES. The insight filter is on by default, so picking a
  // company with no verified filing empties the feed — and a reader who was
  // just LOOKING at that company's filing count in the suggestion list reads a
  // generic "nothing verifiable yet" as the search being broken. The count came
  // back with the suggestion, so the page can say it rather than imply nothing.
  //
  // THE SUBJECT IS FOUND THROUGH THE API rather than guessed at in the DOM.
  // Which companies happen to have a verified filing changes as the worker
  // drains, so an earlier version that arrowed to the last suggestion and hoped
  // reported a SKIP on most runs — a green suite that had tested nothing.
  const suggested = await request.get('/api/suggest?q=' + BROAD_PREFIX);
  const companies = (await suggested.json()).data.companies as {
    symbol: string;
  }[];

  let subject: string | null = null;
  for (const company of companies) {
    const verified = await request.get(
      '/api/filings?limit=1&tier=verified&symbol=' + company.symbol,
    );
    if ((await verified.json()).meta.total === 0) {
      subject = company.symbol;
      break;
    }
  }
  test.skip(subject === null, 'every suggested company has a verified filing');

  await page.goto('/');
  await expect(page.locator('#live-text')).not.toHaveText('connecting');
  await expect(page.locator('#only-insights')).toBeChecked();

  await page.locator('#symbol').click();
  await page.locator('#symbol').pressSequentially(subject as string, {
    delay: 30,
  });
  await expect(page.locator('#suggest .sopt').first()).toBeVisible();
  await page.locator('#symbol').press('ArrowDown');
  await page.locator('#symbol').press('Enter');

  const empty = page.locator('#feed .emptyfeed');
  await expect(empty).toContainText(subject as string);
  await expect(empty).toContainText('filing(s)');
  // And it names the way out rather than leaving the reader to find it.
  await expect(empty).toContainText('Untick the filter');
});

test('a picked company is undone by typing, not left stuck on', async ({
  page,
}) => {
  // THE BUG THIS GUARDS. Picking a company sets an exact `symbol` filter and
  // puts the ticker in the box. Editing that text back down to a fragment has to
  // release the filter — otherwise the box says one thing, the feed shows
  // another, and the only way out is the Clear button in a different tab.
  const asked: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('api/filings')) asked.push(request.url());
  });

  await page.goto('/');
  await expect(page.locator('#live-text')).not.toHaveText('connecting');

  const options = await openSuggestions(page);
  test.skip((await options.count()) === 0, 'no company matched');
  await page.locator('#symbol').press('ArrowDown');
  await page.locator('#symbol').press('Enter');
  await expect(page.locator('#search-note')).toBeVisible();

  await page.locator('#symbol').press('Backspace');
  await expect(page.locator('#search-note')).toBeHidden();

  asked.length = 0;
  await page.locator('#symbol').press('Enter');
  await expect.poll(() => asked.length).toBeGreaterThan(0);
  expect(asked.every((url) => !url.includes('symbol='))).toBe(true);
});
