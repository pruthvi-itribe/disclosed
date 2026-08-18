import { act, fireEvent, render } from '@testing-library/react';
import { BriefView } from './BriefView';
import type { FilingView, SummaryView } from '../../shared/types/api';

const filing = (over: Record<string, unknown>): FilingView =>
  ({
    seqId: 1,
    symbol: 'AAA',
    companyName: 'A Ltd',
    category: 'Financial Results',
    confidenceTier: 'verified',
    confidenceTierLabel: 'Verified',
    disseminatedAt: '2026-08-18T04:00:00.000Z',
    disseminatedAtIst: '2026-08-18 09:30:00',
    attachmentUrl: 'https://example.invalid/doc.pdf',
    enrichment: { results: null, claims: [] },
    ...over,
  }) as unknown as FilingView;

const claim = (text: string, over: Record<string, unknown> = {}) => ({
  text,
  echo: false,
  topic: null,
  span: 's',
  ...over,
});

const summary = {
  todayIstDay: '2026-08-18',
  todayCount: 42,
  todayVerified: 7,
  todayByGroup: { narrative: 30, results: 12 },
} as unknown as SummaryView;

const meta = { total: 3, limit: 200, offset: 0, returned: 3, hasMore: false };

const withClaims = (symbol: string, seqId: number, texts: string[]) =>
  filing({
    symbol,
    seqId,
    companyName: `${symbol} Ltd`,
    enrichment: { results: null, claims: texts.map((t) => claim(t)) },
  });

const handlers = () => ({
  onOpenCompany: vi.fn(),
  onPickTopic: vi.fn(),
  onToFeed: vi.fn(),
});

const renderBrief = (items: readonly FilingView[], h = handlers()) => ({
  h,
  ...render(
    <BriefView items={items} meta={meta as never} summary={summary} {...h} />,
  ),
});

describe('the brief card Copy control', () => {
  // The old briefCopy(): every claim of the entry as 'SYMBOL: text' lines,
  // 'Copied' for 1500ms, 'no clipboard' on an insecure origin, 'failed' on
  // refusal — ported verbatim. Plan 3 forgot this control entirely; the
  // browser suite's tap-zone test is what caught the absence.
  it('copies every claim as symbol-prefixed lines and says Copied', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const { container } = renderBrief([
      withClaims('AAA', 1, ['first claim', 'second claim']),
    ]);

    const copy = container.querySelector(
      '[data-ui="brief-card"] .copy',
    ) as HTMLButtonElement;
    expect(copy.textContent).toBe('Copy');
    fireEvent.click(copy);
    await act(async () => {
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledWith(
      'AAA: first claim\nAAA: second claim',
    );
    expect(copy.textContent).toBe('Copied');
  });

  it('says so when there is no clipboard, instead of throwing', () => {
    Object.assign(navigator, { clipboard: undefined });
    const { container } = renderBrief([withClaims('AAA', 1, ['a claim'])]);
    const copy = container.querySelector(
      '[data-ui="brief-card"] .copy',
    ) as HTMLButtonElement;
    fireEvent.click(copy);
    expect(copy.textContent).toBe('no clipboard');
  });
});

describe('BriefView', () => {
  it('draws the cover from the summary, the rule verbatim', () => {
    const { container } = renderBrief([withClaims('AAA', 1, ['claim ₹5 cr'])]);
    expect(container.querySelector('#brief-day')?.textContent).toBe(
      '2026-08-18 IST',
    );
    expect(container.querySelector('#brief-cover-line')?.textContent).toBe(
      '42 filings arrived today; 7 carry something a document verified.',
    );
    const rule = container.querySelector('#brief-cover-rule')?.textContent;
    expect(rule).toContain('Drawn from the 3 most recent verified filings');
    expect(rule).toContain('That judgement is yours.');
    // The mix bar: count desc, zero groups skipped.
    const segs = [...container.querySelectorAll('#brief-mix .mixseg')];
    expect(segs.map((s) => s.getAttribute('title'))).toEqual([
      'narrative: 30',
      'results: 12',
    ]);
  });

  it('one company card with both identities, between cover and end', () => {
    const { container } = renderBrief([
      withClaims('BBB', 9, ['lede ₹5 cr', 'second', 'third', 'fourth']),
    ]);
    const card = container.querySelector('[data-ui="brief-card"]');
    expect(card?.getAttribute('data-symbol')).toBe('BBB');
    expect(card?.getAttribute('data-seq')).toBe('9');
    expect(card?.getAttribute('aria-label')).toBe('Card 1 of 1, BBB');
    expect(card?.querySelector('[data-ui="brief-lede"]')?.textContent).toBe(
      'lede ₹5 cr',
    );
    // Rest capped at two, the remainder through the company page.
    expect(card?.querySelectorAll('[data-ui="brief-rest"] li')).toHaveLength(2);
    expect(card?.querySelector('.bmore')?.textContent).toBe(
      '+ 1 more from BBB',
    );
    // Order in the deck: cover, card, end.
    const deck = container.querySelector('#brief-deck');
    const articles = [...(deck?.querySelectorAll('article') ?? [])].map(
      (a) => a.id || a.getAttribute('data-ui'),
    );
    expect(articles).toEqual(['brief-cover', 'brief-card', 'brief-end']);
  });

  // Absent, not empty: no rest list with one claim, no topic pill on a null
  // topic — "not yet classified" is not "Everything else".
  it('omits the rest list and the topic pill when there is nothing behind them', () => {
    const { container } = renderBrief([withClaims('CCC', 3, ['only claim'])]);
    expect(container.querySelector('[data-ui="brief-rest"]')).toBeNull();
    expect(container.querySelector('[data-ui="brief-topic"]')).toBeNull();
  });

  it('the topic pill sets the topic and only the topic', () => {
    const { container, h } = renderBrief([
      filing({
        symbol: 'DDD',
        enrichment: {
          results: null,
          claims: [claim('x', { topic: 'dividend' })],
        },
      }),
    ]);
    fireEvent.click(
      container.querySelector('[data-ui="brief-topic"]') as Element,
    );
    expect(h.onPickTopic).toHaveBeenCalledWith('dividend');
  });

  it('the end card states the remainder and routes to the feed', () => {
    const { container, h } = renderBrief([withClaims('EEE', 5, ['a claim'])]);
    expect(container.querySelector('#brief-end-line')?.textContent).toBe(
      '1 of the 1 companies in this window filed something a document verified, and every one of them is in this deck.',
    );
    fireEvent.click(container.querySelector('#brief-to-feed') as Element);
    expect(h.onToFeed).toHaveBeenCalledOnce();
  });

  // A two-segment rail is chrome, not information.
  it('hides the rail below three cards and draws one segment per company card', () => {
    const two = renderBrief([
      withClaims('AAA', 1, ['a']),
      withClaims('BBB', 2, ['b']),
    ]);
    expect(
      (two.container.querySelector('#brief-rail') as HTMLElement).hidden,
    ).toBe(true);

    const three = renderBrief([
      withClaims('AAA', 1, ['a']),
      withClaims('BBB', 2, ['b']),
      withClaims('CCC', 3, ['c']),
    ]);
    const rail = three.container.querySelector('#brief-rail') as HTMLElement;
    expect(rail.hidden).toBe(false);
    // One per COMPANY card — a rail lighting for the cover would promise
    // thirteen cards where there are eleven.
    expect(rail.querySelectorAll('[data-ui="brief-rail-seg"]')).toHaveLength(3);
  });

  it('shows the empty sentence with the real window instead of an empty deck', () => {
    const { container } = renderBrief([]);
    const empty = container.querySelector('#brief-empty') as HTMLElement;
    expect(empty.hidden).toBe(false);
    expect(empty.textContent).toBe(
      'Nothing in the last 3 filings carried a claim matched against its source document. Here is the feed.',
    );
    expect((container.querySelector('#brief-deck') as HTMLElement).hidden).toBe(
      true,
    );
  });

  it('a company whose claims are all echoes is not in the deck', () => {
    const { container } = renderBrief([
      filing({
        symbol: 'FFF',
        enrichment: {
          results: null,
          claims: [claim('repeat', { echo: true })],
        },
      }),
      withClaims('GGG', 8, ['fresh']),
    ]);
    const cards = [...container.querySelectorAll('[data-ui="brief-card"]')];
    expect(cards.map((c) => c.getAttribute('data-symbol'))).toEqual(['GGG']);
  });
});
