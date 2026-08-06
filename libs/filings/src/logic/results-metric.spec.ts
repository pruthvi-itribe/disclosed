import { isResultsMetric, metricLabelRefusal } from './results-metric';
import { RESULTS_METRICS, type ResultsMetric } from './results.types';

/** Rows lifted verbatim from a real Regulation 33 statement. */
const ROWS = {
  revenue: '1 Revenue from operations 73,977.90 73,356.74 65,607.59',
  totalIncome: '3   Total income (1 + 2)74,561.21 73,708.95 65,796.53',
  netProfit:
    '11  Profit for the period / year (9 - 10)3,488.72 6,309.73 128.78',
  profitBeforeTax: '9   Profit before tax (7 - 8)4,676.93 1,616.53 383.58',
  profitBeforeExceptional:
    '7   Profit before exceptional items and tax (5 + 6)4,441.57 6,177.84',
  comprehensive:
    '13 Total comprehensive income / (loss) for the period 7,053.23 8,181.52',
  segmentRevenue: 'Segment revenue73,977.90 73,356.74 65,607.59',
  eps: '17  Earnings per equity share (face value of ₹ 1 each) (a) Basic (₹) 5.52 9.97 0.20',
  dilutedOnly: '(b) Diluted (₹) 5.52 9.97 0.20',
} as const;

describe('metricLabelRefusal', () => {
  it.each([
    ['revenue', ROWS.revenue],
    ['total-income', ROWS.totalIncome],
    ['net-profit', ROWS.netProfit],
    ['eps', ROWS.eps],
  ] as const)('accepts the %s row of a real statement', (metric, row) => {
    expect(metricLabelRefusal(metric, row)).toBeNull();
  });

  it.each([
    // THE ROWS THIS EXISTS FOR. A statement stacks four "profits", every one
    // verbatim in the document, and only the last is the net profit a wire
    // means. The verbatim gate cannot tell them apart.
    ['profit before tax', 'net-profit', ROWS.profitBeforeTax],
    [
      'profit before exceptional items',
      'net-profit',
      ROWS.profitBeforeExceptional,
    ],
    ['total comprehensive income', 'net-profit', ROWS.comprehensive],
    ['a segment revenue row', 'revenue', ROWS.segmentRevenue],
    ['the total-income row', 'revenue', ROWS.totalIncome],
    ['a diluted-only EPS row', 'eps', ROWS.dilutedOnly],
    ['a revenue row offered as EPS', 'eps', ROWS.revenue],
  ] as const)('refuses %s offered as %s', (_label, metric, row) => {
    expect(metricLabelRefusal(metric, row)).not.toBeNull();
  });

  it('says WHICH half of the test failed', () => {
    // Two different reviews follow from the two answers: a row that carries no
    // such label at all, and a row that carries a rival's.
    expect(metricLabelRefusal('net-profit', ROWS.revenue)).toContain(
      'does not carry',
    );
    expect(metricLabelRefusal('net-profit', ROWS.profitBeforeTax)).toContain(
      'does not carry',
    );
    expect(
      metricLabelRefusal(
        'revenue',
        'Segment revenue from operations 55,287.49 48,286.99',
      ),
    ).toContain('a different line');
    expect(
      metricLabelRefusal('eps', 'Earnings per equity share (Diluted) 5.52'),
    ).toContain('does not say which');
  });

  it.each([
    ['a stated EBITDA', 'ebitda', 'EBITDA 8,679.69 8,677.46', null],
    [
      'a revenue row offered as EBITDA',
      'ebitda',
      ROWS.revenue,
      'does not carry',
    ],
    [
      'an EBITDA margin row offered as EBITDA',
      'ebitda',
      'EBITDA margin 11.73% 13.23%',
      'a different line',
    ],
    [
      'a stated EBITDA margin',
      'ebitda-margin',
      'EBITDA margin 11.73% 13.23%',
      null,
    ],
    [
      'a bare margin row',
      'ebitda-margin',
      'Operating margin 11.73% 13.23%',
      'does not carry',
    ],
  ] as const)('reads %s', (_label, metric, row, expected) => {
    const refusal = metricLabelRefusal(metric, row);
    if (expected === null) expect(refusal).toBeNull();
    else expect(refusal).toContain(expected);
  });

  it('refuses an EBITDA a statutory statement never printed', () => {
    // The competitor's own EBITDA line for the acceptance filing was computed
    // from the table: revenue less expenses with finance costs and depreciation
    // added back. The document prints no such row, so quoting any row of it as
    // EBITDA fails here — which is the intended outcome, not a gap.
    for (const row of Object.values(ROWS)) {
      expect(metricLabelRefusal('ebitda', row)).not.toBeNull();
    }
  });

  it('has a rule for every metric, so none is admitted unchecked', () => {
    for (const metric of RESULTS_METRICS) {
      // A metric with no rule would return null for every row, which is an
      // unlabelled figure published under a name nothing checked.
      expect(metricLabelRefusal(metric, 'x')).not.toBeNull();
    }
  });
});

describe('isResultsMetric', () => {
  it.each([...RESULTS_METRICS])('accepts %s', (metric) => {
    expect(isResultsMetric(metric)).toBe(true);
  });

  it.each([
    ['a metric that does not exist', 'gross-margin'],
    ['a number', 3],
    ['null', null],
    ['undefined', undefined],
    ['an object', {}],
  ])('refuses %s', (_label, value) => {
    expect(isResultsMetric(value)).toBe(false);
  });

  it('narrows to the union', () => {
    const value: unknown = 'revenue';
    if (!isResultsMetric(value)) throw new Error('expected a metric');
    const metric: ResultsMetric = value;
    expect(metric).toBe('revenue');
  });
});
