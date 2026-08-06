import {
  CLAIM_PROVIDER_PRICING,
  ELIGIBLE_FILINGS_PER_DAY,
  percentile,
  renderComparison,
  REPORTED_DISCARD_REASONS,
  summarise,
  type CallRecord,
} from './comparison-report';
import type { ClaimDiscard, ClaimProviderName } from '@app/filings';

/**
 * The arithmetic a purchasing decision would be made on.
 *
 * Tested rather than trusted because these numbers leave the process: an
 * invention rate computed off by one denominator, or a cost that silently
 * ignored the calls that reported nothing, is worse than no measurement — it is
 * a measurement somebody will act on.
 */
const discard = (reason: ClaimDiscard['reason']): ClaimDiscard => ({
  reason,
  claim: 'a claim',
  detail: 'a reason',
});

const record = (overrides: Partial<CallRecord> = {}): CallRecord => ({
  provider: 'anthropic',
  symbol: 'BIOCON',
  seqId: 1,
  documentChars: 7_583,
  latencyMs: 1_000,
  proposed: 0,
  accepted: [],
  line: null,
  discards: [],
  usage: null,
  failure: null,
  ...overrides,
});

const usage = (overrides: Partial<CallRecord['usage']> = {}) => ({
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteInputTokens: 0,
  ...overrides,
});

describe('percentile', () => {
  it('returns null for no observations', () => {
    expect(percentile([], 0.5)).toBeNull();
  });

  it.each([
    [[7], 0.5, 7],
    [[7], 0.9, 7],
    [[1, 2, 3], 0.5, 2],
    [[1, 2, 3, 4], 0.5, 2],
    [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9, 9],
    [[10, 1, 5], 0.9, 10],
  ])('reads p%p of %p as %p', (values, fraction, expected) => {
    expect(percentile(values, fraction)).toBe(expected);
  });

  it('only ever returns a value that actually happened', () => {
    // No interpolation: an interpolated p90 on a small sample is an average of
    // two observations, which is a latency no request ever took.
    const values = [100, 900];
    expect(values).toContain(percentile(values, 0.9));
    expect(values).toContain(percentile(values, 0.5));
  });

  it.each([
    [0, 1],
    [1, 10],
    [-1, 1],
    [2, 10],
  ])('clamps the fraction %p to a real rank', (fraction, expected) => {
    expect(percentile([1, 5, 10], fraction)).toBe(expected);
  });
});

describe('summarise: the invention rate', () => {
  it('is span-not-found over claims PROPOSED, not over claims discarded', () => {
    // The denominator is the whole point. Over discards it would report 100%
    // for a model whose only refusal was one invented span out of ten good
    // claims — the opposite of what happened.
    const records = [
      record({
        proposed: 10,
        accepted: ['a', 'b'],
        discards: [discard('span-not-found')],
      }),
    ];
    const summary = summarise(
      'anthropic',
      'claude-opus-5',
      records,
      CLAIM_PROVIDER_PRICING.anthropic,
    );
    expect(summary.inventionRate).toBeCloseTo(0.1);
  });

  it('counts only span-not-found, not every discard', () => {
    const records = [
      record({
        proposed: 4,
        discards: [
          discard('span-not-found'),
          discard('number-not-in-span'),
          discard('advisory-language'),
        ],
      }),
    ];
    expect(
      summarise('anthropic', 'm', records, CLAIM_PROVIDER_PRICING.anthropic)
        .inventionRate,
    ).toBeCloseTo(0.25);
  });

  it('is null rather than zero when nothing was proposed', () => {
    // "Invented nothing" and "proposed nothing" are different facts about a
    // model, and a zero would report the second as the first — which is the
    // flattering direction.
    expect(
      summarise(
        'anthropic',
        'm',
        [record({ proposed: 0 })],
        CLAIM_PROVIDER_PRICING.anthropic,
      ).inventionRate,
    ).toBeNull();
  });

  it('sums across documents rather than averaging per-document rates', () => {
    // Averaging rates weights a document that proposed one claim the same as
    // one that proposed ten.
    const records = [
      record({ proposed: 1, discards: [discard('span-not-found')] }),
      record({ proposed: 9, discards: [] }),
    ];
    expect(
      summarise('anthropic', 'm', records, CLAIM_PROVIDER_PRICING.anthropic)
        .inventionRate,
    ).toBeCloseTo(0.1);
  });
});

describe('summarise: which records it reads', () => {
  it('ignores the other provider’s calls entirely', () => {
    const records = [
      record({ provider: 'anthropic', proposed: 2 }),
      record({ provider: 'openrouter', proposed: 40 }),
    ];
    expect(
      summarise('anthropic', 'm', records, CLAIM_PROVIDER_PRICING.anthropic)
        .proposed,
    ).toBe(2);
    expect(
      summarise('openrouter', 'm', records, CLAIM_PROVIDER_PRICING.openrouter)
        .proposed,
    ).toBe(40);
  });

  it('counts a failed call as a call, and its claims as none', () => {
    // A provider that fails half the time is not a provider with half the
    // documents; dropping the failures would report a better latency and a
    // better acceptance rate than it earned.
    const summary = summarise(
      'anthropic',
      'm',
      [
        record({ failure: 'timeout' }),
        record({ proposed: 1, accepted: ['x'] }),
      ],
      CLAIM_PROVIDER_PRICING.anthropic,
    );
    expect(summary.documents).toBe(2);
    expect(summary.failures).toBe(1);
    expect(summary.accepted).toBe(1);
  });

  it('counts emitted lines apart from accepted claims', () => {
    const summary = summarise(
      'anthropic',
      'm',
      [
        record({ accepted: ['a', 'b'], line: 'X: A || B' }),
        record({ accepted: [], line: null }),
      ],
      CLAIM_PROVIDER_PRICING.anthropic,
    );
    expect(summary.accepted).toBe(2);
    expect(summary.linesEmitted).toBe(1);
  });
});

describe('summarise: cost', () => {
  it('prices each token class at its own rate', () => {
    const summary = summarise(
      'anthropic',
      'claude-opus-5',
      [
        record({
          usage: usage({
            inputTokens: 1_000_000,
            outputTokens: 1_000_000,
            cachedInputTokens: 1_000_000,
            cacheWriteInputTokens: 1_000_000,
          }),
        }),
      ],
      CLAIM_PROVIDER_PRICING.anthropic,
    );
    // 5 + 25 + 0.5 + 6.25 — cache reads are a tenth of input and cache writes a
    // premium on it. Folding them into one rate is how a report comes to say a
    // cached run cost what an uncached one would.
    expect(summary.costUsd).toBeCloseTo(36.75);
  });

  it('is null rather than zero when nothing reported usage', () => {
    // Unpriceable, not free.
    const summary = summarise(
      'openrouter',
      'm',
      [record({ provider: 'openrouter' })],
      CLAIM_PROVIDER_PRICING.openrouter,
    );
    expect(summary.costUsd).toBeNull();
    expect(summary.costPerDayUsd).toBeNull();
    expect(summary.callsWithUsage).toBe(0);
  });

  it('divides by every document, not only the priced ones', () => {
    // A run where one call reported usage and one did not covered two
    // documents. Dividing by one would double the per-document figure and
    // double the extrapolated daily bill.
    const summary = summarise(
      'anthropic',
      'm',
      [record({ usage: usage({ outputTokens: 1_000_000 }) }), record()],
      CLAIM_PROVIDER_PRICING.anthropic,
    );
    expect(summary.costUsd).toBeCloseTo(25);
    expect(summary.costPerDocumentUsd).toBeCloseTo(12.5);
    expect(summary.callsWithUsage).toBe(1);
  });

  it('extrapolates the day from the measured eligible volume', () => {
    const summary = summarise(
      'anthropic',
      'm',
      [record({ usage: usage({ outputTokens: 1_000_000 }) })],
      CLAIM_PROVIDER_PRICING.anthropic,
      10,
    );
    expect(summary.costPerDayUsd).toBeCloseTo(250);
  });

  it('defaults the daily volume to the measured 128 eligible filings', () => {
    expect(ELIGIBLE_FILINGS_PER_DAY).toBe(128);
    const summary = summarise(
      'anthropic',
      'm',
      [record({ usage: usage({ outputTokens: 1_000_000 }) })],
      CLAIM_PROVIDER_PRICING.anthropic,
    );
    expect(summary.costPerDayUsd).toBeCloseTo(25 * 128);
  });
});

describe('the price table', () => {
  it('names the model each price belongs to', () => {
    expect(CLAIM_PROVIDER_PRICING.anthropic.model).toBe('claude-opus-5');
    expect(CLAIM_PROVIDER_PRICING.openrouter.model).toBe(
      'deepseek/deepseek-v4-flash-0731',
    );
  });

  it('holds the verified OpenRouter prices', () => {
    expect(CLAIM_PROVIDER_PRICING.openrouter.inputPerMTok).toBe(0.09);
    expect(CLAIM_PROVIDER_PRICING.openrouter.outputPerMTok).toBe(0.18);
  });

  it('assumes no cache discount where none is documented', () => {
    // Pessimistic on purpose. Assuming a discount would flatter the cheaper
    // provider in the one report meant to decide whether it is worth having.
    const openrouter = CLAIM_PROVIDER_PRICING.openrouter;
    expect(openrouter.cachedInputPerMTok).toBe(openrouter.inputPerMTok);
    expect(openrouter.cacheWritePerMTok).toBe(openrouter.inputPerMTok);
  });
});

describe('renderComparison', () => {
  const summaries = (['anthropic', 'openrouter'] as const).map(
    (provider: ClaimProviderName) =>
      summarise(
        provider,
        CLAIM_PROVIDER_PRICING[provider].model,
        [
          record({
            provider,
            symbol: 'SWIGGY',
            seqId: 106727916,
            proposed: 3,
            accepted: ['targets ₹10,000 Cr adjusted EBITDA business by FY31'],
            line: 'SWIGGY: TARGETS ₹10,000 CR ADJUSTED EBITDA BUSINESS BY FY31',
            discards: [
              discard('span-not-found'),
              discard('number-not-in-span'),
            ],
            usage: usage({ inputTokens: 3_000, outputTokens: 400 }),
            latencyMs: provider === 'anthropic' ? 9_000 : 2_000,
          }),
        ],
        CLAIM_PROVIDER_PRICING[provider],
      ),
  );

  const rendered = renderComparison({
    generatedAt: '2026-08-06T00:00:00.000Z',
    effort: 'medium',
    summaries,
    records: [
      record({
        provider: 'anthropic',
        symbol: 'SWIGGY',
        seqId: 106727916,
        accepted: ['targets ₹10,000 Cr adjusted EBITDA business by FY31'],
        line: 'SWIGGY: TARGETS ₹10,000 CR',
        discards: [discard('span-not-found')],
      }),
      record({
        provider: 'openrouter',
        symbol: 'SWIGGY',
        seqId: 106727916,
        line: null,
        failure: 'OpenRouter responded 429: rate limit exceeded',
      }),
    ],
    ineligible: [
      { symbol: 'WELENT', reason: 'the document is 1269 characters' },
    ],
    filingsPerDay: 128,
  });

  it('leads with the invention rate for both providers', () => {
    expect(rendered).toContain('Invention rate');
    expect(rendered).toContain('33.3%');
  });

  it('names both providers and both models', () => {
    expect(rendered).toContain('anthropic');
    expect(rendered).toContain('openrouter');
    expect(rendered).toContain('claude-opus-5');
    expect(rendered).toContain('deepseek/deepseek-v4-flash-0731');
  });

  it('reports every discard reason, including the ones that never fired', () => {
    // A table that dropped empty rows could not be read as evidence that a rule
    // ran and found nothing.
    for (const reason of REPORTED_DISCARD_REASONS) {
      expect(rendered).toContain(reason);
    }
  });

  it('shows the accepted lines side by side per filing', () => {
    expect(rendered).toContain('### SWIGGY');
    expect(rendered).toContain(
      'accepted: targets ₹10,000 Cr adjusted EBITDA business by FY31',
    );
  });

  it('shows a failure instead of pretending the provider found nothing', () => {
    expect(rendered).toContain('FAILED: OpenRouter responded 429');
  });

  it('lists what the deterministic gate refused before any model was called', () => {
    expect(rendered).toContain('Never sent to a model');
    expect(rendered).toContain('WELENT');
  });

  it('states the effort and the ladder clamp', () => {
    expect(rendered).toContain('medium');
    expect(rendered).toContain('three rungs');
  });

  it('extrapolates the daily cost under a labelled column', () => {
    expect(rendered).toContain('Cost/day @ 128');
  });

  it('warns when a run was priced at a different model’s rates', () => {
    const mismatched = renderComparison({
      generatedAt: 'now',
      effort: 'low',
      summaries: [
        summarise(
          'openrouter',
          'qwen/qwen3-max',
          [record({ provider: 'openrouter', usage: usage() })],
          CLAIM_PROVIDER_PRICING.openrouter,
        ),
      ],
      records: [],
      ineligible: [],
      filingsPerDay: 128,
    });
    expect(mismatched).toContain('Cost for openrouter is approximate');
  });

  it('warns when usage was reported on only some calls', () => {
    const partial = renderComparison({
      generatedAt: 'now',
      effort: 'low',
      summaries: [
        summarise(
          'openrouter',
          CLAIM_PROVIDER_PRICING.openrouter.model,
          [
            record({ provider: 'openrouter', usage: usage() }),
            record({ provider: 'openrouter' }),
          ],
          CLAIM_PROVIDER_PRICING.openrouter,
        ),
      ],
      records: [],
      ineligible: [],
      filingsPerDay: 128,
    });
    expect(partial).toContain('reported usage on only 1 of 2 calls');
    expect(partial).toContain('a floor, not a total');
  });

  it('renders with no records at all rather than throwing', () => {
    expect(() =>
      renderComparison({
        generatedAt: 'now',
        effort: 'low',
        summaries: [],
        records: [],
        ineligible: [],
        filingsPerDay: 128,
      }),
    ).not.toThrow();
  });
});
