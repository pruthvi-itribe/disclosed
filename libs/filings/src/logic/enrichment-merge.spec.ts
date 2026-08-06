import { PENDING_ENRICHMENT, type FilingEnrichment } from './enrichment.types';
import { laneScore, mergeEnrichment } from './enrichment-merge';

/**
 * The rule that lets a backfill re-read two thousand documents without being
 * able to make the collection worse.
 *
 * Every case here is one a live sweep will actually hit: a sampled model
 * returning one fewer claim than it did yesterday, a results table appearing for
 * the first time, and NSE serving a 404 for a PDF it served last week.
 */

const enriched = (over: Partial<FilingEnrichment> = {}): FilingEnrichment => ({
  ...PENDING_ENRICHMENT,
  state: 'enriched',
  attempts: 1,
  outcome: 'ACME: bags an order',
  outcomeSource: 'exchange-summary',
  categoryGroup: 'orders',
  ...over,
});

const claim = (text: string) => ({
  text,
  span: `the document says ${text}`,
  kind: 'operational' as const,
  periodSpan: null,
});

const results = (figures: number) => ({
  basis: 'consolidated' as const,
  basisSpan: 'Consolidated Financial Results',
  columnsSpan: '30.06.2026 30.06.2025',
  period: 'Q1 FY27',
  priorPeriod: 'Q1 FY26',
  figures: Array.from({ length: figures }, (_, index) => ({
    metric: 'revenue' as const,
    current: '100',
    prior: '90',
    unit: 'CR' as const,
    span: `row ${index}`,
  })),
});

describe('mergeEnrichment', () => {
  it('takes the new record whole when there is nothing stored', () => {
    const next = enriched({ claims: [claim('a')] });
    const merged = mergeEnrichment(null, next);
    expect(merged.enrichment).toBe(next);
    expect(merged.regressions).toEqual([]);
    expect(merged.readFailed).toBe(false);
  });

  describe('a re-read that found more', () => {
    it('replaces a lane that gained a claim', () => {
      const merged = mergeEnrichment(
        enriched({ claims: [claim('a')] }),
        enriched({ claims: [claim('a'), claim('b')] }),
      );
      expect(merged.enrichment.claims).toHaveLength(2);
      expect(merged.regressions).toEqual([]);
    });

    it('adds a results table the stored record never had', () => {
      const merged = mergeEnrichment(
        enriched(),
        enriched({ results: results(4), resultsLine: 'ACME: Q1 FY27' }),
      );
      expect(merged.enrichment.resultsLine).toBe('ACME: Q1 FY27');
      expect(merged.regressions).toEqual([]);
    });

    it('adds an outcome to a record written before outcomes were stored', () => {
      const merged = mergeEnrichment(
        enriched({ outcome: null, outcomeSource: null, categoryGroup: null }),
        enriched(),
      );
      expect(merged.enrichment.outcome).toBe('ACME: bags an order');
      expect(merged.enrichment.categoryGroup).toBe('orders');
    });
  });

  describe('a re-read that found less', () => {
    it('keeps the stored claims and names the lane', () => {
      const merged = mergeEnrichment(
        enriched({
          claims: [claim('a'), claim('b')],
          claimLine: 'ACME: a || b',
          claimsProposed: 2,
        }),
        enriched({ claims: [], claimLine: null, claimsProposed: 0 }),
      );
      expect(merged.enrichment.claims).toHaveLength(2);
      expect(merged.enrichment.claimLine).toBe('ACME: a || b');
      expect(merged.enrichment.claimsProposed).toBe(2);
      expect(merged.regressions).toEqual(['claims']);
    });

    it('keeps a stored amount and its evidence together', () => {
      const merged = mergeEnrichment(
        enriched({
          amountRupees: 5_000_000,
          amountEvidence: 'Rs. 50,00,000',
          amountAnchor: 'sebi-label',
          headline: 'ACME BAGS ORDER Rs 50 lakh',
        }),
        enriched({
          amountRupees: null,
          amountEvidence: null,
          amountRefusalReason: 'no-candidate',
        }),
      );
      expect(merged.enrichment.amountRupees).toBe(5_000_000);
      expect(merged.enrichment.amountEvidence).toBe('Rs. 50,00,000');
      // The refusal reason belongs to the lane that was NOT taken, so it must
      // not survive beside a figure it contradicts.
      expect(merged.enrichment.amountRefusalReason).toBeNull();
      expect(merged.regressions).toEqual(['amount']);
    });

    it('loses no lane to another lane regressing', () => {
      // The claims lane went backwards and the results lane went forwards. Both
      // answers must hold at once, which is the whole reason this is per-lane.
      const merged = mergeEnrichment(
        enriched({ claims: [claim('a')] }),
        enriched({ claims: [], results: results(2), resultsLine: 'line' }),
      );
      expect(merged.enrichment.claims).toHaveLength(1);
      expect(merged.enrichment.resultsLine).toBe('line');
      expect(merged.regressions).toEqual(['claims']);
    });

    it('reports every lane that went backwards', () => {
      const merged = mergeEnrichment(
        enriched({
          amountRupees: 1,
          claims: [claim('a')],
          results: results(1),
          resultsLine: 'line',
        }),
        enriched(),
      );
      expect([...merged.regressions].sort()).toEqual([
        'amount',
        'claims',
        'results',
      ]);
    });
  });

  describe('a re-read that reached no verdict', () => {
    it.each(['unparseable', 'failed', 'pending'] as const)(
      'keeps the stored verdict whole when the re-read ended %s',
      (state) => {
        const previous = enriched({
          claims: [claim('a')],
          amountRupees: 1,
          documentChars: 40_000,
        });
        const merged = mergeEnrichment(previous, {
          ...PENDING_ENRICHMENT,
          state,
          attempts: 2,
          lastError: 'the exchange returned 404',
        });

        expect(merged.readFailed).toBe(true);
        expect(merged.enrichment.state).toBe('enriched');
        expect(merged.enrichment.claims).toHaveLength(1);
        expect(merged.enrichment.amountRupees).toBe(1);
        expect(merged.enrichment.documentChars).toBe(40_000);
        // The counters and the error DO move: what happened is still a fact
        // about the filing even when what was learned is nothing.
        expect(merged.enrichment.attempts).toBe(2);
        expect(merged.enrichment.lastError).toBe('the exchange returned 404');
        expect([...merged.regressions].sort()).toEqual(['amount', 'claims']);
      },
    );

    it('reports no regression when there was nothing to lose', () => {
      const merged = mergeEnrichment(enriched(), {
        ...PENDING_ENRICHMENT,
        state: 'unparseable',
        unparseableReason: 'not-found',
      });
      expect(merged.readFailed).toBe(true);
      expect(merged.regressions).toEqual([]);
    });

    it('lets a previously unreadable filing become readable', () => {
      // The reverse direction, and it must NOT be blocked: the stored record is
      // not `enriched`, so the new one simply wins. That is the entire point of
      // re-reading the raster scans Docling can now see.
      const merged = mergeEnrichment(
        { ...PENDING_ENRICHMENT, state: 'unparseable' },
        enriched({ claims: [claim('a')] }),
      );
      expect(merged.enrichment.state).toBe('enriched');
      expect(merged.enrichment.claims).toHaveLength(1);
      expect(merged.readFailed).toBe(false);
    });
  });

  describe('ties', () => {
    it('goes to the new read, so the evidence stays consistent', () => {
      const merged = mergeEnrichment(
        enriched({ amountRupees: 100, amountEvidence: 'old' }),
        enriched({ amountRupees: 100, amountEvidence: 'new' }),
      );
      expect(merged.enrichment.amountEvidence).toBe('new');
      expect(merged.regressions).toEqual([]);
    });
  });

  it('never mutates either argument', () => {
    const previous = enriched({ claims: [claim('a')] });
    const next = enriched({ claims: [] });
    const previousCopy = JSON.stringify(previous);
    const nextCopy = JSON.stringify(next);

    mergeEnrichment(previous, next);

    expect(JSON.stringify(previous)).toBe(previousCopy);
    expect(JSON.stringify(next)).toBe(nextCopy);
  });
});

describe('laneScore', () => {
  it('ranks a verified figure above a counterparty', () => {
    expect(laneScore(enriched({ amountRupees: 1 }), 'amount')).toBeGreaterThan(
      laneScore(enriched({ counterparty: 'ACME Ltd' }), 'amount'),
    );
  });

  it('ranks a verified claim above an unverified summary', () => {
    expect(
      laneScore(enriched({ claims: [claim('a')] }), 'claims'),
    ).toBeGreaterThan(
      laneScore(enriched({ documentSummary: 'a letter' }), 'claims'),
    );
  });

  it('ranks a published results line above any number of refused figures', () => {
    expect(
      laneScore(
        enriched({ resultsLine: 'line', results: results(1) }),
        'results',
      ),
    ).toBeGreaterThan(laneScore(enriched({ results: results(20) }), 'results'));
  });

  it('scores an empty lane at zero', () => {
    for (const lane of ['amount', 'claims', 'results'] as const) {
      expect(laneScore(enriched(), lane)).toBe(0);
    }
  });
});
