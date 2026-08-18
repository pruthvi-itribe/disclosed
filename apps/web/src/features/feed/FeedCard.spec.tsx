import { fireEvent, render } from '@testing-library/react';
import { FeedCard } from './FeedCard';
import type { FilingView } from '../../shared/types/api';

const filing = (over: Record<string, unknown> = {}): FilingView =>
  ({
    seqId: 9001,
    symbol: 'ESAF',
    companyName: 'ESAF Small Finance Bank',
    category: 'Financial Results',
    categoryGroup: 'results',
    categoryGroupLabel: 'Results',
    confidenceTier: 'verified',
    confidenceTierLabel: 'Verified',
    disseminatedAt: '2026-08-18T04:00:00.000Z',
    disseminatedAtIst: '2026-08-18 09:30:00',
    istDay: '2026-08-18',
    outcome: 'Financial results were filed.',
    attachmentUrl: 'https://example.invalid/doc.pdf',
    enrichment: {
      resultsLine: null,
      claims: [
        {
          text: 'Gross NPA declined to 5.4%',
          echo: false,
          direction: 'contraction',
          directionEvidence: 'declined to 5.4%',
        },
      ],
    },
    ...over,
  }) as unknown as FilingView;

const handlers = () => ({
  onOpenCompany: vi.fn(),
  onOpenFocus: vi.fn(),
  onPickGroup: vi.fn(),
});

const renderCard = (f: FilingView, h = handlers()) => ({
  h,
  ...render(<FeedCard filing={f} {...h} />),
});

const card = (container: HTMLElement): HTMLElement =>
  container.querySelector('[data-ui="card"]') as HTMLElement;

describe('FeedCard', () => {
  it('is an article with both stable identities and the open affordance', () => {
    const { container } = renderCard(filing());
    const node = card(container);
    expect(node.tagName).toBe('ARTICLE');
    expect(node.className).toBe('card openable');
    expect(node.getAttribute('data-seq')).toBe('9001');
    expect(node.getAttribute('data-at')).toBe('2026-08-18T04:00:00.000Z');
    expect(node.tabIndex).toBe(0);
    expect(node.getAttribute('aria-haspopup')).toBe('dialog');
    expect(node.getAttribute('aria-label')).toBe('Open everything ESAF filed');
  });

  it('heads with the symbol, name, server-formatted time and group tag', () => {
    const { container } = renderCard(filing());
    const head = container.querySelector('[data-ui="card-head"]');
    const sym = head?.querySelector('button.sym');
    expect(sym?.textContent).toBe('ESAF');
    expect(sym?.getAttribute('title')).toBe('All filings from ESAF');
    expect(head?.querySelector('.coname')?.textContent).toBe(
      'ESAF Small Finance Bank',
    );
    const when = head?.querySelector('.when');
    // The IST string is printed as sent, in the title; the visible text is
    // the browser-computed relative age.
    expect(when?.getAttribute('title')).toBe('2026-08-18 09:30:00 IST');
    const group = head?.querySelector('.tag');
    expect(group?.className).toBe('tag group results clickable');
    expect(group?.textContent).toBe('Results');
  });

  it('lists claims with the movement mark and its evidence', () => {
    const { container } = renderCard(filing());
    const claims = container.querySelector('[data-ui="card-claims"]');
    const mark = claims?.querySelector('[data-ui="claim-direction"]');
    expect(mark?.getAttribute('data-direction')).toBe('contraction');
    expect(mark?.textContent).toBe('▼');
    expect(mark?.getAttribute('aria-label')).toBe('decrease printed');
    expect(mark?.getAttribute('title')).toBe(
      'Printed in the document: "declined to 5.4%"',
    );
    expect(claims?.textContent).toContain('Gross NPA declined to 5.4%');
  });

  // CARD_CLAIMS = 2, measured at 1440px: two claims cap the tile heights at
  // 211-279px against 234-330px for three; "+N more" opens the focus dialog
  // rather than growing the card — in-card expansion was removed with
  // state.expanded and must not return.
  it('caps at two claims and offers the rest through the focus dialog', () => {
    const claims = [1, 2, 3, 4].map((n) => ({
      text: `claim ${n}`,
      echo: false,
      direction: null,
      directionEvidence: null,
    }));
    const f = filing({ enrichment: { resultsLine: null, claims } });
    const { container, h } = renderCard(f);
    expect(
      container.querySelectorAll('[data-ui="card-claims"] li'),
    ).toHaveLength(2);
    const more = container.querySelector('[data-ui="card-more"]');
    expect(more?.textContent).toBe('+ 2 more');
    fireEvent.click(more as Element);
    expect(h.onOpenFocus).toHaveBeenCalledWith(f);
  });

  it('a card with nothing verifiable is quiet and states the outcome', () => {
    const f = filing({ enrichment: { resultsLine: null, claims: [] } });
    const { container } = renderCard(f);
    expect(card(container).className).toBe('card quiet openable');
    expect(container.querySelector('[data-ui="card-claims"]')).toBeNull();
    expect(
      container.querySelector('[data-ui="card-outcome"]')?.textContent,
    ).toBe('Financial results were filed.');
  });

  it('foots with the tier, the category and the source link', () => {
    const { container } = renderCard(filing());
    const foot = container.querySelector('[data-ui="card-foot"]');
    const tier = foot?.querySelector('[data-ui="card-tier"]');
    expect(tier?.className).toBe('tier tier-verified');
    expect(tier?.textContent).toBe('Verified');
    expect(tier?.getAttribute('title')).toContain('character for character');
    expect(foot?.querySelector('[data-ui="card-category"]')?.textContent).toBe(
      'Financial Results',
    );
    const source = foot?.querySelector('[data-ui="card-source"]');
    expect(source?.getAttribute('href')).toBe(
      'https://example.invalid/doc.pdf',
    );
  });

  // Absent, not disabled: a URL that fails the scheme check draws nothing.
  it('draws no source link when the URL fails the scheme check', () => {
    const { container } = renderCard(filing({ attachmentUrl: 'javascript:x' }));
    expect(container.querySelector('[data-ui="card-source"]')).toBeNull();
  });

  it('opens the focus dialog on a card click, but not on a control', () => {
    const f = filing();
    const { container, h } = renderCard(f);
    fireEvent.click(card(container));
    expect(h.onOpenFocus).toHaveBeenCalledWith(f);

    h.onOpenFocus.mockClear();
    fireEvent.click(container.querySelector('button.sym') as Element);
    expect(h.onOpenFocus).not.toHaveBeenCalled();
    expect(h.onOpenCompany).toHaveBeenCalledWith('ESAF');
  });

  // Enter only, and only when the card itself has focus — Space scrolls a
  // page and a child control's Enter is its own.
  it('opens on Enter on the card itself and not from a child', () => {
    const f = filing();
    const { container, h } = renderCard(f);
    fireEvent.keyDown(card(container), { key: 'Enter' });
    expect(h.onOpenFocus).toHaveBeenCalledWith(f);

    h.onOpenFocus.mockClear();
    fireEvent.keyDown(container.querySelector('button.sym') as Element, {
      key: 'Enter',
    });
    expect(h.onOpenFocus).not.toHaveBeenCalled();
  });

  // The card's whole-click guard exempts `a, button` and nothing else; the
  // group tag is a SPAN, so on the served page a tag click applies the group
  // filter AND opens the focus dialog. A quirk, but it is the shipped
  // behaviour and parity keeps it — changing it is a feature change.
  it('the group tag picks the group and, as shipped, also opens the card', () => {
    const f = filing();
    const { container, h } = renderCard(f);
    fireEvent.click(container.querySelector('.tag.group') as Element);
    expect(h.onPickGroup).toHaveBeenCalledWith('results');
    expect(h.onOpenFocus).toHaveBeenCalledWith(f);
  });
});
