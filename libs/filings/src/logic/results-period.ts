import { periodLabelsIn } from './claim-period';
import type { ColumnDate } from './results-tokens';

/**
 * Turning a quoted column date into the quarter a wire reader recognises.
 *
 * ================================================================
 * WHY A DERIVATION IS ALLOWED HERE AT ALL
 * ================================================================
 *
 * This pipeline refuses arithmetic on a filer's figures — `₹10,000 Cr` never
 * becomes `100 billion`, because that is a calculation the document did not
 * perform and a wrong one is unrecoverable. So a derived `Q1 FY27` needs its own
 * justification, and it is a different one:
 *
 *   - **The input is quoted.** `30.06.2026` is read out of a column header that
 *     has already been matched character for character against the document, and
 *     the header is stored beside the line as evidence.
 *   - **The mapping is statutory, not arithmetic.** Section 2(41) of the
 *     Companies Act 2013 requires an Indian company's financial year to end on
 *     31 March. A quarter ended 30 June is therefore the first quarter of the
 *     year ending 31 March 2027, for every company this pipeline reads. It is a
 *     calendar fact about the date, not a computation over the numbers.
 *   - **It fails closed.** A period end that is not one of the four statutory
 *     quarter ends yields nothing and the whole results block is refused. The
 *     narrow exception the Act allows — a subsidiary of a foreign holding
 *     company permitted a different year end — lands there rather than being
 *     labelled wrongly.
 *
 * ================================================================
 * AND IT IS CROSS-CHECKED AGAINST THE DOCUMENT'S OWN WORDS
 * ================================================================
 *
 * `conflictingQuarter` looks for a period label the filing prints beside the
 * table — `Q1`, `Q1 FY27`, the shapes `claim-period.ts` already recognises — and
 * refuses when its QUARTER NUMBER disagrees with the one derived from the date.
 * That is the check that catches the case the statutory argument cannot: a filer
 * on a non-March year end who labels its own June quarter Q3.
 *
 * Only the quarter number is compared, never the year. A results table states
 * the prior year's column beside the current one, so `FY26` sitting next to a
 * `Q1 FY27` table is the table working correctly rather than a contradiction.
 */

/** The four statutory quarter ends, and which quarter each one closes. */
const QUARTER_ENDS: readonly {
  readonly month: number;
  readonly day: number;
  readonly quarter: 1 | 2 | 3 | 4;
  /** Whether the financial year ends in the NEXT calendar year. */
  readonly nextYear: boolean;
}[] = [
  { month: 6, day: 30, quarter: 1, nextYear: true },
  { month: 9, day: 30, quarter: 2, nextYear: true },
  { month: 12, day: 31, quarter: 3, nextYear: true },
  { month: 3, day: 31, quarter: 4, nextYear: false },
];

/** A period end resolved into the label a desk reads. */
export interface ResultsPeriod {
  /** 1-4. */
  readonly quarter: number;
  /** The two-digit year the financial year ENDS in. `27` for FY 2026-27. */
  readonly fiscalYear: string;
  /** `Q1 FY27`. */
  readonly label: string;
}

/**
 * The quarter a period-end date closes, or null when it closes none.
 *
 * NEVER THROWS and never guesses. Null is returned for 31 January, for
 * 29 June, and for anything else that is not a statutory quarter end — and the
 * caller refuses the whole results block on it.
 */
export function periodForColumnDate(date: ColumnDate): ResultsPeriod | null {
  const end = QUARTER_ENDS.find(
    (candidate) => candidate.month === date.month && candidate.day === date.day,
  );
  if (end === undefined) return null;

  const fiscalYearEnd = end.nextYear ? date.year + 1 : date.year;
  const fiscalYear = String(fiscalYearEnd).slice(-2);
  return {
    quarter: end.quarter,
    fiscalYear,
    label: `Q${end.quarter} FY${fiscalYear}`,
  };
}

/** How far either side of the column header a contradicting label is looked for. */
export const PERIOD_CONFLICT_CHARS = 600;

/**
 * A quarter the document states beside the table that is not the derived one.
 *
 * Returns the offending label so the refusal can quote it. Null — the ordinary
 * answer — means the neighbourhood states no quarter at all, or states this one.
 *
 * NEVER THROWS.
 */
export function conflictingQuarter(
  documentText: string,
  headerOffset: number,
  headerLength: number,
  derived: ResultsPeriod,
  reach: number = PERIOD_CONFLICT_CHARS,
): string | null {
  const from = Math.max(0, headerOffset - reach);
  const to = Math.min(documentText.length, headerOffset + headerLength + reach);
  const window = documentText.slice(from, to);

  for (const label of periodLabelsIn(window)) {
    const quarter = /^Q([1-4])/i.exec(label.canonical);
    if (quarter === null) continue;
    if (Number(quarter[1]) !== derived.quarter) return label.raw.trim();
  }
  return null;
}
