import {
  composeResultsFigure,
  composeResultsLine,
  MAX_RESULTS_LINE_CHARS,
  RESULTS_SEPARATOR,
} from './results-line';
import type { VerifiedResults, VerifiedResultsFigure } from './results.types';

const figure = (
  overrides: Partial<VerifiedResultsFigure> = {},
): VerifiedResultsFigure => ({
  metric: 'revenue',
  current: '73,977.90',
  prior: '65,607.59',
  unit: 'MN',
  span: 'Revenue from operations 73,977.90 73,356.74 65,607.59',
  ...overrides,
});

const results = (
  figures: readonly VerifiedResultsFigure[],
  overrides: Partial<VerifiedResults> = {},
): VerifiedResults => ({
  basis: 'consolidated',
  basisSpan: 'UNAUDITED CONSOLIDATED FINANCIAL RESULTS',
  columnsSpan: '30.06.202630.06.2025',
  period: 'Q1 FY27',
  priorPeriod: 'Q1 FY26',
  figures,
  ...overrides,
});

describe('composeResultsFigure', () => {
  it.each([
    [
      'a scaled figure',
      figure(),
      'REVENUE ₹73,977.90 MN VS ₹65,607.59 MN (YOY)',
    ],
    [
      'a net profit',
      figure({ metric: 'net-profit', current: '3,488.72', prior: '128.78' }),
      'NET PROFIT ₹3,488.72 MN VS ₹128.78 MN (YOY)',
    ],
    [
      'a per-share figure',
      figure({ metric: 'eps', current: '5.52', prior: '0.20', unit: '' }),
      'EPS ₹5.52 VS ₹0.20 (YOY)',
    ],
    [
      'a margin',
      figure({
        metric: 'ebitda-margin',
        current: '11.73',
        prior: '13.23',
        unit: '%',
      }),
      'EBITDA MARGIN 11.73% VS 13.23% (YOY)',
    ],
    [
      'a swing into loss',
      figure({
        metric: 'net-profit',
        current: '(4,191.73)',
        prior: '128.78',
      }),
      'NET PROFIT -₹4,191.73 MN VS ₹128.78 MN (YOY)',
    ],
  ])('renders %s', (_label, row, expected) => {
    expect(composeResultsFigure(row)).toBe(expected);
  });
});

describe('composeResultsLine', () => {
  it('composes the acceptance case', () => {
    expect(
      composeResultsLine(
        'APOLLOTYRE',
        results([
          figure({
            metric: 'net-profit',
            current: '3,488.72',
            prior: '128.78',
          }),
          figure(),
        ]),
      ),
    ).toBe(
      'APOLLOTYRE Q1 FY27 (CONSOLIDATED): ' +
        'NET PROFIT ₹3,488.72 MN VS ₹128.78 MN (YOY) || ' +
        'REVENUE ₹73,977.90 MN VS ₹65,607.59 MN (YOY)',
    );
  });

  it('states the basis in full and never abbreviates it', () => {
    // The competitor writes `CONS`. Confusing the two statements is the single
    // most dangerous error this lane can make, and eight characters is not a
    // reason to make it easier.
    const line = composeResultsLine('ACME', results([figure()]));
    expect(line).toContain('(CONSOLIDATED)');
    expect(line).not.toContain('CONS)');
    expect(
      composeResultsLine('ACME', results([figure()], { basis: 'standalone' })),
    ).toContain('(STANDALONE)');
  });

  it('keeps the filer own scale rather than converting it', () => {
    // `₹10,000 CR` is `100 billion rupees`. It is the same money and it is not
    // the same evidence, so the filer's unit survives.
    const line = composeResultsLine(
      'SWIGGY',
      results([figure({ current: '10,000', prior: '8,000', unit: 'CR' })]),
    );
    expect(line).toContain('₹10,000 CR VS ₹8,000 CR');
    expect(line).not.toContain('100B');
  });

  it('uppercases and collapses the symbol', () => {
    expect(composeResultsLine(' apollo tyre ', results([figure()]))).toContain(
      'APOLLO TYRE Q1 FY27',
    );
  });

  it('returns null for a symbol that is not one', () => {
    // A line whose head is a bare period and basis names no company.
    expect(composeResultsLine('   ', results([figure()]))).toBeNull();
  });

  it('returns null rather than a line with nothing on it', () => {
    // A bare `SYMBOL Q1 FY27 (CONSOLIDATED):` on a wire reads as a results
    // announcement with no results in it.
    expect(composeResultsLine('APOLLOTYRE', results([]))).toBeNull();
  });

  it('drops the tail rather than truncating a figure', () => {
    const many = Array.from({ length: 20 }, (_unused, index) =>
      figure({ current: `${index},000.00` }),
    );
    const line = composeResultsLine('ACME', results(many));
    if (line === null) throw new Error('expected a line');
    expect(line.length).toBeLessThanOrEqual(MAX_RESULTS_LINE_CHARS);
    // Every segment is a whole figure: half a figure is a different figure.
    for (const part of line.split(RESULTS_SEPARATOR).slice(1)) {
      expect(part).toMatch(/\(YOY\)$/);
    }
  });

  it('bounds the line at a literal as well as at the constant', () => {
    expect(MAX_RESULTS_LINE_CHARS).toBe(700);
  });

  it('adds no word of its own', () => {
    // Everything on the line originates in a verified fact: the stored symbol,
    // the period derived from a quoted date, the basis the document stated, the
    // metric names, and the filer's own figures.
    const line = composeResultsLine('ACME', results([figure()]));
    if (line === null) throw new Error('expected a line');
    expect(line.replace(/[A-Z₹0-9.,%():| -]/g, '')).toBe('');
  });
});
