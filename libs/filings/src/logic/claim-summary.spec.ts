import {
  MAX_SUMMARY_CHARS,
  MIN_SUMMARY_CHARS,
  vetSummary,
  type SummaryRefusalReason,
} from './claim-summary';

const REAL =
  'Anup Engineering reported Q1 FY27 revenue of Rs 125.2 Cr and EBITDA of ' +
  'Rs 9.5 Cr, with an order book of Rs 985 Cr including a letter of intent.';

describe('vetSummary — what it accepts', () => {
  it('accepts ordinary prose about a company', () => {
    expect(vetSummary(REAL)).toEqual({ outcome: 'ok', summary: REAL });
  });

  it('collapses whitespace, because pdf prose arrives broken by the page', () => {
    const result = vetSummary(`  An   investor\npresentation for the quarter,
      with revenue and margin figures.  `);
    expect(result).toEqual({
      outcome: 'ok',
      summary:
        'An investor presentation for the quarter, with revenue and margin figures.',
    });
  });

  it('ACCEPTS a summary about a person, which a claim never would', () => {
    // Deliberate, and argued in the module. The largest category this pipeline
    // has just stopped being blind to is 100% about people; refusing a summary
    // on every one of them would leave the category as invisible as it was.
    // What protects a person here is that a summary reaches no wire.
    expect(
      vetSummary(
        'The company intimated the exchange that its chief financial officer ' +
          'has stepped down with effect from 5 August 2026.',
      ).outcome,
    ).toBe('ok');
  });

  it('accepts a company’s own forward statement', () => {
    // The same line `claim-advisory.ts` draws: language about the COMPANY is
    // allowed, language about the SECURITY is not.
    expect(
      vetSummary(
        'The company guided to constant currency revenue growth of 10-13% and ' +
          'an EBIT margin of 12.25-12.75% for the coming financial year.',
      ).outcome,
    ).toBe('ok');
  });
});

describe('vetSummary — what it refuses', () => {
  const reasonOf = (raw: unknown): SummaryRefusalReason | 'accepted' => {
    const result = vetSummary(raw);
    return result.outcome === 'ok' ? 'accepted' : result.reason;
  };

  it.each([
    ['nothing at all', undefined],
    ['null', null],
    ['a number', 42],
    ['an object', { summary: 'x' }],
    ['an empty string', ''],
    ['whitespace', '     '],
    ['a fragment', 'an update'],
  ])('refuses %s as empty', (_label, raw) => {
    expect(reasonOf(raw)).toBe<SummaryRefusalReason>('empty');
  });

  it('REFUSES rather than truncating an over-long summary', () => {
    // Half a sentence of model prose about a listed company reads as a
    // statement the model did not make.
    expect(reasonOf('a'.repeat(MAX_SUMMARY_CHARS + 1))).toBe('empty');
  });

  it('accepts a summary exactly at the bound', () => {
    expect(reasonOf(`The company ${'a'.repeat(MAX_SUMMARY_CHARS - 12)}`)).toBe(
      'accepted',
    );
  });

  it.each([
    ['a stock view', 'This is clearly positive for the stock going forward.'],
    [
      'a price target',
      'The target price should be raised to Rs 1,450 on this.',
    ],
    [
      'a recommendation',
      'Investors should buy the stock on this announcement.',
    ],
  ])('refuses %s as advisory', (_label, raw) => {
    // A prompt is a request and a filter is a control. One unhonoured
    // instruction is the SEBI research-analyst line sitting in a database
    // against a named listed company, published or not.
    expect(reasonOf(raw)).toBe<SummaryRefusalReason>('advisory-language');
  });

  it.each([
    [
      'litigation',
      'The company disclosed a civil suit filed before the Bombay High Court.',
    ],
    [
      'enforcement',
      'The company received a show cause notice from the regulator this week.',
    ],
  ])('refuses %s as legally blocked', (_label, raw) => {
    expect(reasonOf(raw)).toBe<SummaryRefusalReason>('legally-blocked');
  });

  it('names the rule that refused it, so a refusal can be reviewed', () => {
    const result = vetSummary('This is positive for the stock going forward.');
    expect(result.outcome).toBe('refused');
    if (result.outcome !== 'refused') return;
    expect(result.detail.length).toBeGreaterThan(0);
  });
});

describe('vetSummary — the bounds', () => {
  it('keeps a summary short enough that it cannot replace the document', () => {
    expect(MIN_SUMMARY_CHARS).toBe(20);
    expect(MAX_SUMMARY_CHARS).toBe(400);
  });
});
