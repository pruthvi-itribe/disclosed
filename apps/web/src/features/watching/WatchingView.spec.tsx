import { fireEvent, render } from '@testing-library/react';
import { WatchingView } from './WatchingView';
import { INITIAL_FILTERS } from '../../app/filter-state';
import type { FilingView } from '../../shared/types/api';
import type {
  WatchedCompany,
  WatchlistFeedMeta,
} from '../../shared/types/account';

const row = (over: Partial<WatchedCompany> = {}): WatchedCompany => ({
  symbol: 'TCS',
  companyName: 'Tata Consultancy Services',
  addedAt: '2026-08-10T04:00:00.000Z',
  addedAtIst: '2026-08-10 09:30:00',
  filingsHeld: 4,
  lastFiledAt: '2026-08-18T04:00:00.000Z',
  lastFiledAtIst: '2026-08-18 09:30:00',
  ...over,
});

const filing = (): FilingView =>
  ({
    seqId: 1,
    symbol: 'TCS',
    companyName: 'Tata Consultancy Services',
    category: 'Updates',
    categoryGroup: 'other',
    categoryGroupLabel: 'Other',
    confidenceTier: 'verified',
    confidenceTierLabel: 'Verified',
    disseminatedAt: '2026-08-18T04:00:00.000Z',
    disseminatedAtIst: '2026-08-18 09:30:00',
    istDay: '2026-08-18',
    outcome: 'Filed.',
    attachmentUrl: null,
    enrichment: { resultsLine: null, claims: [] },
  }) as unknown as FilingView;

const meta = (
  watching: readonly WatchedCompany[],
  over: Partial<WatchlistFeedMeta> = {},
): WatchlistFeedMeta => ({
  total: 1,
  limit: 25,
  offset: 0,
  returned: 1,
  hasMore: false,
  unread: 0,
  watching,
  ...over,
});

const renderView = (
  items: readonly FilingView[],
  m: WatchlistFeedMeta | null,
  over: Record<string, unknown> = {},
) => {
  const handlers = {
    onOpenCompany: vi.fn(),
    onOpenFocus: vi.fn(),
    onPickGroup: vi.fn(),
    onRoster: vi.fn(),
    onSeen: vi.fn(),
  };
  return {
    handlers,
    ...render(
      <WatchingView
        items={items}
        meta={m}
        filters={INITIAL_FILTERS}
        todayIstDay="2026-08-18"
        previousIstDay="2026-08-17"
        watch={{
          watched: new Set(['TCS']),
          pending: new Set(),
          onToggle: vi.fn(),
        }}
        watchCap={50}
        counts={{ used: 1, cap: 50 }}
        {...handlers}
        {...over}
      />,
    ),
  };
};

describe('WatchingView', () => {
  // The cap is server-owned (MAX_WATCHED_SYMBOLS, delivered on api/me and
  // as meta on every watchlist response). Until one of those channels has
  // answered, the count stays blank the way the old page's element did —
  // never a number no server sent.
  it('renders no cap it has not been told', () => {
    const { container } = renderView([filing()], meta([row()]), {
      counts: null,
    });
    expect(container.querySelector('#watch-count')?.textContent).toBe('');
  });

  // The count follows what the server LAST SAID — the old applyWatchCounts,
  // written by the sign-in read and every toggle — so it is right even
  // before this view has ever polled (the section sits in the document from
  // sign-in, the way the old page kept it).
  it('counts from the server-said counts, not the roster', () => {
    const { container } = renderView([], null, {
      counts: { used: 2, cap: 50 },
    });
    expect(container.querySelector('#watch-count')?.textContent).toBe(
      '2 of 50 companies watched',
    );
  });

  it('names the feed half with the old page id the browser suite pins', () => {
    const { container } = renderView([filing()], meta([row()]));
    expect(
      container.querySelectorAll('#watch-feed [data-ui="card"]').length,
    ).toBeGreaterThan(0);
  });

  it('draws the roster first, with the count and the fixed note', () => {
    const { container } = renderView([filing()], meta([row()]));
    expect(container.querySelector('#watch-count')?.textContent).toBe(
      '1 of 50 companies watched',
    );
    const rosterRow = container.querySelector('[data-ui="watching-row"]');
    expect(rosterRow?.getAttribute('data-symbol')).toBe('TCS');
    expect(rosterRow?.querySelector('.sym')?.textContent).toBe('TCS');
    expect(rosterRow?.querySelector('.rosterwhen')?.getAttribute('title')).toBe(
      '2026-08-18 09:30:00 IST',
    );
    expect(
      container.querySelector('[data-ui="watching-roster-note"]')?.textContent,
    ).toContain('the quiet ones included');
  });

  // Never a date: the directory can be ahead of the filings window, and
  // this is a window on the exchange's output, not the whole of it.
  it('a row with nothing held says so, without a title', () => {
    const quiet = row({
      symbol: 'NEWCO',
      lastFiledAt: null,
      lastFiledAtIst: null,
    });
    const { container } = renderView([filing()], meta([row(), quiet]));
    const when = container.querySelector('[data-symbol="NEWCO"] .rosterwhen');
    expect(when?.textContent).toBe('nothing yet in our window');
    expect(when?.getAttribute('title')).toBeNull();
  });

  it('states what the feed leaves out, in numbers', () => {
    const more = renderView(
      [filing()],
      meta([row()], { returned: 25, total: 138, hasMore: true }),
    );
    expect(
      more.container.querySelector('[data-ui="watching-feed-note"]')
        ?.textContent,
    ).toBe(
      'The newest 25 of 138 filings from these companies. The list above is complete; this one is not.',
    );

    const all = renderView([filing()], meta([row()], { total: 12 }));
    expect(
      all.container.querySelector('[data-ui="watching-feed-note"]')
        ?.textContent,
    ).toBe('All 12 filings from these companies.');
  });

  it('the two empties are two different sentences', () => {
    const none = renderView([], meta([]));
    expect(none.container.querySelector('#watch-empty')?.textContent).toContain(
      'You are not watching anything yet',
    );
    // The roster chrome hides with it.
    expect(
      (
        none.container.querySelector(
          '[data-ui="watching-roster-note"]',
        ) as HTMLElement
      ).hidden,
    ).toBe(true);
    expect(
      (
        none.container.querySelector(
          '[data-ui="watching-feed-head"]',
        ) as HTMLElement
      ).hidden,
    ).toBe(true);

    const quiet = renderView(
      [],
      meta([row(), row({ symbol: 'B' }), row({ symbol: 'C' })]),
    );
    expect(
      quiet.container.querySelector('#watch-empty')?.textContent,
    ).toContain('None of the 3 companies above has filed anything we hold');
    expect(
      quiet.container.querySelector('#watch-empty')?.textContent,
    ).toContain('The watches are working - they are listed above.');
  });

  it('hands every roster up wholesale and clears unread only when populated', () => {
    const populated = renderView([filing()], meta([row()]));
    expect(populated.handlers.onRoster).toHaveBeenCalledWith([row()], 50);
    expect(populated.handlers.onSeen).toHaveBeenCalled();

    // The empties deliberately keep the badge — a reader with zero filings
    // has read nothing.
    const empty = renderView([], meta([row()]));
    expect(empty.handlers.onRoster).toHaveBeenCalled();
    expect(empty.handlers.onSeen).not.toHaveBeenCalled();
  });

  it('the feed half is the shared grid without chrome', () => {
    const { container } = renderView([filing()], meta([row()]));
    expect(container.querySelectorAll('[data-ui="card"]')).toHaveLength(1);
    expect(container.querySelector('#feed-info')).toBeNull();
    expect(container.querySelector('#feed-more')).toBeNull();
  });

  it('a roster ticker opens the company page', () => {
    const { container, handlers } = renderView([filing()], meta([row()]));
    fireEvent.click(
      container.querySelector('[data-ui="watching-row"] .sym') as Element,
    );
    expect(handlers.onOpenCompany).toHaveBeenCalledWith('TCS');
  });
});
