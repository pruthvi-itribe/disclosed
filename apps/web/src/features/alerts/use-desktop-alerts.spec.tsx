import { act, renderHook } from '@testing-library/react';
import { fireEvent, render } from '@testing-library/react';
import { AlertsToggle } from './AlertsToggle';
import { ALERT_POLL_MS, useDesktopAlerts } from './use-desktop-alerts';

const raised: Array<{ title: string; body?: string; tag?: string }> = [];

class FakeNotification {
  static permission: NotificationPermission = 'granted';
  static requestPermission = vi.fn(() =>
    Promise.resolve(FakeNotification.permission),
  );
  onclick: (() => void) | null = null;
  constructor(title: string, options?: { body?: string; tag?: string }) {
    raised.push({ title, ...options });
  }
}

const feed = (
  rows: unknown[],
  meta: { watched?: string[]; topics?: string[] } = {
    watched: ['TCS', 'RELIANCE'],
  },
) => ({
  success: true,
  data: rows,
  error: null,
  meta,
});

const row = (
  seqId: number,
  symbol: string,
  tier = 'verified',
  topics: string[] = [],
) => ({
  seqId,
  symbol,
  confidenceTier: tier,
  outcome: `${symbol} said something.`,
  enrichment: { claims: topics.map((topic) => ({ text: 'c', topic })) },
});

const renderAlerts = (apiSend: ReturnType<typeof vi.fn>, enabled = true) =>
  renderHook(() => useDesktopAlerts({ apiSend: apiSend as never, enabled }));

describe('useDesktopAlerts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    raised.length = 0;
    FakeNotification.permission = 'granted';
    vi.stubGlobal('Notification', FakeNotification);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const flush = async () => {
    await act(async () => {
      await Promise.resolve();
    });
  };

  it('seeds from the first read and says nothing', async () => {
    const apiSend = vi.fn().mockResolvedValue(feed([row(9, 'TCS')]));
    renderAlerts(apiSend);
    await flush();

    expect(apiSend).toHaveBeenCalledWith(
      '/api/alerts/feed?limit=25&offset=0',
      'GET',
    );
    expect(raised).toEqual([]);
  });

  it('raises one collapsible banner per NEW verified filing', async () => {
    const apiSend = vi.fn().mockResolvedValue(feed([row(9, 'TCS')]));
    renderAlerts(apiSend);
    await flush();

    apiSend.mockResolvedValue(
      feed([
        row(12, 'RELIANCE'),
        // Stated-tier filings never reach an alert — the tier rule.
        row(11, 'TCS', 'stated'),
        row(9, 'TCS'),
      ]),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ALERT_POLL_MS);
    });

    expect(raised).toEqual([
      {
        title: 'RELIANCE filed',
        body: 'RELIANCE said something.',
        tag: 'RELIANCE',
      },
    ]);

    // The same filing never notifies twice.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ALERT_POLL_MS);
    });
    expect(raised).toHaveLength(1);
  });

  // The topic arm leads with the TOPIC: that is why the reader is told.
  it('titles a topic-only match by its topic', async () => {
    const apiSend = vi
      .fn()
      .mockResolvedValue(
        feed([row(5, 'TCS')], { watched: ['TCS'], topics: ['dividend'] }),
      );
    renderAlerts(apiSend);
    await flush();

    apiSend.mockResolvedValue(
      feed([row(9, 'DIVCO', 'verified', ['dividend']), row(5, 'TCS')], {
        watched: ['TCS'],
        topics: ['dividend'],
      }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ALERT_POLL_MS);
    });

    expect(raised).toEqual([
      {
        title: 'Dividends: DIVCO',
        // The claim's own one-liner, not the card-length outcome.
        body: 'c',
        tag: 'DIVCO',
      },
    ]);
  });

  it('does not ask at all without permission or a session', async () => {
    FakeNotification.permission = 'default';
    const apiSend = vi.fn();
    renderAlerts(apiSend);
    await flush();
    expect(apiSend).not.toHaveBeenCalled();

    FakeNotification.permission = 'granted';
    const signedOut = vi.fn();
    renderAlerts(signedOut, false);
    await flush();
    expect(signedOut).not.toHaveBeenCalled();
  });

  it('stops for the session after a 401 instead of hammering it', async () => {
    const apiSend = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('gone'), { status: 401 }));
    renderAlerts(apiSend);
    await flush();
    const asked = apiSend.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2 * ALERT_POLL_MS);
    });
    expect(apiSend.mock.calls.length).toBe(asked);
  });
});

describe('AlertsToggle', () => {
  it('is the user gesture the permission prompt requires', () => {
    const onRequest = vi.fn();
    const { container } = render(
      <AlertsToggle permission="default" onRequest={onRequest} />,
    );
    fireEvent.click(container.querySelector('#alerts-enable') as Element);
    expect(onRequest).toHaveBeenCalledOnce();
  });

  it('states each terminal state and renders nothing unsupported', () => {
    const granted = render(
      <AlertsToggle permission="granted" onRequest={vi.fn()} />,
    );
    expect(granted.container.textContent).toBe('Desktop alerts on');

    const denied = render(
      <AlertsToggle permission="denied" onRequest={vi.fn()} />,
    );
    expect(denied.container.textContent).toContain('site settings');

    const unsupported = render(
      <AlertsToggle permission="unsupported" onRequest={vi.fn()} />,
    );
    expect(unsupported.container.firstChild).toBeNull();
  });
});
