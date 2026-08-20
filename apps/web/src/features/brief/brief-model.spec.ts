import {
  briefCandidates,
  briefDayLabel,
  briefDeck,
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

describe('briefDeck', () => {
  // MEASURED ON PRODUCTION, 2026-08-20 at 10:46 IST. The window held 200
  // verified filings over 37 hours, and every one of the twelve cards was
  // from the 19th — GULFOILLUB with 21 claims, CEIGALL with 20 — because
  // figures and claim count are really document LENGTH, and a filing
  // published this morning carries three. Today could not win a key.
  it('is one day: the newest that has anything to say', () => {
    const today = filing({
      seqId: 9,
      symbol: 'TODAYCO',
      istDay: '2026-08-20',
      enrichment: { results: null, claims: [claim('Board approved a plan.')] },
    });
    const yesterday = filing({
      seqId: 8,
      symbol: 'LONGDOC',
      istDay: '2026-08-19',
      enrichment: {
        results: null,
        claims: [
          claim('Revenue was 100.'),
          claim('EBITDA was 20.'),
          claim('PAT was 10.'),
        ],
      },
    });

    const deck = briefDeck([yesterday, today]);
    expect(deck.istDay).toBe('2026-08-20');
    expect(deck.cards.map((card) => card.symbol)).toEqual(['TODAYCO']);
    expect(deck.filings).toBe(1);
  });

  // Before the day's first verified filing — 08:36 IST, say — an empty
  // deck would be a lie about a quiet market. It falls back and the cover
  // says which day it is showing.
  it('falls back to the newest day that has one, not to nothing', () => {
    const yesterday = filing({
      seqId: 8,
      symbol: 'LONGDOC',
      istDay: '2026-08-19',
      enrichment: { results: null, claims: [claim('Revenue was 100.')] },
    });
    const todayNoClaims = filing({
      seqId: 9,
      symbol: 'QUIETCO',
      istDay: '2026-08-20',
      enrichment: { results: null, claims: [] },
    });

    const deck = briefDeck([todayNoClaims, yesterday]);
    expect(deck.istDay).toBe('2026-08-19');
    expect(deck.cards.map((card) => card.symbol)).toEqual(['LONGDOC']);
  });

  it('is empty, and names no day, when nothing anywhere qualifies', () => {
    const deck = briefDeck([
      filing({
        istDay: '2026-08-20',
        enrichment: { results: null, claims: [] },
      }),
    ]);
    expect(deck).toEqual({ istDay: null, cards: [], filings: 0 });
  });

  // Ranking is unchanged WITHIN the day: the deck still leads with what
  // says the most, it just cannot reach back a day to find it.
  it('still ranks by substance inside the day', () => {
    const thin = filing({
      seqId: 1,
      symbol: 'THIN',
      istDay: '2026-08-20',
      enrichment: { results: null, claims: [claim('A thing happened.')] },
    });
    const thick = filing({
      seqId: 2,
      symbol: 'THICK',
      istDay: '2026-08-20',
      enrichment: {
        results: null,
        claims: [claim('Revenue was 100.'), claim('PAT was 10.')],
      },
    });
    expect(briefDeck([thin, thick]).cards.map((c) => c.symbol)).toEqual([
      'THICK',
      'THIN',
    ]);
  });
});

describe('briefDayLabel', () => {
  // STRING COMPARISON ONLY, like feed-bucket.ts: IST rolls at 18:30 UTC
  // and the server owns that fact.
  it('names the day against the server-sent anchors', () => {
    expect(briefDayLabel('2026-08-20', '2026-08-20', '2026-08-19')).toBe(
      'Today',
    );
    expect(briefDayLabel('2026-08-19', '2026-08-20', '2026-08-19')).toBe(
      'Yesterday',
    );
    // Older, or before the first summary lands: plainer, never wrong.
    expect(briefDayLabel('2026-08-17', '2026-08-20', '2026-08-19')).toBe(
      '2026-08-17',
    );
    expect(briefDayLabel('2026-08-20', null, null)).toBe('2026-08-20');
  });
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
