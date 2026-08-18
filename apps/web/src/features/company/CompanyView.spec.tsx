import { fireEvent, render } from '@testing-library/react';
import { CompanyView } from './CompanyView';
import { INITIAL_FILTERS } from '../../app/filter-state';
import type { FilingView, PageMeta } from '../../shared/types/api';

const filing = (over: Record<string, unknown> = {}): FilingView =>
  ({
    seqId: 1,
    symbol: 'VIJAYA',
    companyName: 'Vijaya Diagnostic',
    industry: 'Healthcare',
    industrySource: 'bse',
    category: 'Financial Results',
    categoryGroup: 'results',
    categoryGroupLabel: 'Results',
    confidenceTier: 'verified',
    confidenceTierLabel: 'Verified',
    disseminatedAt: '2026-08-18T04:00:00.000Z',
    disseminatedAtIst: '2026-08-18 09:30:00',
    istDay: '2026-08-18',
    outcome: 'Results were filed.',
    attachmentUrl: null,
    enrichment: {
      resultsLine: null,
      results: {
        period: 'Q1 FY27',
        priorPeriod: 'Q1 FY26',
        basis: 'Consolidated',
        basisSpan: 'Consolidated Unaudited',
        figures: [
          {
            metric: 'revenue',
            current: 100,
            prior: 90,
            unit: 'cr',
            currentDisplay: '₹100 cr',
            priorDisplay: '₹90 cr',
            span: 'Revenue 100',
          },
        ],
      },
      claims: [
        {
          text: 'a claim',
          span: 'span text',
          topic: 'financial',
          direction: 'expansion',
          directionEvidence: 'grew',
          echo: false,
          commitments: [{ date: '2026-09-25', evidence: 'AGM' }],
          planEvidence: null,
        },
      ],
    },
    ...over,
  }) as unknown as FilingView;

const meta: PageMeta = {
  total: 1,
  limit: 200,
  offset: 0,
  returned: 1,
  hasMore: false,
};

const renderView = (items: readonly FilingView[], onBack = vi.fn()) => ({
  onBack,
  ...render(
    <CompanyView
      symbol="VIJAYA"
      items={items}
      meta={meta}
      filters={INITIAL_FILTERS}
      todayIstDay="2026-08-18"
      previousIstDay="2026-08-17"
      onBack={onBack}
      onOpenCompany={vi.fn()}
      onOpenFocus={vi.fn()}
      onPickGroup={vi.fn()}
    />,
  ),
});

describe('CompanyView', () => {
  it('heads with the identity and marks a BSE-classified industry', () => {
    const { container } = renderView([filing()]);
    expect(container.querySelector('#co-symbol')?.textContent).toBe('VIJAYA');
    expect(container.querySelector('#co-name')?.textContent).toBe(
      'Vijaya Diagnostic',
    );
    const tag = container.querySelector('#co-industry');
    expect(tag?.getAttribute('title')).toBe('Industry as classified by BSE');
    expect(
      tag?.querySelector('[data-ui="co-industry-source"]')?.textContent,
    ).toBe('BSE');
  });

  // An unmarked chip is NSE's own string; no industry means no chip at all —
  // a page whose third line reads "Industry: —" looks broken, not honest.
  it('draws no industry chip when none is known', () => {
    const { container } = renderView([
      filing({ industry: null, industrySource: null }),
    ]);
    expect(container.querySelector('#co-industry')).toBeNull();
  });

  it('states the coverage window and the hero numbers', () => {
    const { container } = renderView([filing()]);
    expect(container.querySelector('#co-coverage')?.textContent).toBe(
      '1 filings held across 1 IST day · 2026-08-18 to 2026-08-18',
    );
    expect(container.querySelector('#co-filings')?.textContent).toBe('1');
    expect(container.querySelector('#co-verified')?.textContent).toBe('1');
  });

  it('shows each section exactly when it has something to show', () => {
    const { container } = renderView([filing()]);
    expect(
      (container.querySelector('[data-ui="company-figures"]') as HTMLElement)
        .hidden,
    ).toBe(false);
    expect(
      (container.querySelector('[data-ui="company-next"]') as HTMLElement)
        .hidden,
    ).toBe(false);
    expect(
      (container.querySelector('[data-ui="company-marks"]') as HTMLElement)
        .hidden,
    ).toBe(false);
    // One claim is below the four-claim floor — the only floor on the page.
    expect(
      (container.querySelector('[data-ui="company-topic-mix"]') as HTMLElement)
        .hidden,
    ).toBe(true);
    // No planEvidence anywhere.
    expect(
      (container.querySelector('[data-ui="company-plans"]') as HTMLElement)
        .hidden,
    ).toBe(true);
  });

  it('renders the figures as printed, with vs and never an arrow', () => {
    const { container } = renderView([filing()]);
    const row = container.querySelector('[data-ui="company-figure"]');
    expect(row?.querySelector('.figvalue')?.textContent).toBe('₹100 cr');
    expect(row?.querySelector('.figprior')?.textContent).toBe(
      'vs ₹90 cr · Q1 FY26',
    );
    expect(row?.getAttribute('title')).toBe(
      'The document printed: "Revenue 100"',
    );
  });

  it('lists the filings through the shared grid, without chrome', () => {
    const { container } = renderView([filing()]);
    expect(
      container.querySelectorAll(
        '[data-ui="company-feed"], .feed [data-ui="card"]',
      ).length,
    ).toBeGreaterThan(0);
    expect(container.querySelector('#feed-info')).toBeNull();
    expect(container.querySelector('#feed-more')).toBeNull();
  });

  it('goes back to the feed', () => {
    const { container, onBack } = renderView([filing()]);
    fireEvent.click(container.querySelector('#company-back') as Element);
    expect(onBack).toHaveBeenCalledOnce();
  });
});
