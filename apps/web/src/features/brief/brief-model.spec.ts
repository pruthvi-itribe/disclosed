import {
  briefCandidates,
  briefLede,
  orderBrief,
  briefSignature,
  BRIEF_MAX_CARDS,
  BRIEF_MIN_CARDS,
  BRIEF_REST_CLAIMS,
  BRIEF_RULE,
} from './brief-model';
import type { FilingView } from '../../shared/types/api';

const filing = (over: Record<string, unknown>): FilingView =>
  ({
    seqId: 1,
    symbol: 'AAA',
    companyName: 'A Ltd',
    disseminatedAt: '2026-08-18T04:00:00.000Z',
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

describe('briefCandidates', () => {
  it('groups filings by symbol, each claim travelling with ITS filing', () => {
    const older = filing({
      seqId: 1,
      disseminatedAt: '2026-08-18T03:00:00.000Z',
      enrichment: { results: null, claims: [claim('first')] },
    });
    const newer = filing({
      seqId: 2,
      disseminatedAt: '2026-08-18T05:00:00.000Z',
      enrichment: { results: null, claims: [claim('second')] },
    });
    const out = briefCandidates([newer, older]);
    expect(out).toHaveLength(1);
    const entry = out[0];
    expect(entry?.claims).toHaveLength(2);
    // The card's Source, tier and category belong to the document the lede
    // was matched against — not to the company's newest filing.
    expect(entry?.claims[0]?.filing.seqId).toBe(2);
    expect(entry?.claims[1]?.filing.seqId).toBe(1);
    expect(entry?.newest).toBe('2026-08-18T05:00:00.000Z');
  });

  it('counts claims with a digit as the figures ordering key', () => {
    const out = briefCandidates([
      filing({
        enrichment: {
          results: null,
          claims: [claim('revenue up 20%'), claim('no digits here')],
        },
      }),
    ]);
    expect(out[0]?.figures).toBe(1);
  });

  // An earlier card in this same response already stated those facts.
  it('drops a company whose every claim is an echo', () => {
    const out = briefCandidates([
      filing({
        enrichment: {
          results: null,
          claims: [claim('repeat', { echo: true })],
        },
      }),
    ]);
    expect(out).toEqual([]);
  });

  it('a company with no claims at all is not a candidate', () => {
    expect(briefCandidates([filing({})])).toEqual([]);
  });
});

describe('briefLede', () => {
  it('is the first claim that is not an echo', () => {
    const out = briefCandidates([
      filing({
        enrichment: {
          results: null,
          claims: [claim('echoed', { echo: true }), claim('fresh')],
        },
      }),
    ]);
    expect(briefLede(out[0]!)?.claim.text).toBe('fresh');
  });
});

describe('orderBrief', () => {
  const candidate = (symbol: string, over: Record<string, unknown>) => ({
    symbol,
    companyName: symbol,
    newest: '2026-08-18T04:00:00.000Z',
    hasResults: false,
    figures: 0,
    claims: [{ claim: claim('x'), filing: filing({}) }],
    ...over,
  });

  it('orders by results, figures, claim count, recency', () => {
    const ordered = orderBrief([
      candidate('D', {}),
      candidate('C', { newest: '2026-08-18T05:00:00.000Z' }),
      candidate('B', { figures: 3 }),
      candidate('A', { hasResults: true }),
    ] as never);
    expect(ordered.map((c) => c.symbol)).toEqual(['A', 'B', 'C', 'D']);
  });

  // THE LAST KEY IS NOT COSMETIC: the page repaints every four seconds, and
  // two candidates equal on every other key must not swap under a thumb.
  it('breaks full ties by symbol', () => {
    const ordered = orderBrief([
      candidate('ZZZ', {}),
      candidate('MMM', {}),
    ] as never);
    expect(ordered.map((c) => c.symbol)).toEqual(['MMM', 'ZZZ']);
  });

  it("sorts a copy, not the caller's array", () => {
    const input = [candidate('B', {}), candidate('A', {})];
    orderBrief(input as never);
    expect(input[0]?.symbol).toBe('B');
  });
});

describe('briefSignature', () => {
  it('is symbol:seqId over the shown cards', () => {
    const out = briefCandidates([
      filing({
        symbol: 'AAA',
        seqId: 7,
        enrichment: { results: null, claims: [claim('x')] },
      }),
      filing({
        symbol: 'BBB',
        seqId: 9,
        enrichment: { results: null, claims: [claim('y')] },
      }),
    ]);
    expect(briefSignature(out)).toBe('AAA:7|BBB:9');
  });
});

describe('the constants', () => {
  // 12 cards ≈ 54 seconds at the measured ~4.5s a card; 15 breaks the
  // rail's promise. Two rest claims for the same reason the card caps at
  // two. A two-segment rail is chrome, not information.
  it('carry their measured values', () => {
    expect(BRIEF_MAX_CARDS).toBe(12);
    expect(BRIEF_MIN_CARDS).toBe(3);
    expect(BRIEF_REST_CLAIMS).toBe(2);
    expect(BRIEF_RULE).toBe(
      'Ordered by how much of what each company said could be checked against its own document — not by how much it matters. That judgement is yours.',
    );
  });
});
