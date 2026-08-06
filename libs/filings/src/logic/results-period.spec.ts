import {
  conflictingQuarter,
  PERIOD_CONFLICT_CHARS,
  periodForColumnDate,
} from './results-period';
import type { ColumnDate } from './results-tokens';

const on = (day: number, month: number, year: number): ColumnDate => ({
  raw: `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.${year}`,
  day,
  month,
  year,
});

describe('periodForColumnDate', () => {
  it.each([
    ['30 June 2026', on(30, 6, 2026), 'Q1 FY27'],
    ['30 September 2026', on(30, 9, 2026), 'Q2 FY27'],
    ['31 December 2026', on(31, 12, 2026), 'Q3 FY27'],
    ['31 March 2026', on(31, 3, 2026), 'Q4 FY26'],
    ['the year-ago June', on(30, 6, 2025), 'Q1 FY26'],
    ['a century boundary', on(31, 3, 2100), 'Q4 FY00'],
  ])('labels a quarter ended %s', (_label, date, expected) => {
    expect(periodForColumnDate(date)?.label).toBe(expected);
  });

  it('puts the March quarter in the year it ends, not the next one', () => {
    // The one asymmetry in the mapping, and the easiest to get wrong. The
    // financial year ends 31 March, so the March quarter closes FY26 while the
    // June quarter opens FY27.
    expect(periodForColumnDate(on(31, 3, 2026))?.fiscalYear).toBe('26');
    expect(periodForColumnDate(on(30, 6, 2026))?.fiscalYear).toBe('27');
  });

  it.each([
    ['a month end that closes no quarter', on(31, 1, 2026)],
    ['a day that is not the month end', on(29, 6, 2026)],
    ['31 June, which does not exist', on(31, 6, 2026)],
    ['30 March rather than 31', on(30, 3, 2026)],
  ])('refuses %s rather than guessing', (_label, date) => {
    // FAILS CLOSED. A company permitted a non-March year end under the narrow
    // exception in the Companies Act must produce nothing rather than a label
    // derived from a calendar that does not apply to it.
    expect(periodForColumnDate(date)).toBeNull();
  });

  it('reports the quarter number as well as the label', () => {
    expect(periodForColumnDate(on(30, 9, 2026))).toEqual({
      quarter: 2,
      fiscalYear: '27',
      label: 'Q2 FY27',
    });
  });
});

describe('conflictingQuarter', () => {
  const q1 = periodForColumnDate(on(30, 6, 2026));
  if (q1 === null) throw new Error('Q1 must be derivable for these tests');

  const HEADER = '30.06.202630.06.2025';

  /** A document with `near` a hundred characters above the column header. */
  const around = (
    near: string,
  ): { readonly text: string; readonly offset: number } => {
    const before = `${near} ${'filler '.repeat(14)}`;
    return {
      text: `${before}${HEADER} ${'tail '.repeat(40)}`,
      offset: before.length,
    };
  };

  it.each([
    ['no quarter at all', 'UNAUDITED FINANCIAL RESULTS', null],
    ['the SAME quarter', 'Q1 FY27 HIGHLIGHTS', null],
    // Comparing years would refuse every real statement: the year-ago column is
    // printed beside the current one by design.
    ['a bare fiscal year', 'FY26 COMPARATIVE', null],
    // The check the statutory argument cannot make: a filer on a non-March year
    // end who calls its own June quarter Q3.
    ['a DIFFERENT quarter', 'Q3 FY27 HIGHLIGHTS', 'Q3 FY27'],
    ['a bare different quarter', 'Q2 SUMMARY', 'Q2'],
  ])('reads %s beside the table as %s', (_label, near, expected) => {
    const { text, offset } = around(near);
    expect(conflictingQuarter(text, offset, HEADER.length, q1)).toBe(expected);
  });

  it('does not reach a quarter beyond its window', () => {
    const far = `Q3 FY27 ${'filler '.repeat(1_000)}${HEADER}`;
    expect(
      conflictingQuarter(far, far.length - HEADER.length, HEADER.length, q1),
    ).toBeNull();
  });

  it('looks a bounded distance either side, not across the document', () => {
    // Pinned against a LITERAL as well as against the measurement: a fixture
    // sized from the constant it pins passes for every value of it, including
    // one that makes the window the whole document.
    expect(PERIOD_CONFLICT_CHARS).toBe(600);
    const inside = `Q3 FY27 ${'filler '.repeat(80)}${HEADER}`;
    const offset = inside.length - HEADER.length;
    expect(offset).toBeGreaterThan(500);
    expect(offset).toBeLessThan(600);
    expect(conflictingQuarter(inside, offset, HEADER.length, q1)).toBe(
      'Q3 FY27',
    );
    // And one character of reach less finds nothing, which is what makes the
    // bound a bound rather than a decoration.
    expect(conflictingQuarter(inside, offset, HEADER.length, q1, 1)).toBeNull();
  });
});
