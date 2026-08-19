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
) => ({
  apiSend,
  ...render(
    <NotificationPrefs
      permission="granted"
      onRequest={vi.fn()}
      apiSend={apiSend as never}
      initialTopics={initialTopics}
      watchedCount={3}
    />,
  ),
});

describe('NotificationPrefs', () => {
  it('states the channels honestly and lists the chip vocabulary', () => {
    const { container } = renderPrefs();
    // Desktop is a real control; mobile push is a stated fact, never a
    // dead toggle.
    expect(container.textContent).toContain('Desktop, this browser');
    expect(container.textContent).toContain('Arrives with the app release');
    // Watched companies are the always-on fact, with their count.
    expect(
      container.querySelector('[data-ui="prefs-watched"]')?.textContent,
    ).toBe('Always on · 3 watched');
    // The chip vocabulary minus its 'Everything' — that is a feed filter,
    // not a subscription.
    const boxes = container.querySelectorAll('.notiftopic input');
    expect(boxes.length).toBe(7);
    expect(container.textContent).toContain(
      'Only claims verified against the source document are ever sent.',
    );
  });

  it('subscribes through the route and takes the server echo', async () => {
    const { container, apiSend } = renderPrefs();
    fireEvent.click(
      container.querySelector('input[data-topic="dividend"]') as Element,
    );
    await flush();

    expect(apiSend).toHaveBeenCalledWith(
      '/api/alerts/topics?topic=dividend',
      'POST',
    );
    expect(
      (
        container.querySelector(
          'input[data-topic="dividend"]',
        ) as HTMLInputElement | null
      )?.checked,
    ).toBe(true);
  });

  it('unsubscribes through the delete route', async () => {
    const apiSend = vi.fn().mockResolvedValue({ data: { topics: [] } });
    const { container } = renderPrefs(apiSend, ['orders']);
    fireEvent.click(
      container.querySelector('input[data-topic="orders"]') as Element,
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
      container.querySelector('input[data-topic="capacity"]') as Element,
    );
    await flush();

    expect(container.textContent).toContain('That change did not save.');
    expect(
      (
        container.querySelector(
          'input[data-topic="capacity"]',
        ) as HTMLInputElement | null
      )?.checked,
    ).toBe(false);
  });
});
