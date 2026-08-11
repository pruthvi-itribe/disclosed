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

/**
 * The spellings Docling emits, and the ones it emits that cannot be read.
 *
 * EVERY STRING HERE IS A REAL HEADER CELL. They come from the statement header
 * blocks of the 137-document Docling sweep (`npm run tiers:measure`, dumped to
 * `/tmp/tier-sweep`) and from `__fixtures__/results-header-corpus.json`; the
 * count beside each is that sweep's, in cells and in filings. Nothing here was
 * invented to exercise a branch.
 */
describe('columnDatesIn, on the spellings Docling emits', () => {
  const read = (header: string) => columnDatesIn(header)[0];

  it.each([
    // 180 cells / 14 filings — the largest unread family in the sweep by 9x.
    ['a dashed two-digit year', '30-Jun-26', 30, 6, 2026],
    ['the same, decorated', '31-Mar-26 (Audited)', 31, 3, 2026],
    // 8 / 2. The day is separated by a dot and the year by a dash.
    ['a dotted day and a dashed year', '30.Jun-26', 30, 6, 2026],
    // 8 / 2. No separator at all before the year.
    ['no separator before the year', '31-Mar26', 31, 3, 2026],
    // 2 / 1. No separator anywhere.
    ['no separator anywhere', '30Jun26', 30, 6, 2026],
    // 8 / 3. An extra space between the day and its ordinal suffix.
    ['a detached ordinal', '30 th June 2026', 30, 6, 2026],
    ['the same, month spelled short', 'As of 31 st Mar 2026', 31, 3, 2026],
    // 1 / 1. A space before the separator instead of after it.
    ['a space before the dash', '31 -Mar-26', 31, 3, 2026],
    // 21 / 7. The space after the comma is gone.
    ['no space after the comma', 'June 30,2026', 30, 6, 2026],
    // 4 / 2. And here it is on the other side of the comma.
    ['a space before the comma', 'March 31 , 2026', 31, 3, 2026],
    // 2 / 2. No space between the month name and the day.
    ['no space after the month', 'June30, 2025', 30, 6, 2025],
    ['no space anywhere in it', 'March31,2026', 31, 3, 2026],
    // 1 / 1. A dot where the comma belongs.
    ['a dot for the comma', 'June 30. 2026', 30, 6, 2026],
    // 2 / 1. A one-digit month, and a four-digit year to anchor it.
    ['a one-digit month', 'Quarter Ended 31.3.2026', 31, 3, 2026],
    ['a one-digit day and month', '1-4-2026', 1, 4, 2026],
    // LINDEINDIA 106737549's own header: no space between the day and the
    // month name, and the case of the `j` differs between two cells of one row.
    [
      'no space before the month name',
      'Three months ended 30june 2026',
      30,
      6,
      2026,
    ],
    ['the same, capitalised', 'Three months ended 30June 2025', 30, 6, 2025],
  ])('reads %s', (_label, header, day, month, year) => {
    expect(read(header)).toMatchObject({ day, month, year });
  });

  it('resolves a two-digit year into this century, and says so in the raw', () => {
    // The only two-digit years the sweep prints are 25 and 26 — 55 and 164
    // occurrences — which are the year of these filings and the one before it.
    expect(columnDatesIn('30-Jun-26')[0]).toEqual({
      raw: '30-Jun-26',
      day: 30,
      month: 6,
      year: 2026,
    });
    expect(columnDatesIn('30-Jun-25')[0].year).toBe(2025);
  });

  it('reads a four-date header the sweep could only read two of', () => {
    // LINDEINDIA 106737549, the filing this work started from: one header row,
    // four columns, and two spellings of the same month.
    const header =
      '| Particulars | Three months ended 30june 2026 (Unaudited) | Three ' +
      'months ended 31 March 2026 (Unaudited) | Three months ended 30June ' +
      '2025 (Unaudited) | Year ended 31 March 2026 (Audited) |';

    expect(
      columnDatesIn(header).map(
        (date) => `${date.day}/${date.month}/${date.year}`,
      ),
    ).toEqual(['30/6/2026', '31/3/2026', '30/6/2025', '31/3/2026']);
  });

  it.each([
    // 11 cells / 4 filings state a month and a year and no day. Which day the
    // period ended is the filer's to state, not this pipeline's to assume.
    ['a month and a year with no day', 'March 2026'],
    ['the same, abbreviated', 'Jun-26'],
    ['a quarter label carrying one', 'Q1 FY27 (Jun-26)'],
    // 16 cells / 1 filing (106728262) print `June 30` in one row and `2026` in
    // the row under it, per column. Binding them needs a column model, and the
    // four years in that row are not all the same, so there is no single year
    // to bind. A wrong year here is a real figure filed under the wrong period.
    ['a month and a day with the year elsewhere', 'June 30'],
    ['the same, in March', 'March 31'],
    // 6 / 4. The last digit of the year came back as a letter, or not at all.
    ['a year with a letter in it', '30/06/202S'],
    ['a year with a digit missing', '30.06.202'],
    // 7 cells / 1 filing (106727461), which prints `3006 2026`, `31032026` and
    // `30062025` in ONE header row, and `300672026` and `3000672025` elsewhere.
    // The digit run is not a fixed width, so no split is determined by the text.
    ['a mashed digit run', 'Quarter Ended 3006 2026'],
    ['the same, unspaced', 'Quarter Ended 31032026'],
    ['the same, with a digit inserted', 'Quarter Ended 300672026'],
    // 9 / 4. A stray space inside the separator. Left unread rather than
    // guessed at: this shape is not one of the widenings this change makes.
    ['a stray space in the separator', '31 .03.2026'],
    ['the same, after the slash', '31/03/ 2026'],
    // 0 cells in the sweep. `DD.MM.YY` is not a spelling this corpus uses for a
    // column, and it IS how the same corpus writes phone numbers (`+91-22-25`),
    // circular references (`/26-27/47`) and OCR-damaged values (`9.32.99`).
    ['an all-numeric two-digit year', '31.3.26'],
    ['the same, dotted', '30.06.25'],
    // The month name is damaged, so which month it is has to be guessed.
    ['a misspelled month', 'Jume 30,2026'],
  ])('refuses %s', (_label, header) => {
    expect(columnDatesIn(header)).toEqual([]);
  });

  it('refuses a year outside this century, however well formed', () => {
    // `30-06-21126` is what one sweep document (106729290) prints. The current
    // parser reads `30-06-2112` out of it — a well-formed date that is not a
    // date — because a four-digit year with a digit behind it still matches.
    expect(columnDatesIn('30-06-21126 Unaudited')).toEqual([]);
    expect(columnDatesIn('30-06-1999')).toEqual([]);
  });

  it('does not take a day out of the tail of a longer number', () => {
    // `111 August 2026` is in the sweep (106730901). Reading `11 August 2026`
    // out of it invents a column the document does not state.
    expect(columnDatesIn('111 August 2026')).toEqual([]);
  });

  it('still counts an overlapping match once, on the widened spellings', () => {
    // The header's date count is the table's column count. A spelling read
    // twice is a column that does not exist, and every row then misaligns.
    expect(columnDatesIn('June 30,2026 30june 2026')).toHaveLength(2);
    expect(columnDatesIn('30-Jun-26 31-Mar-26 30-Jun-25')).toHaveLength(3);
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
