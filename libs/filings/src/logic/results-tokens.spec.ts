import {
  canonicalValue,
  columnDatesIn,
  isNegativeValue,
  isYearBefore,
  sameDay,
  valueTokensIn,
  type ColumnDate,
} from './results-tokens';

/** The real Apollo Tyres Q1 FY27 rows, as `pdf-parse` produced them. */
const REVENUE_ROW =
  'Revenue from operations\n73,977.90       \n73,356.74   65,607.59    2,84,706.00     ';
const PROFIT_ROW =
  '11  Profit for the period / year (9 - 10)3,488.72      6,309.73  128.78      13,724.16  ';
const EPS_ROW =
  '17  Earnings per equity share (face value of ₹ 1 each) (not annualised)\n(a) Basic (₹)\n5.52  \n9.97   0.20     21.66    ';
const INVENTORY_ROW =
  '(c) Changes in inventories of finished goods, stock-in-trade and\nwork-in-progress\n(4,191.73)      \n(1,956.86)       (2,646.56)  (1,470.35)    ';

const raws = (row: string): readonly string[] =>
  valueTokensIn(row).map((token) => token.raw);

describe('valueTokensIn', () => {
  it.each([
    [
      'a revenue row',
      REVENUE_ROW,
      ['73,977.90', '73,356.74', '65,607.59', '2,84,706.00'],
    ],
    [
      'a row whose label carries a serial number and a formula',
      PROFIT_ROW,
      ['3,488.72', '6,309.73', '128.78', '13,724.16'],
    ],
    [
      'a row whose label carries a face value',
      EPS_ROW,
      ['5.52', '9.97', '0.20', '21.66'],
    ],
    [
      'a row of accounting negatives',
      INVENTORY_ROW,
      ['(4,191.73)', '(1,956.86)', '(2,646.56)', '(1,470.35)'],
    ],
  ])('reads %s as four cells', (_label, row, expected) => {
    expect(raws(row)).toEqual(expected);
  });

  it('reads every real row of one statement as the same number of cells', () => {
    // THE PROPERTY THE COLUMN CHECK RESTS ON. Four dates in the header means
    // four cells in every row, or the row cannot be placed in a column at all.
    for (const row of [REVENUE_ROW, PROFIT_ROW, EPS_ROW, INVENTORY_ROW]) {
      expect(valueTokensIn(row)).toHaveLength(4);
    }
  });

  it.each([
    ['a bare serial number', '11 Total something', []],
    ['a formula reference', 'Total income (1 + 2)', []],
    ['a face value', 'equity shares of ₹ 1 each', []],
    ['a bare integer with no grouping and no decimals', 'Value 500', []],
  ])('does not read %s as a cell', (_label, row, expected) => {
    expect(raws(row)).toEqual(expected);
  });

  it('does not read a date in the row as a cell', () => {
    // `30.06.2026` matches the decimal branch as `30.06`. Left in, the row
    // would gain a phantom cell and every value after it would shift a column.
    expect(raws('Quarter ended 30.06.2026 revenue 1,234.00')).toEqual([
      '1,234.00',
    ]);
    expect(raws('as at June 30, 2026 the figure was 9,999.99')).toEqual([
      '9,999.99',
    ]);
  });

  it('carries the sign apart from the digits', () => {
    const [negative] = valueTokensIn('(4,191.73)');
    expect(negative).toEqual({
      raw: '(4,191.73)',
      canonical: '4191.73',
      negative: true,
    });
    const [positive] = valueTokensIn('4,191.73');
    expect(positive.negative).toBe(false);
    // Same digits, different fact. A gate that compared only `canonical` would
    // let a loss be published as a profit.
    expect(positive.canonical).toBe(negative.canonical);
  });

  it('returns nothing for a row with no cells at all', () => {
    expect(valueTokensIn('PARTICULARS QUARTER ENDED YEAR ENDED')).toEqual([]);
  });
});

describe('canonicalValue and isNegativeValue', () => {
  it.each([
    ['grouped digits', '73,977.90', '73977.90'],
    ['Indian grouping', '2,84,706.00', '284706.00'],
    ['accounting parentheses', '(4,191.73)', '4191.73'],
    ['a leading minus', '-4,191.73', '4191.73'],
    ['spaces inside parentheses', '( 4,191.73 )', '4191.73'],
  ])('folds %s', (_label, raw, expected) => {
    expect(canonicalValue(raw)).toBe(expected);
  });

  it('does NOT fold a rescaling', () => {
    // The rule `claim-numbers.ts` states for money, restated for a cell:
    // 73,977.90 million and 73.98 billion are the same money and not the same
    // evidence.
    expect(canonicalValue('73,977.90')).not.toBe(canonicalValue('73.98'));
  });

  it.each([
    ['(4,191.73)', true],
    ['-4,191.73', true],
    ['  (4,191.73)', true],
    ['4,191.73', false],
  ])('reads the sign of %s', (raw, expected) => {
    expect(isNegativeValue(raw)).toBe(expected);
  });
});

describe('columnDatesIn', () => {
  it('reads run-together dates, which is how a PDF prints them', () => {
    expect(
      columnDatesIn('30.06.202631.03.202630.06.202531.03.2026').map(
        (date) => date.raw,
      ),
    ).toEqual(['30.06.2026', '31.03.2026', '30.06.2025', '31.03.2026']);
  });

  it.each([
    ['dots', '30.06.2026 31.03.2026', ['30.06.2026', '31.03.2026']],
    ['slashes', '30/06/2026 31/03/2026', ['30/06/2026', '31/03/2026']],
    ['dashes', '30-06-2026 31-03-2026', ['30-06-2026', '31-03-2026']],
    ['a month name first', 'June 30, 2026', ['June 30, 2026']],
    ['a day first', '30 June 2026', ['30 June 2026']],
    ['an ordinal day', '30th September, 2026', ['30th September, 2026']],
  ])('reads %s', (_label, header, expected) => {
    expect(columnDatesIn(header).map((date) => date.raw)).toEqual(expected);
  });

  it('reads the parts, not just the text', () => {
    expect(columnDatesIn('30.06.2026')[0]).toEqual({
      raw: '30.06.2026',
      day: 30,
      month: 6,
      year: 2026,
    });
    expect(columnDatesIn('June 30, 2026')[0]).toMatchObject({
      day: 30,
      month: 6,
      year: 2026,
    });
  });

  it('counts an overlapping match once', () => {
    // `June 30, 2026` is found by the month-first branch; nothing must add it a
    // second time, or the row's four cells would face five columns.
    expect(columnDatesIn('June 30, 2026 30 June 2026')).toHaveLength(2);
  });

  it.each([
    ['an impossible day', '32.06.2026'],
    ['an impossible month', '30.13.2026'],
    ['no date at all', 'PARTICULARS QUARTER ENDED'],
  ])('reads nothing from %s', (_label, header) => {
    expect(columnDatesIn(header)).toEqual([]);
  });
});

describe('sameDay and isYearBefore', () => {
  const date = (day: number, month: number, year: number): ColumnDate => ({
    raw: `${day}.${month}.${year}`,
    day,
    month,
    year,
  });

  it.each([
    ['the year-ago quarter', date(30, 6, 2026), date(30, 6, 2025), true],
    ['the previous quarter', date(30, 6, 2026), date(31, 3, 2026), false],
    ['two years earlier', date(30, 6, 2026), date(30, 6, 2024), false],
    ['the same quarter', date(30, 6, 2026), date(30, 6, 2026), false],
    ['a LATER year', date(30, 6, 2025), date(30, 6, 2026), false],
  ])('%s is year-on-year: %s', (_label, current, prior, expected) => {
    expect(isYearBefore(current, prior)).toBe(expected);
  });

  it('compares the day and month without the year', () => {
    expect(sameDay(date(30, 6, 2026), date(30, 6, 2019))).toBe(true);
    expect(sameDay(date(30, 6, 2026), date(31, 3, 2026))).toBe(false);
    // The DAY on its own, with the month held equal: a 29 June column beside a
    // 30 June one is a different period end, not the year-ago quarter.
    expect(sameDay(date(30, 6, 2026), date(29, 6, 2025))).toBe(false);
    expect(isYearBefore(date(30, 6, 2026), date(29, 6, 2025))).toBe(false);
  });
});
