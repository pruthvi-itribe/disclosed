import { expect, test, type Page } from '@playwright/test';

/**
 * The focus card, opened and closed in a browser.
 *
 * WHY NONE OF THIS COULD BE A STRING TEST. `page.spec.ts` can prove the dialog
 * shell is in the served HTML and that the fragment addresses the right ids. It
 * cannot prove that a click opens it, that Escape closes it, that focus comes
 * back to the element it left, or that the panel survives the four-second
 * repaint that rebuilds every card underneath it. Every one of those is a claim
 * about a browser executing this page, and every one of them breaks silently.
 *
 * EVERY CARD IS PINNED BY `data-seq`, never by index. The feed repaints every
 * four seconds and a Playwright locator is a lazy query, so "the first card
 * with an expander" names a different card before and after a click.
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

/** The seqId of a card that is on screen, pinned before anything is clicked. */
const aCardSeq = async (page: Page): Promise<string> => {
  await expect(page.locator('#live-text')).not.toHaveText('connecting');
  await expect(page.locator('#feed .card[data-seq]')).not.toHaveCount(0);
  const seq = await page
    .locator('#feed .card[data-seq]')
    .first()
    .getAttribute('data-seq');
  expect(seq).not.toBeNull();
  return seq as string;
};

test.describe('the focus card', () => {
  test('opens from a card, and shows what the card had no room for', async ({
    page,
  }) => {
    const errors = watchConsole(page);
    await page.goto('/');
    const seq = await aCardSeq(page);

    await expect(page.locator('#focus-back')).toBeHidden();
    await page.locator(`#feed .card[data-seq="${seq}"]`).click();

    const dialog = page.locator('#focus');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('role', 'dialog');
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    // The identity, the tier and the category all arrive with it.
    await expect(page.locator('#focus-symbol')).not.toBeEmpty();
    await expect(page.locator('[data-ui="focus-tier"]')).toBeVisible();
    await expect(page.locator('[data-ui="focus-category"]')).not.toBeEmpty();
    expect(errors).toEqual([]);
  });

  test('shows every claim, and the span under each one', async ({ page }) => {
    // THE REASON THE DIALOG EXISTS. The card stops at two claims because a grid
    // row is as tall as its tallest card; nothing here is in a grid, and the
    // spans lived only in the Admin table until now.
    await page.goto('/');

    // A card with more claims than the card can show, found by its own control
    // rather than by guessing which filing is busy today.
    const more = page.locator('#feed [data-ui="card-more"]').first();
    if ((await more.count()) === 0) {
      test.skip(
        true,
        'no filing in the live collection currently carries more than two claims',
      );
    }

    const card = page.locator('#feed .card', { has: more });
    const seq = await card.first().getAttribute('data-seq');
    const shown = await page
      .locator(`#feed .card[data-seq="${seq}"] [data-ui="card-claims"] li`)
      .count();

    await page.locator(`#feed .card[data-seq="${seq}"] [data-ui="card-more"]`).click();

    const claims = page.locator('[data-ui="focus-claims"] li');
    expect(await claims.count()).toBeGreaterThan(shown);
    // Each one quotes the document it was matched against — folded, so the
    // panel reads as claims, and one tap from the claim it belongs to.
    await page.locator('[data-ui="focus-span-toggle"]').first().click();
    await expect(page.locator('[data-ui="focus-span"]').first()).toContainText(
      'matched in the document',
    );
  });

  test('folds each quote away, and gives back the same sentence on request', async ({
    page,
  }) => {
    // THE CARD IS A SCAN, THE DIALOG IS A READ, AND NEITHER IS A WALL OF GREY.
    // What this has to prove is the pair of them: that the quote is genuinely
    // not on screen when the dialog opens, and that the control brings back the
    // sentence itself rather than a placeholder or a re-render of the claim.
    await page.goto('/');
    const seq = await aCardSeq(page);
    await page.locator(`#feed .card[data-seq="${seq}"]`).click();
    await expect(page.locator('#focus')).toBeVisible();

    const toggle = page.locator('[data-ui="focus-span-toggle"]').first();
    if ((await toggle.count()) === 0) {
      test.skip(
        true,
        'the filing this card opened carries no verified claim with a stored span',
      );
    }
    const quotes = page.locator('[data-ui="focus-spans"]').first();

    // CLOSED ON OPEN, and the button says what pressing it will do.
    await expect(quotes).toBeHidden();
    await expect(toggle).toHaveText('Show source line');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    // Read off the folded node, so the comparison after the tap is against the
    // exact string the dialog was already holding rather than against a
    // fragment of it retyped here.
    const quoted = await quotes.textContent();
    expect(quoted).toContain('matched in the document');

    await toggle.click();
    await expect(quotes).toBeVisible();
    await expect(quotes).toHaveText(quoted ?? '');
    await expect(toggle).toHaveText('Hide');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    // And back. A disclosure that only opens is an expander with extra steps.
    await toggle.click();
    await expect(quotes).toBeHidden();
    await expect(toggle).toHaveText('Show source line');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  test('opens every quote folded again after the dialog is closed', async ({
    page,
  }) => {
    // The reveal is not remembered, and that is the design rather than an
    // omission: the body is emptied on close, so there is no state to keep and
    // none is kept.
    await page.goto('/');
    const seq = await aCardSeq(page);
    const card = page.locator(`#feed .card[data-seq="${seq}"]`);

    await card.click();
    const toggle = page.locator('[data-ui="focus-span-toggle"]').first();
    if ((await toggle.count()) === 0) {
      test.skip(
        true,
        'the filing this card opened carries no verified claim with a stored span',
      );
    }
    await toggle.click();
    await expect(page.locator('[data-ui="focus-spans"]').first()).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator('#focus-back')).toBeHidden();

    await card.click();
    await expect(page.locator('#focus')).toBeVisible();
    await expect(page.locator('[data-ui="focus-spans"]').first()).toBeHidden();
    await expect(
      page.locator('[data-ui="focus-span-toggle"]').first(),
    ).toHaveText('Show source line');
  });

  test('closes on Escape, on the backdrop and on the X, and gives focus back', async ({
    page,
  }) => {
    await page.goto('/');
    const seq = await aCardSeq(page);
    const card = page.locator(`#feed .card[data-seq="${seq}"]`);

    // Focus is put on the card first, so there is something to give back to.
    await card.focus();
    await card.press('Enter');
    await expect(page.locator('#focus')).toBeVisible();
    // The close button takes focus on open, which is where a keyboard reader
    // needs to land.
    await expect(page.locator('#focus-close')).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(page.locator('#focus-back')).toBeHidden();
    // RESTORED. A dialog that closes and drops the reader at the top of the
    // document has lost their place in a feed of sixty cards.
    await expect(page.locator(`#feed .card[data-seq="${seq}"]`)).toBeFocused();

    // The X.
    await card.click();
    await expect(page.locator('#focus')).toBeVisible();
    await page.locator('#focus-close').click();
    await expect(page.locator('#focus-back')).toBeHidden();

    // The backdrop, and only the backdrop: a click that starts inside the panel
    // must not close it, which is what selecting a span to copy looks like.
    await card.click();
    await expect(page.locator('#focus')).toBeVisible();
    await page.locator('#focus-symbol').click();
    await expect(page.locator('#focus')).toBeVisible();
    await page.locator('#focus-back').click({ position: { x: 5, y: 5 } });
    await expect(page.locator('#focus-back')).toBeHidden();
  });

  test('empties itself on close rather than merely hiding', async ({ page }) => {
    // A hidden node keeps every claim and quoted span in the document —
    // invisible, and still there on a shared screen.
    await page.goto('/');
    const seq = await aCardSeq(page);

    await page.locator(`#feed .card[data-seq="${seq}"]`).click();
    await expect(page.locator('#focus-body')).not.toBeEmpty();

    await page.keyboard.press('Escape');
    await expect(page.locator('#focus-body')).toBeEmpty();
    await expect(page.locator('#focus-foot')).toBeEmpty();
  });

  test('survives the four-second repaint that rebuilds the feed', async ({
    page,
  }) => {
    // THE REPAINT IS THE TEST. The dialog lives outside #feed precisely so a
    // poll cannot close it under a reader mid-sentence; a version rendered into
    // the card it came from would vanish right here.
    await page.goto('/');
    const seq = await aCardSeq(page);

    await page.locator(`#feed .card[data-seq="${seq}"]`).click();
    const symbol = await page.locator('#focus-symbol').textContent();

    await page.waitForTimeout(4600);

    await expect(page.locator('#focus')).toBeVisible();
    await expect(page.locator('#focus-symbol')).toHaveText(symbol ?? '');
  });

  test('does not open when the click was on a control inside the card', async ({
    page,
  }) => {
    // Swallowing a click on a link is how a link stops being one, and opening a
    // dialog on top of a company page nobody asked for is the same mistake in
    // the other direction.
    await page.goto('/');
    await expect(page.locator('#live-text')).not.toHaveText('connecting');

    await page.locator('#feed .card[data-seq] .sym').first().click();

    await expect(page.locator('#focus-back')).toBeHidden();
    await expect(page.locator('#view-company')).toBeVisible();
  });

  test('keeps Tab inside the panel', async ({ page }) => {
    // Without a trap, aria-modal is a claim the page does not honour: a keyboard
    // reader tabs out into a feed their software was told is inert, and nothing
    // looks wrong on screen while they do it.
    await page.goto('/');
    const seq = await aCardSeq(page);
    await page.locator(`#feed .card[data-seq="${seq}"]`).click();
    await expect(page.locator('#focus')).toBeVisible();

    for (let press = 0; press < 12; press += 1) {
      await page.keyboard.press('Tab');
      const inside = await page.evaluate(() => {
        const dialog = document.getElementById('focus-back');
        return dialog !== null && dialog.contains(document.activeElement);
      });
      expect(inside).toBe(true);
    }
  });

  test('opens as a sheet on a phone, without scrolling the page sideways', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    // AT 430px AND BELOW THE PAGE OPENS THE BRIEF, not the feed — the deck is
    // the phone object and the card grid is the desktop one. Both tabs are on
    // both, so the feed is one tap away, and it is the feed's cards this test
    // is about.
    await page.locator('#tab-feed').click();
    await expect(page.locator('#live-text')).not.toHaveText('connecting');
    await expect(page.locator('#feed .card[data-seq]')).not.toHaveCount(0);

    const seq = await page
      .locator('#feed .card[data-seq]')
      .first()
      .getAttribute('data-seq');
    // MEASURED BEFORE AND AFTER, and the assertion is on the DELTA.
    //
    // The feed itself already overflows a 390px viewport by 30px, and that is
    // by design rather than a bug this test should be reporting: the card grid
    // is a desktop object with a 400px minimum column, which is exactly why the
    // page opens the Brief instead below 430px (see page.ts). Asserting an
    // absolute zero here would fail on a pre-existing, deliberate property of a
    // view this test had to switch to by hand — and would say nothing about the
    // dialog. What the dialog owes is that opening it costs no further sideways
    // scroll, which is what the earlier version of these styles got wrong: the
    // monospaced results line set nowrap made the panel as wide as the filing.
    const before = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );

    await page.locator(`#feed .card[data-seq="${seq}"]`).click();
    await expect(page.locator('#focus')).toBeVisible();

    const after = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(after).toBeLessThanOrEqual(before);

    // And the panel itself fits the phone it is on.
    const panel = await page.locator('#focus').boundingBox();
    expect(panel?.width ?? 0).toBeLessThanOrEqual(390);
  });
});
