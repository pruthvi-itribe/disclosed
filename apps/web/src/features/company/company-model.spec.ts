import {
  figureBlocks,
  nextItems,
  markDays,
  topicMix,
  planItems,
  coverageLine,
  MIN_TOPIC_CLAIMS,
} from './company-model';
import type { FilingView } from '../../shared/types/api';

const filing = (over: Record<string, unknown>): FilingView =>
  ({
    seqId: 1,
    istDay: '2026-08-18',
    disseminatedAtIst: '2026-08-18 09:30:00',
    enrichment: { results: null, claims: [] },
    ...over,
  }) as unknown as FilingView;

const results = (over: Record<string, unknown> = {}) => ({
  period: 'Q1 FY27',
  priorPeriod: 'Q1 FY26',
  basis: 'Consolidated',
  basisSpan: 'Consolidated Unaudited Results',
  figures: [
    {
      metric: 'revenue',
      current: 100,
      prior: 90,
      unit: 'cr',
      currentDisplay: '₹100 cr',
      priorDisplay: '₹90 cr',
      span: 'Revenue from operations 100',
    },
  ],
  ...over,
});

describe('figureBlocks', () => {
  // The dedupe key is the CONTENT, not the quarter: a press release repeating
  // the same table collapses, a restatement (same quarter, different numbers)
  // keeps both blocks — VIJAYA is the live case.
  it('collapses an identical table filed twice', () => {
    const blocks = figureBlocks([
      filing({ seqId: 2, enrichment: { results: results(), claims: [] } }),
      filing({ seqId: 1, enrichment: { results: results(), claims: [] } }),
    ]);
    expect(blocks).toHaveLength(1);
  });

  it('keeps a restatement as two blocks', () => {
    const restated = results({
      figures: [
        {
          metric: 'revenue',
          current: 101,
          prior: 90,
          unit: 'cr',
          currentDisplay: '₹101 cr',
          priorDisplay: '₹90 cr',
          span: 'Revenue from operations 101',
        },
      ],
    });
    const blocks = figureBlocks([
      filing({ seqId: 2, enrichment: { results: restated, claims: [] } }),
      filing({ seqId: 1, enrichment: { results: results(), claims: [] } }),
    ]);
    expect(blocks).toHaveLength(2);
  });

  it('carries the display strings as sent', () => {
    const blocks = figureBlocks([
      filing({ enrichment: { results: results(), claims: [] } }),
    ]);
    expect(blocks[0]?.figures[0]?.currentDisplay).toBe('₹100 cr');
    expect(blocks[0]?.figures[0]?.priorDisplay).toBe('₹90 cr');
  });
});

describe('nextItems', () => {
  const withCommitment = (
    seqId: number,
    date: string,
    evidence: string,
    span = 'the AGM will be held',
  ) =>
    filing({
      seqId,
      enrichment: {
        results: null,
        claims: [{ text: 'x', span, commitments: [{ date, evidence }] }],
      },
    });

  // HGS filed its 25 September AGM in four documents in a week; one entry
  // per date and word.
  it('collapses the same date under the same word', () => {
    const items = nextItems([
      withCommitment(2, '2026-09-25', 'AGM'),
      withCommitment(1, '2026-09-25', 'agm'),
    ]);
    expect(items).toHaveLength(1);
  });

  it('sorts soonest first with the word as tie-break', () => {
    const items = nextItems([
      withCommitment(3, '2026-09-25', 'record date'),
      withCommitment(2, '2026-09-25', 'AGM'),
      withCommitment(1, '2026-09-01', 'e-voting'),
    ]);
    expect(items.map((i) => `${i.date} ${i.what}`)).toEqual([
      '2026-09-01 e-voting',
      '2026-09-25 AGM',
      '2026-09-25 record date',
    ]);
  });
});

describe('markDays', () => {
  const marked = (seqId: number, istDay: string, direction: string) =>
    filing({
      seqId,
      istDay,
      enrichment: {
        results: null,
        claims: [
          { text: 'x', direction, directionEvidence: 'grew', span: 's' },
        ],
      },
    });

  // One row per IST DAY: SONATSOFTW filed five marked documents in one day
  // and the per-filing version drew five rows that read as five days.
  it('groups marks under one row per day, oldest first', () => {
    const days = markDays([
      marked(3, '2026-08-18', 'expansion'),
      marked(2, '2026-08-18', 'contraction'),
      marked(1, '2026-08-15', 'mixed'),
    ]);
    expect(days.map((d) => d.day)).toEqual(['2026-08-15', '2026-08-18']);
    expect(days[1]?.claims).toHaveLength(2);
  });

  it('draws nothing for unrated or unclassified directions', () => {
    expect(markDays([marked(1, '2026-08-18', 'unrated')])).toEqual([]);
  });
});

describe('topicMix', () => {
  const withTopics = (topics: readonly (string | null)[]) =>
    filing({
      enrichment: {
        results: null,
        claims: topics.map((topic) => ({ text: 'x', topic })),
      },
    });

  // The only floor on the page, on CLAIMS not filings. Measured over 547
  // companies: floor 4 draws 257 of them, 90% showing 2+ topics.
  it(`draws nothing below ${MIN_TOPIC_CLAIMS} claims`, () => {
    expect(topicMix([withTopics(['financial', 'orders', null])])).toBeNull();
  });

  // Null topics count under 'other' so the segments sum to the claim count —
  // deliberately opposite to the Brief's per-card pill.
  it('counts null topics under other and sorts count desc, name asc', () => {
    const mix = topicMix([
      withTopics(['financial', 'financial', 'orders', null, 'dividend']),
    ]);
    expect(mix?.map((s) => `${s.topic}:${s.count}`)).toEqual([
      'financial:2',
      'dividend:1',
      'orders:1',
      'other:1',
    ]);
  });
});

describe('planItems', () => {
  const claim = (over: Record<string, unknown>) => ({
    text: 'compressed',
    span: 'we  expect   growth by FY28',
    planEvidence: 'expect',
    echo: false,
    ...over,
  });

  it('keeps only claims carrying planEvidence, skipping echoes', () => {
    const items = planItems([
      filing({
        enrichment: {
          results: null,
          claims: [
            claim({}),
            claim({ planEvidence: null }),
            claim({ echo: true }),
          ],
        },
      }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]?.evidence).toBe('expect');
  });

  // The span is the document's bytes; the text is the extractor's
  // compression, and a section headed "in their words" only shows the first.
  it('quotes the span, whitespace collapsed, never the text', () => {
    const items = planItems([
      filing({ enrichment: { results: null, claims: [claim({})] } }),
    ]);
    expect(items[0]?.quote).toBe('"we expect growth by FY28"');
  });

  it('says so when no span is stored', () => {
    const items = planItems([
      filing({
        enrichment: { results: null, claims: [claim({ span: '' })] },
      }),
    ]);
    expect(items[0]?.quote).toBe('No source sentence is stored for this line.');
  });
});

describe('coverageLine', () => {
  it('states the window with singular and plural days', () => {
    expect(coverageLine([filing({})], 1)).toBe(
      '1 filings held across 1 IST day · 2026-08-18 to 2026-08-18',
    );
    expect(
      coverageLine(
        [filing({ istDay: '2026-08-18' }), filing({ istDay: '2026-08-15' })],
        12,
      ),
    ).toBe('12 filings held across 2 IST days · 2026-08-15 to 2026-08-18');
  });

  it('is empty with nothing held', () => {
    expect(coverageLine([], 0)).toBe('');
  });
});
