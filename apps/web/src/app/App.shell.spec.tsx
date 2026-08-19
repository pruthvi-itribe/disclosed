import { fireEvent } from '@testing-library/react';
import { flush, renderApp } from './app.fixtures';

/**
 * The shell's chrome, driven through App with the boot mark set — the
 * browser never carries the class, so every other App spec exercises the
 * web layout untouched.
 */
describe('the shell chrome', () => {
  beforeEach(() => {
    document.documentElement.classList.add('native-shell');
  });
  afterEach(() => {
    document.documentElement.classList.remove('native-shell');
  });

  it('moves the tabs to the bottom bar and slims the header', async () => {
    const { container } = await renderApp();
    expect(container.querySelector('[data-ui="bottom-nav"]')).not.toBeNull();
    // The top bar keeps brand and the live dot; its tabs and Sign out moved.
    expect(container.querySelector('#tab-feed')).toBeNull();
    expect(container.querySelector('#signout')).toBeNull();
    expect(container.querySelector('[data-ui="brand-logo"]')).not.toBeNull();
    // The feed is decluttered: search and filters live behind the sheet,
    // and the hero is its one-line form — three stacked stats pushed the
    // first card below a phone's fold.
    expect(container.querySelector('#symbol')).toBeNull();
    expect(container.querySelector('.herocompact')).not.toBeNull();
    expect(container.querySelector('.herostat')).toBeNull();
  });

  it('opens search and filters as a sheet, the same controls relocated', async () => {
    const { container } = await renderApp();
    fireEvent.click(
      container.querySelector('[data-ui="filter-fab"]') as Element,
    );
    await flush();

    const sheet = container.querySelector('[data-ui="sheet"]');
    expect(sheet).not.toBeNull();
    // The one FeedControls implementation, inside the sheet: the box, the
    // toggle, the chips.
    expect(sheet?.querySelector('#symbol')).not.toBeNull();
    expect(sheet?.querySelector('#only-insights')).not.toBeNull();

    // No "Done": the control that opened the filters closes them, and
    // the bar under the sheet still names four DESTINATIONS — filters
    // are an action on the feed, not a place (direction 2026-08-19).
    expect(sheet?.querySelector('.sheetclose')).toBeNull();
    expect(container.querySelector('[data-ui="nav-explore"]')).toBeNull();
    expect(
      container.querySelectorAll('[data-ui="bottom-nav"] .navitem').length,
    ).toBe(4);
    fireEvent.click(
      container.querySelector('[data-ui="filter-fab"]') as Element,
    );
    expect(container.querySelector('[data-ui="sheet"]')).toBeNull();
  });

  // The feed the filters drive is BEHIND the sheet: a committed search
  // must close it onto the results, or it reads as no results at all.
  it('closes the sheet onto the results when a search commits', async () => {
    const { container } = await renderApp();
    fireEvent.click(
      container.querySelector('[data-ui="filter-fab"]') as Element,
    );
    await flush();

    const input = container.querySelector('#symbol') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'SWIGGY' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await flush();

    expect(container.querySelector('[data-ui="sheet"]')).toBeNull();
    expect((container.querySelector('#view-feed') as HTMLElement).hidden).toBe(
      false,
    );
  });

  // The filter view is a curtain over the feed, so what narrows the feed
  // must announce itself ON the feed, clearable without reopening the
  // curtain (direction 2026-08-18).
  it('announces an applied search on the feed and clears it from there', async () => {
    const { container } = await renderApp();
    fireEvent.click(
      container.querySelector('[data-ui="filter-fab"]') as Element,
    );
    await flush();
    const input = container.querySelector('#symbol') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'SWIGGY' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await flush();

    const pill = container.querySelector('[data-ui="active-search"]');
    expect(pill?.textContent).toContain('“SWIGGY”');

    fireEvent.click(pill as Element);
    await flush();
    expect(container.querySelector('[data-ui="active-filters"]')).toBeNull();
    // Reopening the filter view finds the box empty, not haunted.
    fireEvent.click(
      container.querySelector('[data-ui="filter-fab"]') as Element,
    );
    expect((container.querySelector('#symbol') as HTMLInputElement).value).toBe(
      '',
    );
  });

  it('gives the account a surface: who, what, and the way out', async () => {
    const { container, apiSend } = await renderApp();
    fireEvent.click(
      container.querySelector('[data-ui="nav-profile"]') as Element,
    );
    await flush();

    expect(
      container.querySelector('[data-ui="profile-email"]')?.textContent,
    ).toBe('r@example.invalid');
    expect(
      container.querySelector('[data-ui="profile-watching"]')?.textContent,
    ).toBe('0 of 50 companies');
    // WHO, WHAT, AND THE WAY OUT. The alert preferences moved to the
    // Watching screen on 2026-08-19: one stored list, one surface.
    // Scoped to the SHEET: every view stays mounted in the shell, so the
    // panel is in the document — on the Watching screen, where it lives.
    expect(
      container.querySelector(
        '[data-ui="sheet"] [data-ui="notification-prefs"]',
      ),
    ).toBeNull();
    // The way out is the LAST thing on the screen.
    const profile = container.querySelector('[data-ui="profile"]') as Element;
    expect(profile.lastElementChild?.getAttribute('data-ui')).toBe(
      'profile-sign-out',
    );

    fireEvent.click(
      container.querySelector('[data-ui="profile-sign-out"]') as Element,
    );
    await flush();
    expect(apiSend.mock.calls.map((c) => c[0])).toContain('/api/auth/logout');
  });

  // The Watching screen is the manager in the shell (direction
  // 2026-08-19): what I am alerted about, then add by search, then the
  // list — and no filings feed, which is what the Feed tab is for.
  it('makes Watching the manager: alerts, add, no feed', async () => {
    const { container } = await renderApp();
    fireEvent.click(
      container.querySelector('[data-ui="nav-watching"]') as Element,
    );
    await flush();
    await flush();

    const prefs = container.querySelector('[data-ui="notification-prefs"]');
    const add = container.querySelector('[data-ui="add-watch"]');
    expect(prefs).not.toBeNull();
    expect(add).not.toBeNull();
    // THE SEARCH BOX IS FIRST — the screen opens on its one action, and
    // the alert choices sit under it as one compact row rather than a
    // panel that spent half the screen ("half the screen space is gone
    // until the search bar", 2026-08-19).
    const order = (add as Element).compareDocumentPosition(prefs as Node);
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(prefs?.className).toContain('compact');
    // Nothing above the box: no heading repeating the lit tab.
    expect(container.querySelector('#view-watching h2')).toBeNull();
    // The promise line and the standalone switch row belong to the full
    // panel; the watched-companies arm rides the pill row here.
    expect(
      container.querySelector('[data-ui="view-watching"]')?.textContent,
    ).not.toContain('Only claims verified');
    expect(
      prefs?.querySelector(
        '[data-ui="prefs-topics"] [data-ui="prefs-watchlist"]',
      ),
    ).not.toBeNull();
    // One home for the topics — the duplicate follow block is deleted.
    expect(container.querySelector('[data-ui="topic-follows"]')).toBeNull();
    expect(container.querySelectorAll('[data-ui="prefs-topics"]').length).toBe(
      1,
    );
    // The standing prose is gone from the phone's manager screen.
    expect(
      container.querySelector('[data-ui="watching-roster-note"]'),
    ).toBeNull();
    expect(container.querySelector('#watch-feed')).toBeNull();
    expect(container.querySelector('#watch-feed-head')).toBeNull();
  });

  it('the web layout is untouched without the boot mark', async () => {
    document.documentElement.classList.remove('native-shell');
    const { container } = await renderApp();
    expect(container.querySelector('[data-ui="bottom-nav"]')).toBeNull();
    expect(container.querySelector('#tab-feed')).not.toBeNull();
    expect(container.querySelector('#symbol')).not.toBeNull();
  });
});
