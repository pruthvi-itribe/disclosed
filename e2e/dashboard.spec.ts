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

/**
 * Whether this host was built with the operator panel.
 *
 * `ADMIN_ENABLED` decides it at boot and the suite runs against one already
 * running dashboard, so a test about the panel asks the page rather than
 * assuming. The panel's own contract — that the markup and the routes agree
 * whichever way it went — is `e2e/admin.spec.ts`; these four are about what
 * the panel DOES, which is only a question where it exists.
 */
const adminBuilt = async (page: Page): Promise<boolean> =>
  (await page.locator('#tab-admin').count()) > 0;

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
    test.skip(!(await adminBuilt(page)), 'no operator panel on this host');
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
    test.skip(!(await adminBuilt(page)), 'no operator panel on this host');
    await expect(page.locator('#live-text')).not.toHaveText('connecting');

    // The Admin table is populated even while the feed is the visible view.
    // Rendering only what is on screen would make a tab switch cost a round
    // trip and let the two views drift.
    const adminRows = await page.locator('#rows tr:not(.detail)').count();
    const feedCards = await page.locator('#feed .card').count();
    if (feedCards > 0) expect(adminRows).toBeGreaterThan(0);
  });
});

/**
 * The dividers, which used to be a rolling window and are now calendar days.
 *
 * The reported bug: at 09:00 a filing from 17:00 the previous evening was
 * sixteen hours old, and the old buckets called anything under 24h 'Today'. So
 * two market days sat under one heading. `script-feed.spec.ts` proves the
 * function; these two prove the page is wired to the server's IST day.
 */
test.describe('the feed dividers', () => {
  /** The feed's own opening question: 25 verified rows, newest first. */
  const FEED_QUERY = 'api/filings?limit=25&offset=0&tier=verified';

  /**
   * The divider text as the SCRIPT WROTE IT.
   *
   * `textContent`, not `innerText`: `.bucket` is `text-transform: uppercase`,
   * so the rendered text is 'EARLIER TODAY' and an assertion against it would
   * be pinning the stylesheet rather than the bucketing rule.
   */
  const dividers = async (page: Page): Promise<string[]> => {
    await expect(page.locator('#feed h2.bucket')).not.toHaveCount(0);
    return page.locator('#feed h2.bucket').allTextContents();
  };

  test('names every divider a day, and never a rolling window', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.locator('#live-text')).not.toHaveText('connecting');
    await expect(page.locator('#feed .card, #feed .emptyfeed')).not.toHaveCount(
      0,
    );

    const labels = await dividers(page);
    for (const label of labels) {
      // The closed vocabulary. 'Today' and 'Earlier' are gone on purpose: the
      // first could not tell this morning from last night, and the second
      // swallowed every day before yesterday into one heading.
      expect([
        label,
        label === 'Just now' ||
          label === 'Earlier today' ||
          label === 'Yesterday' ||
          /^\d{4}-\d{2}-\d{2}$/.test(label),
      ]).toEqual([label, true]);
    }
    expect(labels).not.toContain('Today');
    expect(labels).not.toContain('Earlier');
  });

  test('names Yesterday when the feed reaches into yesterday', async ({
    page,
  }) => {
    // SEED-DEPENDENT, AND SKIPPED HONESTLY. Whether the opening 25 rows cross
    // an IST midnight depends on how busy the exchange has been, and asserting
    // a heading that the data cannot produce would be a test that fails on a
    // quiet Monday morning. So the same two routes the page reads are asked
    // first, and the test says which case it saw.
    const summary = await page.request.get('api/summary');
    expect(summary.status()).toBe(200);
    const { todayIstDay, previousIstDay } = (await summary.json()).data;

    const filings = await page.request.get(FEED_QUERY);
    expect(filings.status()).toBe(200);
    const days: string[] = (await filings.json()).data.map(
      (row: { istDay: string }) => row.istDay,
    );

    test.skip(
      !days.includes(previousIstDay),
      `the opening ${days.length} rows hold no filing from ${previousIstDay} ` +
        `(they span ${[...new Set(days)].join(', ') || 'nothing'}), so there ` +
        'is no Yesterday to name',
    );

    await page.goto('/');
    await expect(page.locator('#live-text')).not.toHaveText('connecting');
    await expect(page.locator('#feed .card')).not.toHaveCount(0);

    const labels = await dividers(page);
    expect(labels.filter((label) => label === 'Yesterday')).toHaveLength(1);

    // AND TODAY IS A HEADING OF ITS OWN ABOVE IT. The pair is the point: one
    // heading over both days was the bug, and 'Yesterday' appearing second
    // says the split happened.
    if (days.includes(todayIstDay)) {
      expect(labels.indexOf('Yesterday')).toBeGreaterThan(0);
      // Today is named in words, never by its date.
      expect(labels).not.toContain(todayIstDay);
    }
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
    // THE FIRST HALF HOLDS EVERYWHERE: the chips are gone from the feed on
    // every host. Where they went is only a question where Admin was built.
    test.skip(!(await adminBuilt(page)), 'no operator panel on this host');
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

test('offers a way to the claims a card had no room for', async ({ page }) => {
  // '+ 6 more' as dead text tells a reader the card is hiding something and
  // gives them nowhere to go. The card stops at two because eleven is a wall;
  // it says so because silently truncating would make a partial card look
  // complete; and the control has to DO something.
  //
  // IT NO LONGER GROWS THE CARD. Expanding in place pushed every other card in
  // the grid row down and reflowed the feed under whoever clicked, and it could
  // not show the sentence in the document each claim was matched against. The
  // control opens the focus card now — `e2e/focus.spec.ts` is where that
  // behaviour is tested; what belongs HERE is that the feed still offers it.
  await page.goto('/');
  await expect(page.locator('#live-text')).not.toHaveText('connecting');

  // PINNED BY seqId, not by position. A Playwright locator is a lazy query and
  // the feed repaints every four seconds; two earlier versions of this test
  // failed on exactly that and the product was fine both times.
  const anyExpandable = page
    .locator('#feed .card')
    .filter({ has: page.locator('[data-ui="card-more"]') })
    .first();
  test.skip(
    (await anyExpandable.count()) === 0,
    'no card currently has more than two insights',
  );

  const seq = await anyExpandable.getAttribute('data-seq');
  const card = page.locator('#feed .card[data-seq="' + seq + '"]');
  const shown = await card.locator('.insights li').count();

  await expect(card.locator('[data-ui="card-more"]')).toContainText(/\+ \d+ more/);
  await card.locator('[data-ui="card-more"]').click();

  // The dialog, with more claims in it than the card was showing.
  await expect(page.locator('#focus')).toBeVisible();
  expect(
    await page.locator('[data-ui="focus-claims"] li').count(),
  ).toBeGreaterThan(shown);

  // AND THE CARD IS UNTOUCHED. That is the change: the feed does not reflow
  // under a reader who asked to see one filing.
  await page.keyboard.press('Escape');
  expect(await card.locator('.insights li').count()).toBe(shown);
});

/**
 * Opens ONE NAMED COMPANY's page, rather than whichever one is on top.
 *
 * The three reader sections are absent for most companies by design — 15 of
 * 1,286 carry a results table, 50 carry a dated commitment — so a test that
 * clicked the first card would assert almost nothing almost every time. There
 * is no deep link into the company view on purpose (the feed is the way in), so
 * this walks the reader's own path: type the ticker, take the suggestion, click
 * the card.
 */
const openCompany = async (page: Page, symbol: string): Promise<void> => {
  await page.goto('/');
  await expect(page.locator('#live-text')).not.toHaveText('connecting');
  await page.locator('#symbol').click();
  await page.locator('#symbol').fill(symbol);
  await page.locator('#symbol').press('Enter');
  await expect(page.locator('#feed .card button.sym').first()).toHaveText(
    symbol,
  );
  await page.locator('#feed .card button.sym').first().click();
  await expect(page.locator('#co-symbol')).toHaveText(symbol);
  // THE BANNER, ASSERTED ON EVERY WAY IN. Deleting the filing strip took a
  // `WEEKDAY_NAME` with it that the ADMIN panel still read, and the fragments
  // share one scope — so the page parsed, served a 200, rendered this view
  // perfectly and failed every poll with "WEEKDAY_NAME is not defined". A
  // `pageerror` listener does not see it: the poll catches its own errors and
  // says so here, which is the design working and the only place it shows.
  await expect(page.locator('#alert')).toBeHidden();
};

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

    // THE COVERAGE LINE IS THE POINT, and since the filing strip went it is the
    // only thing on the page about the shape of our holdings rather than about
    // the company. Measured 2026-08-08 the collection holds 3,900 filings over
    // 1,286 companies and most have filed once or twice, so every number below
    // it is computed over a window the reader has to be told about.
    // context-line.ts settled the principle: a claim about thirty days, made by
    // a database holding four, is every word true and the whole sentence false.
    await expect(page.locator('#co-coverage')).toContainText('filings held');
    await expect(page.locator('#co-coverage')).toContainText('IST day');

    await expect(page.locator('#company-feed .card')).not.toHaveCount(0);
    // A caught error is still an error. See the note in `openCompany`.
    await expect(page.locator('#alert')).toBeHidden();
    expect(errors).toEqual([]);
  });

  test('draws no filing strip and no category bar', async ({ page }) => {
    // REMOVED, NOT HIDDEN. Both drew pictures of the pipeline rather than of
    // the company — how many squares landed on a Tuesday, and what share of a
    // company's filings NSE files under 'Governance'. A hidden element would
    // leave the CSS and the renderer alive behind it.
    await page.goto('/');
    await expect(page.locator('#live-text')).not.toHaveText('connecting');
    await page.locator('#feed .card button.sym').first().click();
    await expect(page.locator('#co-symbol')).not.toBeEmpty();

    await expect(page.locator('#co-strip')).toHaveCount(0);
    await expect(page.locator('#co-mix-wrap')).toHaveCount(0);
  });

  test('shows a BSE-sourced industry, and says it is BSE’s', async ({
    page,
  }) => {
    // MOTHERSON is one of the 357 companies NSE printed no industry for and
    // BSE's scrip header classifies as "Auto Components & Equipments" (measured
    // 2026-08-09 with `npm run company:industry`). Before the BSE lookup its
    // chip was hidden, which was honest and was happening on 767 of 1,289.
    const errors = watchConsole(page);
    await openCompany(page, 'MOTHERSON');

    const chip = page.locator('#co-industry');
    await expect(chip).toBeVisible();
    await expect(chip).toContainText('Auto Components & Equipments');
    // THE MARK IS THE POINT. The two exchanges word the same company
    // differently, so a BSE string shown unmarked would be a quiet edit of the
    // record. The attribution is on the chip as well as in it, because a mark
    // beside a word is not a sentence a reader has to already understand.
    await expect(chip.locator('[data-ui="co-industry-source"]')).toHaveText(
      'BSE',
    );
    await expect(chip).toHaveAttribute('title', 'Industry as classified by BSE');
    expect(errors).toEqual([]);
  });

  test('leaves an NSE-sourced industry unmarked, as it always was', async ({
    page,
  }) => {
    // ECLERX carries NSE's own `smIndustry`. NSE's value is preferred whenever
    // there is one and no mark is drawn: an unmarked chip means what every chip
    // on this page meant before the BSE lookup existed.
    const errors = watchConsole(page);
    await openCompany(page, 'ECLERX');

    const chip = page.locator('#co-industry');
    await expect(chip).toBeVisible();
    await expect(chip).toHaveText('Computers - Software');
    await expect(chip.locator('[data-ui="co-industry-source"]')).toHaveCount(0);
    await expect(chip).toHaveAttribute('title', 'Industry as classified by NSE');
    expect(errors).toEqual([]);
  });

  test('prints the figures a results table carried, and computes none', async ({
    page,
  }) => {
    // IONEXCHANG's Q1 FY27 consolidated table is one of the 19 in the
    // collection that cleared the results gate (measured 2026-08-08 with
    // `npm run company:sections`).
    const errors = watchConsole(page);
    await openCompany(page, 'IONEXCHANG');

    await expect(page.locator('#co-figures-wrap')).toBeVisible();
    const rows = page.locator('#co-figures [data-ui="company-figure"]');
    await expect(rows).not.toHaveCount(0);

    // THE ROW IT WAS READ FROM travels with every figure, which is what lets a
    // reader find the same characters in the PDF.
    await expect(rows.first()).toHaveAttribute(
      'title',
      /^The document printed: "/,
    );

    // NOTHING IS COMPUTED. No percentage, no delta, no arrow — the section
    // prints the two tokens and the word between them is 'vs'. A '%' may only
    // appear inside a figure the document itself printed as a percentage, and
    // this table has none.
    const text = (await page.locator('#co-figures').textContent()) ?? '';
    expect(text).toContain('vs ');
    expect(text).not.toMatch(/[▲▼]/);
    expect(text).not.toMatch(/[+-]?\d+(\.\d+)?%/);

    // The basis is spelled out where a reader cannot skip it: the consolidated
    // and standalone statements in one filing differ by tens of per cent.
    await expect(page.locator('#co-figures .figbasis').first()).toHaveText(
      /consolidated|standalone/,
    );
    expect(errors).toEqual([]);
  });

  test('lists a dated commitment that has not passed, soonest first', async ({
    page,
  }) => {
    // HGS's 31st AGM is dated 25 September 2026 and appears in four of its
    // filings — the section shows it once.
    const errors = watchConsole(page);
    await openCompany(page, 'HGS');

    await expect(page.locator('#co-next-wrap')).toBeVisible();
    const items = page.locator('#co-next [data-ui="company-next-item"]');
    await expect(items).not.toHaveCount(0);

    const dates = (await items.locator('.nextwhen').allTextContents()).map((d) =>
      d.trim(),
    );
    expect(dates).toEqual([...dates].sort());
    // Every date is still ahead of the server's IST day, which is the whole
    // claim the heading makes. The page never computes this — the server sends
    // only the days that survived.
    const todayIst = new Date(Date.now() + 5.5 * 3_600_000)
      .toISOString()
      .slice(0, 10);
    for (const date of dates) expect(date > todayIst).toBe(true);

    // ONE ENTRY PER DATE AND WORD, however many filings repeated it.
    expect(new Set(dates).size).toBe(dates.length);
    // The sentence it was read from is quoted under it, so the date is
    // checkable against the document rather than asserted.
    await expect(items.first().locator('.planquote')).toContainText('"');
    expect(errors).toEqual([]);
  });

  test('marks movement in time order, with no colour and no count', async ({
    page,
  }) => {
    const errors = watchConsole(page);
    await page.goto('/');
    await expect(page.locator('#live-text')).not.toHaveText('connecting');
    await page.locator('#feed .card button.sym').first().click();
    await expect(page.locator('#co-symbol')).not.toBeEmpty();

    // 282 of 1,286 companies carry a marked claim, so whichever company is on
    // top decides whether this section exists. Absent is a valid outcome and
    // the assertions below are about what it looks like WHEN it is there.
    if (!(await page.locator('#co-marks-wrap').isVisible())) {
      expect(errors).toEqual([]);
      return;
    }

    const days = page.locator('#co-marks [data-ui="company-mark-day"]');
    await expect(days).not.toHaveCount(0);

    // OLDEST FIRST, so the row reads the way time does.
    const stamps = (await days.locator('.markwhen').allTextContents()).map((d) =>
      d.trim(),
    );
    expect(stamps).toEqual([...stamps].sort());

    const marks = page.locator('#co-marks [data-ui="company-mark"]');
    await expect(marks).not.toHaveCount(0);
    // NO COUNT ANYWHERE. A tally of increases against decreases is a verdict on
    // a company, and 13 of the 45 printed decreases in this collection are
    // falling bad loans, debt or emissions.
    //
    // Asserted by REMOVING THE DAY KEYS AND LOOKING FOR A DIGIT, because the
    // obvious version does not work: `textContent` runs "2026-08-08" straight
    // into the first glyph, so a pattern for "a number beside a mark" matches
    // the date itself. Everything in this section is a day or a glyph, so
    // nothing but a tally could put a digit here.
    let rest = (await page.locator('#co-marks').textContent()) ?? '';
    for (const stamp of stamps) rest = rest.split(stamp).join('');
    expect(rest).not.toMatch(/\d/);
    // NO COLOUR, checked on the rendered pixels rather than on the stylesheet:
    // red and green would be the sentiment claim smuggled back in through CSS.
    const colours = await marks.evaluateAll((nodes) =>
      nodes.map((node) => getComputedStyle(node).color),
    );
    expect(new Set(colours).size).toBe(1);
    expect(errors).toEqual([]);
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
    // And the limit select still holds a real option — where there IS one.
    // It lives in the Admin section, which a host built without the panel does
    // not have; the growth path above is the feed's own and does not need it.
    if ((await page.locator('#limit').count()) > 0) {
      expect(['50', '100', '200']).toContain(
        await page.locator('#limit').inputValue(),
      );
    }
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

    if ((await page.locator('#limit').count()) === 0) {
      // No panel on this host, so the select this test is about is not here.
      // The growth itself is covered by the sibling test above.
      return;
    }

    const value = await page.locator('#limit').inputValue();
    // Auto-load may have advanced a step beyond the two clicks by the time
    // this reads; any real option except the floor proves the growth path.
    expect(['50', '100', '200', '500']).toContain(value);
    expect(value).not.toBe('');
  });

  test('does not move the hero while it grows the feed', async ({ page }) => {
    // THE BUG THIS PINS. The hero's second number used to be counted in the
    // browser over the rows the feed had loaded, beside a first number the
    // server had computed over the IST day — two units, two windows, one
    // sentence. Every Load more pushed the second up and left the first alone,
    // until the pair read "8 filings today / 44 verified insights".
    await page.goto('/');
    await expect(page.locator('#live-text')).not.toHaveText('connecting');

    const number = async (id: string): Promise<number> =>
      Number(
        ((await page.locator(id).textContent()) ?? '').replace(/[^0-9]/g, ''),
      );

    const today = await number('#hero-today');
    const said = await number('#hero-insights');

    // The relation the copy claims: "N filings today", "M of them said
    // something". M is a subset of N or the sentence is false.
    expect(said).toBeLessThanOrEqual(today);

    const more = page.locator('#feed-more');
    if (await more.isHidden()) return; // fewer filings than one page holds
    await more.click();
    await page.waitForTimeout(1_500);
    await more.click();
    await page.waitForTimeout(1_500);

    expect(await number('#hero-today')).toBe(today);
    expect(await number('#hero-insights')).toBe(said);
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

    // Clear lives in Admin's filter bar and goes with it. Nothing is stranded
    // by that: the only filters a reader can set without the panel are the
    // search box, which has its own clear, the topic row, whose "Everything"
    // chip is a clear, and the insight toggle.
    test.skip(!(await adminBuilt(page)), 'no operator panel on this host');
    await page.locator('#tab-admin').click();
    await page.locator('#clear').click();
    await page.locator('#tab-feed').click();
    await expect(page.locator('.chip[data-topic=""]')).toHaveClass(/active/);
    await expect(page.locator('.chip[data-topic="financial"]')).not.toHaveClass(
      /active/,
    );
  });
});

/**
 * PLANS — the chip in the feed and the quoted section on a company page.
 *
 * Both read the same pair of claim kinds, `guidance` and `target`, and both
 * show the company's own printed sentence rather than anything derived from it.
 * These tests drive the pair end to end: the chip changes the request the page
 * makes, and the section it leads to quotes and dates what came back.
 */
test.describe('plans, in their words', () => {
  test('narrows the feed to the filings where a company said what it plans', async ({
    page,
  }) => {
    const errors = watchConsole(page);
    const asked: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('api/filings')) asked.push(r.url());
    });

    await page.goto('/');
    await expect(page.locator('#live-text')).not.toHaveText('connecting');

    await page.locator('.chip[data-plans="only"]').click();
    await expect(page.locator('.chip[data-plans="only"]')).toHaveClass(/active/);
    // The pair, as one filter the server allowlists. `plans=guidance` is a 400.
    await expect
      .poll(() => asked.some((url) => url.includes('plans=only')))
      .toBe(true);
    await expect(page.locator('#feed .card, #feed .emptyfeed')).not.toHaveCount(
      0,
    );

    // ONE LENS AT A TIME. The row holds two axes, so picking a topic has to put
    // the Plans chip out — otherwise the feed is narrowed by both while only
    // one chip says so.
    await page.locator('.chip[data-topic="financial"]').click();
    await expect(page.locator('.chip[data-plans="only"]')).not.toHaveClass(
      /active/,
    );
    await expect(page.locator('.chip[data-topic="financial"]')).toHaveClass(
      /active/,
    );
    expect(errors).toEqual([]);
  });

  test('quotes a company on its own page, dated, and hides the section when there is nothing to quote', async ({
    page,
  }) => {
    const errors = watchConsole(page);
    await page.goto('/');
    await expect(page.locator('#live-text')).not.toHaveText('connecting');

    // REACHED THROUGH THE CHIP, so the company opened is one that has something
    // to quote. Picking the first card of the unfiltered feed would land on a
    // company with no plan nine times in ten — 128 of 3,466 filings carry one.
    await page.locator('.chip[data-plans="only"]').click();
    await expect(page.locator('#feed .card')).not.toHaveCount(0);
    await page.locator('#feed .card button.sym').first().click();
    await expect(page.locator('#co-symbol')).not.toBeEmpty();

    const quotes = page.locator('[data-ui="company-plan"]');
    await expect(page.locator('#co-plans-wrap')).toBeVisible();
    await expect(quotes).not.toHaveCount(0);
    // The document's own sentence, in quotation marks that are text, and the
    // server's IST day under it — the browser formats no timestamp.
    await expect(quotes.first().locator('.planquote')).toContainText('"');
    await expect(quotes.first().locator('.planwhen')).toHaveText(
      /^\d{4}-\d{2}-\d{2}$/,
    );

    // AND THE ABSENCE IS THE SAME RULE. Back on the unfiltered feed, whichever
    // company the first card belongs to, the section is shown exactly when it
    // has a quote to show — there is no floor above one.
    await page.locator('#company-back').click();
    await page.locator('.chip[data-topic=""]').click();
    await expect(page.locator('#feed .card')).not.toHaveCount(0);
    await page.locator('#feed .card button.sym').first().click();
    await expect(page.locator('#co-symbol')).not.toBeEmpty();
    // BOTH FACTS READ IN ONE PASS OVER THE DOM. Asking Playwright for the
    // visibility and then for the count is two reads with a live page between
    // them, and this assertion failed once in a full-suite run on exactly that
    // shape: the section is rebuilt on the four-second repaint, and comparing
    // one render's flag against another render's count compares two pages.
    const [shown, quoted] = await page.evaluate(() => [
      document.getElementById('co-plans-wrap')?.hidden === false,
      document.querySelectorAll('[data-ui="company-plan"]').length > 0,
    ]);
    expect(shown).toBe(quoted);
    expect(errors).toEqual([]);
  });
});

test.describe('the feed layout', () => {
  test('starts the feed high enough to read one on a laptop', async ({
    page,
  }) => {
    // WHAT THIS PINS IS A DISTANCE, not a design. The hero and the control bar
    // are standing chrome — the same pixels on every visit, spent before the
    // first thing a reader came for. Measured before the compression: 384px at
    // 1440x900 and 655px at 390x844, the second of which is 78% of the way down
    // a phone. After: 272px and 422px.
    //
    // The ceilings are the measured values with room to move, because the
    // numbers depend on real data — a hidden search note and a hidden direction
    // legend both appear on some days. What they refuse is a new row of
    // furniture, which is worth about 30px each time.
    for (const [width, height, ceiling] of [
      [1440, 900, 320],
      [390, 844, 470],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.goto('/');
      await expect(page.locator('#live-text')).not.toHaveText('connecting');
      // At 390 the script opens the deck; this is about the feed.
      await page.locator('#tab-feed').click();
      await expect(page.locator('#feed .card').first()).toBeVisible();

      const top = await page.evaluate(() =>
        Math.round(
          document.querySelector('#feed .card')!.getBoundingClientRect().top,
        ),
      );

      expect([width, top <= ceiling]).toEqual([width, true]);
    }
  });

  test('never scrolls sideways, at any width a phone has', async ({ page }) => {
    // A grid track floored at a bare 400px cannot shrink below it, so at 390px
    // the feed was 400px wide inside a 350px column and every card ran off the
    // right edge — measured scrollWidth 420 against clientWidth 390. Invisible
    // until now because the feed is not what a phone lands on.
    for (const width of [390, 414, 430]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto('/');
      await expect(page.locator('#live-text')).not.toHaveText('connecting');
      await page.locator('#tab-feed').click();
      await expect(page.locator('#feed .card').first()).toBeVisible();

      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );

      expect([width, overflow]).toEqual([width, 0]);
    }
  });

  test('drops the card meta to its own row rather than on top of the name', async ({
    page,
  }) => {
    // The card meta takes width:100% on a narrow screen, and the row it was
    // dropping to did not exist: .cardhead was a flex line with no wrap, so
    // the timestamp rendered ON TOP of the ticker.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.locator('#live-text')).not.toHaveText('connecting');
    await page.locator('#tab-feed').click();
    await expect(page.locator('#feed .card').first()).toBeVisible();

    const overlaps = await page.evaluate(() =>
      [...document.querySelectorAll('#feed .card')].filter((card) => {
        const who = card.querySelector('.who')?.getBoundingClientRect();
        const meta = card.querySelector('.cardmeta')?.getBoundingClientRect();
        if (!who || !meta) return false;
        // Same row means they share vertical space; on a wrapped head they
        // must not.
        return meta.top < who.bottom - 1 && meta.left < who.right - 1;
      }).length,
    );

    expect(overlaps).toBe(0);
  });

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
