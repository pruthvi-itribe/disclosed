/**
 * The pure half of the newspaper-page attribution measurement.
 *
 * Separated from the runner so the rules it depends on — what counts as a
 * column header, what counts as a company's name being written — are testable
 * without a database or a corpus on disk. `measure-table-attribution.ts` is the
 * script; this is what it measures with.
 *
 * NOTHING HERE IS ON THE PUBLISHING PATH. It lives in `tools/` rather than in
 * `libs/filings` because the measurement it exists for concluded that the
 * mechanism must not ship — see `results-eligibility.ts`. A module the pipeline
 * does not call does not belong in the library the pipeline is built from.
 */
import { ALL_REPAIRS, canonicalise, columnDatesIn } from '@app/filings';

/**
 * A document projected into the form a company name is matched in, plus the map
 * back to the original offsets.
 *
 * `canonicalise` with every repair on is what `claim-span.ts` compares a quoted
 * sentence in, and it is reused rather than re-derived for one reason: on a
 * newspaper page `pdf-parse` welds words together, and the filer's banner
 * arrives as `ForWonderlaHolidaysLimited`. A matcher that treats spaces as
 * significant answers "the name is not on the page" about a page that prints it
 * in 24-point type.
 *
 * ON TOP OF IT, AND ONLY HERE, CASE IS FOLDED. `claim-span.ts` deliberately
 * does not fold case, because "no" and "No" are different words in a
 * disclosure. A company's NAME is not a word in a disclosure: a statutory
 * advertisement sets it in capitals and the exchange stores it in title case,
 * and `SANOFI INDIA LIMITED` is the same company as `Sanofi India Limited`. The
 * folding is per-character with the origin index replicated, so a character
 * whose upper case is two characters cannot slide the map.
 */
export interface FoldedPage {
  readonly text: string;
  /** `origin[i]` is the index in the SOURCE of the character that produced `text[i]`. */
  readonly origin: readonly number[];
}

export function foldPage(source: string): FoldedPage {
  const canonical = canonicalise(source, ALL_REPAIRS);
  const characters: string[] = [];
  const origin: number[] = [];
  for (let index = 0; index < canonical.text.length; index += 1) {
    for (const character of canonical.text[index].toUpperCase()) {
      characters.push(character);
      origin.push(canonical.origin[index]);
    }
  }
  return { text: characters.join(''), origin };
}

/**
 * Every offset in the ORIGINAL text at which a company's name is written.
 *
 * All of them rather than the first, which is the whole difference between this
 * and `findVerbatimSpan`: a newspaper page prints the filer's name in its
 * covering letter, again as its own banner, and again in the signature under
 * its own table, and which occurrence is nearest a given table is the question
 * being asked.
 */
export function nameOffsetsIn(
  page: FoldedPage,
  name: string,
): readonly number[] {
  const needle = foldPage(name).text;
  if (needle.length === 0) return [];
  const offsets: number[] = [];
  let at = page.text.indexOf(needle);
  while (at !== -1) {
    offsets.push(page.origin[at]);
    at = page.text.indexOf(needle, at + 1);
  }
  return offsets;
}

/**
 * The name without the corporate suffix the exchange stores it with.
 *
 * A SECOND, LOOSER NEEDLE the runner can be asked for, because the first
 * question anyone asks of a disappointing recall is whether the matcher missed
 * a banner that reads `STERLING TOOLS LTD` against a stored `Sterling Tools
 * Limited`. Measuring with it answers that instead of arguing about it.
 */
export const withoutCorporateSuffix = (name: string): string =>
  name.replace(/[,.]?\s*(?:Private\s+)?(?:Limited|Ltd\.?)\s*$/i, '').trim();

/**
 * Whether a line is a table's column header rather than prose carrying dates.
 *
 * THE DISTINCTION THAT MAKES THE MEASUREMENT MEAN ANYTHING, and the same one
 * `measure-basis-reach.ts` draws with its `tableRow` flag. A note reading "the
 * figures for the quarter ended March 31, 2026 are the balancing figures
 * between the audited figures..." carries two column dates and is not a header;
 * pairing it with a company name measures nothing.
 *
 * Under Docling a header is a markdown table row and the pipe says so. This
 * corpus is `pdf-parse` output, which has no pipes, so the test is that the
 * dates and their separators are nearly the whole line: at most
 * `MAX_HEADER_LETTERS` letters survive removing the dates. That admits
 * `30.06.2026 31.03.2026 30.06.2025` and the flattened `No. o 30-06-2026 |
 * 31-03-2026 | 30-06-2025` and rejects a sentence.
 */
export const MAX_HEADER_LETTERS = 24;
export const MAX_HEADER_CHARS = 240;

export function isColumnHeaderLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_HEADER_CHARS) return false;
  const dates = columnDatesIn(trimmed);
  if (dates.length < 2) return false;
  let remainder = trimmed;
  for (const date of dates) remainder = remainder.replace(date.raw, ' ');
  return remainder.replace(/[^A-Za-z]/g, '').length <= MAX_HEADER_LETTERS;
}

/** One column header, and where it starts in the document. */
export interface ColumnHeader {
  readonly offset: number;
  readonly line: string;
}

export function columnHeadersIn(text: string): readonly ColumnHeader[] {
  const headers: ColumnHeader[] = [];
  let at = 0;
  for (const line of text.split('\n')) {
    if (isColumnHeaderLine(line)) headers.push({ offset: at, line });
    at += line.length + 1;
  }
  return headers;
}

/** The nearest offset at or above `at`, or null when there is none. */
export function nearestAbove(
  offsets: readonly number[],
  at: number,
): number | null {
  let nearest: number | null = null;
  for (const offset of offsets) {
    if (offset <= at && (nearest === null || offset > nearest))
      nearest = offset;
  }
  return nearest;
}

/**
 * Market infrastructure, which every covering letter addresses by name.
 *
 * `BSE Limited` and the two depositories are themselves listed companies and so
 * appear in the corpus's own list of filers. Counting them as another company
 * sharing the page would make every page in the collection a shared one and the
 * measurement would answer a question nobody asked. They are addressees, not
 * advertisers: none of the pages measured carries a results table under one of
 * these names.
 */
export const MARKET_INFRASTRUCTURE: ReadonlySet<string> = new Set([
  'BSE Limited',
  'National Stock Exchange of India Limited',
  'Central Depository Services (India) Limited',
  'National Securities Depository Limited',
  'Metropolitan Stock Exchange of India Limited',
]);

/**
 * One column header on one page, with the two distances the question turns on.
 *
 * `filerAbove` is what the proposed check would measure. `otherAbove` is the
 * nearest OTHER listed company's name above the same header, and it is the
 * ground truth: on a statutory advertisement the name directly above a table is
 * the banner of the company whose table it is.
 */
export interface HeaderRow {
  readonly symbol: string;
  readonly seqId: number;
  readonly companyName: string;
  /** Distance from the header up to the filer's own name, or null. */
  readonly filerAbove: number | null;
  /** Distance up to the nearest other listed company's name, or null. */
  readonly otherAbove: number | null;
  readonly otherName: string | null;
  /** True when no other listed company is named anywhere on the page. */
  readonly soleCompany: boolean;
  readonly line: string;
}

/** Whose table the document's own layout says this is. */
export type Owner = 'filer' | 'other' | 'neither';

export function ownerOf(row: HeaderRow): Owner {
  if (row.soleCompany) return row.filerAbove === null ? 'neither' : 'filer';
  if (row.filerAbove === null && row.otherAbove === null) return 'neither';
  if (row.otherAbove === null) return 'filer';
  if (row.filerAbove === null) return 'other';
  return row.filerAbove < row.otherAbove ? 'filer' : 'other';
}

/** What the proposed check would do at one window width. */
export interface SweepPoint {
  readonly window: number;
  /** The filer's own tables the check would admit. */
  readonly admitted: number;
  readonly ownTotal: number;
  /** ANOTHER COMPANY'S tables the check would admit. Every one is a wrong number. */
  readonly misattributed: number;
  readonly otherTotal: number;
}

export function sweep(
  rows: readonly HeaderRow[],
  windows: readonly number[],
): readonly SweepPoint[] {
  const own = rows.filter((row) => ownerOf(row) === 'filer');
  const other = rows.filter((row) => ownerOf(row) === 'other');
  const within = (row: HeaderRow, window: number): boolean =>
    row.filerAbove !== null && row.filerAbove <= window;
  return windows.map((window) => ({
    window,
    admitted: own.filter((row) => within(row, window)).length,
    ownTotal: own.length,
    misattributed: other.filter((row) => within(row, window)).length,
    otherTotal: other.length,
  }));
}
