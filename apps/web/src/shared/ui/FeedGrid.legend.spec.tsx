import { fireEvent, render } from '@testing-library/react';
import { FeedGrid } from './FeedGrid';
import { INITIAL_FILTERS } from '../../app/filter-state';
import type { FilingView, PageMeta } from '../types/api';

/**
 * The direction key and the standing statement — the feed's two sentences
 * about the movement mark, split from FeedGrid.spec.tsx at the line cap.
 * They answer one question asked on 2026-08-19 ("is it needed always? how
 * long should it be there?"): the KEY goes when the reader says it has
 * taught them, the STANCE does not go at all.
 */

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

/** A filing whose claim carries a movement mark, so the key is drawn. */
const markedFiling = (): FilingView =>
  filing({
    seqId: 7,
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
  });

const meta = (): PageMeta => ({
  total: 2,
  limit: 25,
  offset: 0,
  returned: 2,
  hasMore: false,
});

const handlers = {
  onOpenCompany: vi.fn(),
  onOpenFocus: vi.fn(),
  onPickGroup: vi.fn(),
  onGrow: vi.fn(),
};

const renderGrid = (items: readonly FilingView[], m: PageMeta | null) =>
  render(
    <FeedGrid
      items={items}
      meta={m}
      chrome
      filters={INITIAL_FILTERS}
      todayIstDay="2026-08-18"
      previousIstDay="2026-08-17"
      {...handlers}
    />,
  );

describe('the direction key and the standing statement', () => {
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

  // "Is it needed always?" — no: a key teaches, and a taught reader keeps
  // the space. The dismissal is theirs and the browser remembers it.
  it('drops the key once the reader says they have it, and remembers', () => {
    localStorage.clear();
    const first = renderGrid([markedFiling()], meta());
    fireEvent.click(
      first.container.querySelector(
        '[data-ui="direction-legend-learned"]',
      ) as Element,
    );
    expect(
      (first.container.querySelector('#dir-legend') as HTMLElement).hidden,
    ).toBe(true);

    const later = renderGrid([markedFiling()], meta());
    expect(
      (later.container.querySelector('#dir-legend') as HTMLElement).hidden,
    ).toBe(true);
    localStorage.clear();
  });

  // The STANCE is not a teaching aid and is not dismissible: it stays under
  // the feed whether or not the key is showing.
  it('keeps the standing statement under the feed', () => {
    localStorage.setItem('learned-direction-marks', 'yes');
    const { container } = renderGrid([markedFiling()], meta());
    const stance = container.querySelector('[data-ui="direction-stance"]');
    expect(stance?.textContent).toContain('not our view');
    expect(stance?.getAttribute('title')).toContain(
      'Disclosed does not rate companies or securities',
    );
    localStorage.clear();
  });
});
