import { act, fireEvent, render } from '@testing-library/react';
import { NotificationPrefs } from './NotificationPrefs';

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

const renderPrefs = (
  apiSend = vi.fn().mockResolvedValue({ data: { topics: ['dividend'] } }),
  initialTopics: string[] = [],
  channel: JSX.Element | null = <span data-ui="alerts">Desktop alerts on</span>,
) => ({
  apiSend,
  ...render(
    <NotificationPrefs
      channel={channel}
      apiSend={apiSend as never}
      initialTopics={initialTopics}
      watchedCount={3}
    />,
  ),
});

describe('NotificationPrefs', () => {
  it('one real channel row, the watchlist switch, and the pill vocabulary', () => {
    const { container } = renderPrefs();
    expect(container.textContent).toContain('Desktop, this browser');
    // An absent feature earns no row: the mobile-push placeholder read as
    // nonsense inside the app (called out 2026-08-19) and is gone.
    expect(container.textContent).not.toContain('Mobile push');
    // The watchlist arm is a real switch, on by default, with its count.
    expect(
      container.querySelector('[data-ui="prefs-watched"]')?.textContent,
    ).toBe(' · 3 watched');
    expect(
      container
        .querySelector('[data-ui="prefs-watchlist"]')
        ?.getAttribute('aria-pressed'),
    ).toBe('true');
    // The chip vocabulary minus its 'Everything', as pills — the same
    // language the Watching screen follows with.
    const pills = container.querySelectorAll(
      '[data-ui="prefs-topics"] .followpill',
    );
    expect(pills.length).toBe(7);
    expect(container.textContent).toContain(
      'Only claims verified against the source document are ever sent.',
    );
  });

  // The app is not a browser tab, so it must not be told about one
  // (called out 2026-08-19): with no channel the whole row is absent,
  // and what remains is only what the reader can actually decide.
  it('drops the channel row entirely where no channel exists', () => {
    const { container } = renderPrefs(undefined, [], null);
    expect(container.textContent).not.toContain('Desktop');
    expect(container.querySelector('[data-ui="prefs-channel"]')).toBeNull();
    expect(container.textContent).toContain('Alert me about');
    expect(
      container.querySelectorAll('[data-ui="prefs-topics"] .followpill').length,
    ).toBe(7);
  });

  // Off silences the ARM at the server's predicate, not at the banner.
  it('the watchlist switch rides its own routes', async () => {
    const apiSend = vi.fn().mockResolvedValue({ data: { watchlist: false } });
    const { container } = renderPrefs(apiSend);
    fireEvent.click(
      container.querySelector('[data-ui="prefs-watchlist"]') as Element,
    );
    await flush();
    expect(apiSend).toHaveBeenCalledWith('/api/alerts/watchlist', 'DELETE');
    expect(
      container
        .querySelector('[data-ui="prefs-watchlist"]')
        ?.getAttribute('aria-pressed'),
    ).toBe('false');
  });

  it('subscribes through the route and takes the server echo', async () => {
    const { container, apiSend } = renderPrefs();
    fireEvent.click(
      container.querySelector('.followpill[data-topic="dividend"]') as Element,
    );
    await flush();

    expect(apiSend).toHaveBeenCalledWith(
      '/api/alerts/topics?topic=dividend',
      'POST',
    );
    expect(
      container
        .querySelector('.followpill[data-topic="dividend"]')
        ?.getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('unsubscribes through the delete route', async () => {
    const apiSend = vi.fn().mockResolvedValue({ data: { topics: [] } });
    const { container } = renderPrefs(apiSend, ['orders']);
    fireEvent.click(
      container.querySelector('.followpill[data-topic="orders"]') as Element,
    );
    await flush();
    expect(apiSend).toHaveBeenCalledWith('/api/alerts/topics/orders', 'DELETE');
  });

  // A refused toggle snaps back with the server's sentence — never a
  // checkbox that lies about what is stored.
  it('shows the server sentence when a toggle is refused', async () => {
    const apiSend = vi
      .fn()
      .mockRejectedValue(new Error('That change did not save.'));
    const { container } = renderPrefs(apiSend);
    fireEvent.click(
      container.querySelector('.followpill[data-topic="capacity"]') as Element,
    );
    await flush();

    expect(container.textContent).toContain('That change did not save.');
    expect(
      container
        .querySelector('.followpill[data-topic="capacity"]')
        ?.getAttribute('aria-pressed'),
    ).toBe('false');
  });
});
