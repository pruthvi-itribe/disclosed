import { render } from '@testing-library/react';
import { FeedGrid } from './FeedGrid';
import { INITIAL_FILTERS } from '../../app/filter-state';
import type { FilingView, PageMeta } from '../types/api';

const filing = (over: Record<string, unknown>): FilingView =>
  ({
    seqId: 1,
    symbol: 'AAA',
    companyName: 'A Ltd',
    category: 'Updates',
    categoryGroup: 'other',
    categoryGroupLabel: 'Other',
    confidenceTier: 'labelled',
    confidenceTierLabel: 'Labelled',
    disseminatedAt: '2026-08-18T04:00:00.000Z',
    disseminatedAtIst: '2026-08-18 09:30:00',
    istDay: '2026-08-18',
    outcome: 'Something was filed.',
    attachmentUrl: null,
    enrichment: { resultsLine: null, claims: [] },
    ...over,
  }) as unknown as FilingView;

const meta = (over: Partial<PageMeta> = {}): PageMeta => ({
  total: 2,
  limit: 25,
  offset: 0,
  returned: 2,
  hasMore: false,
  ...over,
});

const handlers = {
  onOpenCompany: vi.fn(),
  onOpenFocus: vi.fn(),
  onPickGroup: vi.fn(),
  onGrow: vi.fn(),
};

const renderGrid = (
  items: readonly FilingView[],
  m: PageMeta | null,
  extra: Record<string, unknown> = {},
) =>
  render(
    <FeedGrid
      items={items}
      meta={m}
      chrome
      filters={INITIAL_FILTERS}
      todayIstDay="2026-08-18"
      previousIstDay="2026-08-17"
      {...handlers}
      {...(extra as object)}
    />,
  );

describe('FeedGrid', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-08-18T12:00:00.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('inserts a day divider when the bucket changes', () => {
    const items = [
      filing({
        seqId: 3,
        istDay: '2026-08-18',
        disseminatedAt: '2026-08-18T11:45:00.000Z',
      }),
      filing({
        seqId: 2,
        istDay: '2026-08-18',
        disseminatedAt: '2026-08-18T04:00:00.000Z',
      }),
      filing({
        seqId: 1,
        istDay: '2026-08-17',
        disseminatedAt: '2026-08-17T04:00:00.000Z',
      }),
    ];
    const { container } = renderGrid(items, meta({ total: 3, returned: 3 }));
    const headings = [...container.querySelectorAll('h2.bucket')].map(
      (h) => h.textContent,
    );
    expect(headings).toEqual(['Just now', 'Earlier today', 'Yesterday']);
    expect(container.querySelectorAll('[data-ui="card"]')).toHaveLength(3);
  });

  it('shows the count and hides Load more when there is no more', () => {
    const { container } = renderGrid(
      [filing({ seqId: 1 }), filing({ seqId: 2 })],
      meta(),
    );
    expect(container.querySelector('#feed-info')?.textContent).toBe('2 of 2');
    expect((container.querySelector('#feed-more') as HTMLElement).hidden).toBe(
      true,
    );
  });

  it('offers Load more when the server has more', () => {
    const { container } = renderGrid(
      [filing({ seqId: 1 })],
      meta({ total: 90, returned: 25, hasMore: true }),
    );
    expect(container.querySelector('#feed-info')?.textContent).toBe('25 of 90');
    expect((container.querySelector('#feed-more') as HTMLElement).hidden).toBe(
      false,
    );
  });

  // At the 500 cap the button hides even with more, and the count says why.
  it('states the cap instead of offering a sixth step', () => {
    const { container } = render(
      <FeedGrid
        items={[filing({ seqId: 1 })]}
        meta={meta({ total: 900, returned: 500, hasMore: true })}
        chrome
        filters={{ ...INITIAL_FILTERS, limit: 500 }}
        todayIstDay="2026-08-18"
        previousIstDay="2026-08-17"
        {...handlers}
      />,
    );
    expect((container.querySelector('#feed-more') as HTMLElement).hidden).toBe(
      true,
    );
    expect(container.querySelector('#feed-info')?.textContent).toBe(
      '500 of 900 - showing the 500 most recent. Narrow with search or a topic to reach the rest.',
    );
  });

  it('the two empty states are two different sentences', () => {
    const { container } = renderGrid([], meta({ total: 0, returned: 0 }));
    expect(container.querySelector('.emptytitle')?.textContent).toBe(
      'Nothing verifiable yet',
    );
    expect(container.querySelector('.emptyhint')?.textContent).toContain(
      'Untick the filter above',
    );

    const { container: all } = render(
      <FeedGrid
        items={[]}
        meta={meta({ total: 0, returned: 0 })}
        chrome
        filters={{ ...INITIAL_FILTERS, onlyInsights: false }}
        todayIstDay="2026-08-18"
        previousIstDay="2026-08-17"
        {...handlers}
      />,
    );
    expect(all.querySelector('.emptytitle')?.textContent).toBe(
      'No filings match',
    );
  });

  // The company-specific sentence states as FACT that none of the picked
  // company's filings carries a matched claim — which the page can only
  // honestly say when the insight toggle is the sole other narrowing. With
  // a group or topic ANDed in, that filter may be what emptied the feed,
  // and in a product whose first invariant is that no unverified claim
  // reaches a reader, the client must not print a false one. (The old
  // client's emptyHint has the same defect; deliberately not ported.)
  it('does not blame the company when a group or topic also narrows', () => {
    const picked = {
      kind: 'company' as const,
      value: 'TCS',
      head: 'TCS',
      name: 'Tata Consultancy',
      filings: 42,
    };
    const { container } = render(
      <FeedGrid
        items={[]}
        meta={meta({ total: 0, returned: 0 })}
        chrome
        filters={{ ...INITIAL_FILTERS, picked, group: 'capital' }}
        todayIstDay="2026-08-18"
        previousIstDay="2026-08-17"
        {...handlers}
      />,
    );
    const hint = container.querySelector('.emptyhint')?.textContent ?? '';
    expect(hint).not.toContain('none of them carries');
    expect(hint).toContain('Only filings with a claim matched');

    const { container: alone } = render(
      <FeedGrid
        items={[]}
        meta={meta({ total: 0, returned: 0 })}
        chrome
        filters={{ ...INITIAL_FILTERS, picked }}
        todayIstDay="2026-08-18"
        previousIstDay="2026-08-17"
        {...handlers}
      />,
    );
    expect(alone.querySelector('.emptyhint')?.textContent).toContain(
      'TCS has 42 filing(s), and none of them carries a claim',
    );
  });

  // The Plans chip is blamed first: it is the narrowest filter (128 of 3,466
  // filings), and letting the insight toggle take the blame would send the
  // reader to the wrong control.
  it('an empty feed under the Plans chip blames the Plans chip', () => {
    const { container } = render(
      <FeedGrid
        items={[]}
        meta={meta({ total: 0, returned: 0 })}
        chrome
        filters={{ ...INITIAL_FILTERS, plans: true }}
        todayIstDay="2026-08-18"
        previousIstDay="2026-08-17"
        {...handlers}
      />,
    );
    expect(container.querySelector('.emptyhint')?.textContent).toContain(
      'Clear the Plans chip',
    );
  });

  // Only 23.2% of claims carry a mark; a permanent legend is furniture.
  it('shows the direction legend only when a rendered claim carries a mark', () => {
    const unmarked = renderGrid([filing({ seqId: 1 })], meta());
    expect(
      (unmarked.container.querySelector('#dir-legend') as HTMLElement).hidden,
    ).toBe(true);

    const marked = renderGrid(
      [
        filing({
          seqId: 2,
          enrichment: {
            resultsLine: null,
            claims: [
              {
                text: 'up 20%',
                echo: false,
                direction: 'expansion',
                directionEvidence: 'up',
              },
            ],
          },
        }),
      ],
      meta(),
    );
    expect(
      (marked.container.querySelector('#dir-legend') as HTMLElement).hidden,
    ).toBe(false);
  });

  it('without chrome there is no info line, no button and no legend', () => {
    const { container } = render(
      <FeedGrid
        items={[filing({ seqId: 1 })]}
        meta={meta()}
        chrome={false}
        filters={INITIAL_FILTERS}
        todayIstDay="2026-08-18"
        previousIstDay="2026-08-17"
        {...handlers}
      />,
    );
    expect(container.querySelector('#feed-info')).toBeNull();
    expect(container.querySelector('#feed-more')).toBeNull();
    expect(container.querySelector('#dir-legend')).toBeNull();
    expect(container.querySelectorAll('[data-ui="card"]')).toHaveLength(1);
  });
});
