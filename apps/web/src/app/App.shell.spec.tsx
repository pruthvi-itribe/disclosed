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
      container.querySelector('[data-ui="nav-explore"]') as Element,
    );
    await flush();

    const sheet = container.querySelector('[data-ui="sheet"]');
    expect(sheet).not.toBeNull();
    // The one FeedControls implementation, inside the sheet: the box, the
    // toggle, the chips.
    expect(sheet?.querySelector('#symbol')).not.toBeNull();
    expect(sheet?.querySelector('#only-insights')).not.toBeNull();

    fireEvent.click(sheet?.querySelector('.sheetclose') as Element);
    expect(container.querySelector('[data-ui="sheet"]')).toBeNull();
  });

  // The feed the filters drive is BEHIND the sheet: a committed search
  // must close it onto the results, or it reads as no results at all.
  it('closes the sheet onto the results when a search commits', async () => {
    const { container } = await renderApp();
    fireEvent.click(
      container.querySelector('[data-ui="nav-explore"]') as Element,
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
      container.querySelector('[data-ui="nav-explore"]') as Element,
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
      container.querySelector('[data-ui="nav-explore"]') as Element,
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

    fireEvent.click(
      container.querySelector('[data-ui="profile-sign-out"]') as Element,
    );
    await flush();
    expect(apiSend.mock.calls.map((c) => c[0])).toContain('/api/auth/logout');
  });

  it('the web layout is untouched without the boot mark', async () => {
    document.documentElement.classList.remove('native-shell');
    const { container } = await renderApp();
    expect(container.querySelector('[data-ui="bottom-nav"]')).toBeNull();
    expect(container.querySelector('#tab-feed')).not.toBeNull();
    expect(container.querySelector('#symbol')).not.toBeNull();
  });
});
