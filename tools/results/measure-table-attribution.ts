/**
 * Measures whether a results table on a newspaper page can be attributed to the
 * company that filed the page.
 *
 * ================================================================
 * THE QUESTION, AND WHY IT HAD TO BE ASKED BEFORE ANY CODE SHIPPED
 * ================================================================
 *
 * `results-eligibility.ts` refuses `Copy of Newspaper Publication` on the
 * category alone, and 143 of the 408 cached newspaper pages carry a statutory
 * results statement — real tables this pipeline cannot read. The proposal was a
 * TABLE-LEVEL attribution test with the same shape as `governingBasis`: the
 * filer's own name must appear within a bounded window ABOVE the table's column
 * header, and the newspaper category opens only for tables that pass.
 *
 * The error being defended against is the SANOFI one, moved from a sentence to
 * a table: a full financial statement published under the wrong company's name.
 * `shared-page.ts` already refuses a page naming four or more companies, and
 * that leaves 87 newspaper pages carrying a results statement which the CIN rule
 * lets through. Whether they can be published turns entirely on whether a window
 * exists that admits the filer's own tables and no one else's.
 *
 * ================================================================
 * WHAT IS MEASURED, AND WHAT SUPPLIES THE GROUND TRUTH
 * ================================================================
 *
 * Every column header on every cached newspaper page carrying a results
 * statement is located (`isColumnHeaderLine` — the dates and their separators
 * are nearly the whole line, so a note that happens to carry two dates is not
 * counted). For each header two distances are taken: up to the filer's own name,
 * and up to the nearest OTHER listed company's name. The second is the ground
 * truth, and it is the document's own layout rather than a label anyone typed: a
 * statutory advertisement prints the company's name as the banner directly above
 * its own table, so whichever name sits nearer above a header is whose table it
 * is. The universe of other companies is the corpus's own 1,284 distinct filer
 * names, less the exchanges and depositories every covering letter addresses.
 *
 * The sweep then reports, at each window width, how many of the filer's own
 * tables the proposed check would ADMIT and how many of another company's it
 * would MIS-ATTRIBUTE. A mis-attribution is not a missed line; it is a full
 * financial table published under the wrong company's name.
 *
 * Run:
 *   npm run attribution:measure            -- the filer's name as the exchange stores it
 *   npm run attribution:measure -- --stem  -- the same name without its corporate suffix
 *
 * Exit: non-zero when nothing could be measured, so an empty cache cannot read
 * as a clean result.
 */
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import mongoose from 'mongoose';
import { isSharedPage } from '@app/filings';
import { RESULTS_STATEMENT_PATTERN } from '@app/filings/logic/results-eligibility';
import { forStructuralTest } from '@app/filings/logic/structural-text';
import { loadConfig } from '../../apps/ingest/src/config/configuration';
import {
  columnHeadersIn,
  foldPage,
  MARKET_INFRASTRUCTURE,
  nameOffsetsIn,
  nearestAbove,
  ownerOf,
  sweep,
  withoutCorporateSuffix,
  type HeaderRow,
} from './table-attribution';

/** The same cache `measure-ambiguity-scope.ts` writes, keyed the same way. */
const CACHE_DIR = 'data/corpus/.ambiguity-scope-cache';

const cachePath = (seqId: number): string =>
  join(
    CACHE_DIR,
    `${createHash('sha256').update(String(seqId)).digest('hex').slice(0, 16)}.txt`,
  );

/**
 * The windows the sweep reports.
 *
 * Anchored on the two bounds this codebase already measured for the same shape
 * of question — 400 for `pdf-parse` output and 2,400 for Docling's — and run out
 * to 12,000 so the curve is visible past the point where it stops being a
 * candidate rather than stopping at the first disappointing number.
 */
const WINDOWS: readonly number[] = [
  200, 300, 400, 500, 600, 800, 1_000, 1_500, 2_000, 2_400, 3_000, 4_000, 6_000,
  12_000,
];

/** The recall a gate must reach before opening the category is worth doing. */
const REQUIRED_RECALL = 0.95;

interface Subject {
  readonly seqId: number;
  readonly symbol: string;
  readonly companyName: string;
  readonly category: string;
}

async function loadSubjects(): Promise<readonly Subject[]> {
  const config = loadConfig();
  await mongoose.connect(config.mongoUri);
  const db = mongoose.connection.db;
  if (db === undefined) throw new Error('no database handle');
  const rows = (await db
    .collection('filings')
    .find(
      {},
      {
        projection: {
          _id: 0,
          seqId: 1,
          symbol: 1,
          companyName: 1,
          category: 1,
        },
      },
    )
    .toArray()) as unknown as readonly Subject[];
  await mongoose.disconnect();
  return rows;
}

/** Every company on the page that is not the filer and not an exchange. */
function otherCompaniesOn(
  page: ReturnType<typeof foldPage>,
  filer: string,
  universe: readonly string[],
): readonly { readonly name: string; readonly offsets: readonly number[] }[] {
  const found: { name: string; offsets: readonly number[] }[] = [];
  for (const name of universe) {
    // A name that contains the filer's, or is contained by it, is the same
    // company under a longer or shorter spelling rather than a page-sharer.
    if (name.includes(filer) || filer.includes(name)) continue;
    const offsets = nameOffsetsIn(page, name);
    if (offsets.length > 0) found.push({ name, offsets });
  }
  return found;
}

const sorted = (values: readonly (number | null)[]): readonly number[] =>
  values
    .filter((value): value is number => value !== null)
    .sort((left, right) => left - right);

const percent = (part: number, whole: number): string =>
  whole === 0 ? 'n/a' : `${((100 * part) / whole).toFixed(1)}%`;

async function main(): Promise<void> {
  const stem = process.argv.includes('--stem');
  const needleFor = (name: string): string =>
    stem ? withoutCorporateSuffix(name) : name;

  const subjects = await loadSubjects();
  const universe = [...new Set(subjects.map((row) => row.companyName))].filter(
    (name) => !MARKET_INFRASTRUCTURE.has(name),
  );
  process.stdout.write(
    `filings: ${subjects.length}; distinct company names: ${universe.length}` +
      `${stem ? '; needle: name WITHOUT its corporate suffix' : '; needle: name as the exchange stores it'}\n`,
  );

  const newspapers = subjects.filter(
    (row) =>
      row.category.trim().toLowerCase() === 'copy of newspaper publication',
  );
  const rows: HeaderRow[] = [];
  let cached = 0;
  let withStatement = 0;
  let sharedPage = 0;
  let withHeaders = 0;
  let solePages = 0;
  let namelessPages = 0;

  for (const subject of newspapers) {
    const path = cachePath(subject.seqId);
    if (!existsSync(path)) continue;
    cached += 1;
    const text = readFileSync(path, 'utf8');
    if (!RESULTS_STATEMENT_PATTERN.test(forStructuralTest(text))) continue;
    withStatement += 1;
    if (isSharedPage(text)) sharedPage += 1;

    const headers = columnHeadersIn(text);
    if (headers.length === 0) continue;
    withHeaders += 1;

    const page = foldPage(text);
    const mine = nameOffsetsIn(page, needleFor(subject.companyName));
    if (mine.length === 0) namelessPages += 1;
    const others = otherCompaniesOn(page, subject.companyName, universe);
    if (others.length === 0) solePages += 1;

    for (const header of headers) {
      const filer = nearestAbove(mine, header.offset);
      let other: number | null = null;
      let otherName: string | null = null;
      for (const company of others) {
        const at = nearestAbove(company.offsets, header.offset);
        if (at !== null && (other === null || at > other)) {
          other = at;
          otherName = company.name;
        }
      }
      rows.push({
        symbol: subject.symbol,
        seqId: subject.seqId,
        companyName: subject.companyName,
        filerAbove: filer === null ? null : header.offset - filer,
        otherAbove: other === null ? null : header.offset - other,
        otherName,
        soleCompany: others.length === 0,
        line: header.line.replace(/\s+/g, ' ').trim().slice(0, 70),
      });
    }
  }

  process.stdout.write(
    `\n=== the population ===\n` +
      `  newspaper filings              ${newspapers.length}\n` +
      `  with text on disk              ${cached}\n` +
      `  carrying a results statement   ${withStatement}\n` +
      `    of those, refused already by the 4-CIN shared-page rule  ${sharedPage}\n` +
      `  with at least one column header ${withHeaders}\n` +
      `    naming no other listed company ${solePages}\n` +
      `    never printing the filer's own name ${namelessPages}\n` +
      `  column headers measured        ${rows.length}\n`,
  );

  if (rows.length === 0) {
    process.stderr.write(
      'nothing to measure: no cached newspaper page carries a column header. ' +
        'Populate the cache with `npm run ambiguity:measure` first.\n',
    );
    process.exitCode = 1;
    return;
  }

  const own = rows.filter((row) => ownerOf(row) === 'filer');
  const theirs = rows.filter((row) => ownerOf(row) === 'other');
  process.stdout.write(
    `\n=== whose table each header belongs to, by the page's own layout ===\n` +
      `  the filer's        ${own.length}\n` +
      `  another company's  ${theirs.length}\n` +
      `  neither names it   ${rows.length - own.length - theirs.length}\n`,
  );

  process.stdout.write(
    `\n=== THE FILER'S OWN TABLES: characters up to its own name ===\n` +
      `${sorted(own.map((row) => row.filerAbove)).join(', ')}\n`,
  );
  process.stdout.write(
    `\n=== ANOTHER COMPANY'S TABLES: characters up to the FILER's name ===\n` +
      `${sorted(theirs.map((row) => row.filerAbove)).join(', ')}\n` +
      `  (the filer's name is nowhere above: ` +
      `${theirs.filter((row) => row.filerAbove === null).length})\n`,
  );

  const points = sweep(rows, WINDOWS);
  process.stdout.write(
    '\n=== the sweep: what a window would admit ===\n' +
      "  window    the filer's own tables      ANOTHER COMPANY'S TABLES\n",
  );
  for (const point of points) {
    process.stdout.write(
      `  ${String(point.window).padStart(6)}    ` +
        `${String(point.admitted).padStart(3)}/${point.ownTotal} ` +
        `(${percent(point.admitted, point.ownTotal)})`.padEnd(16) +
        `    ${String(point.misattributed).padStart(3)}/${point.otherTotal} ` +
        `(${percent(point.misattributed, point.otherTotal)})\n`,
    );
  }

  // ---- the verdict, computed rather than asserted -------------------------
  const clean = points.filter((point) => point.misattributed === 0);
  const widestClean = clean[clean.length - 1];
  const usable = points.find(
    (point) => point.admitted >= REQUIRED_RECALL * point.ownTotal,
  );

  process.stdout.write('\n=== verdict ===\n');
  process.stdout.write(
    widestClean === undefined
      ? '  NO window mis-attributes nothing. Every width measured publishes at ' +
          "least one of another company's tables.\n"
      : `  widest window that mis-attributes NOTHING: ${widestClean.window}, ` +
          `and it admits ${widestClean.admitted}/${widestClean.ownTotal} ` +
          `(${percent(widestClean.admitted, widestClean.ownTotal)}) of the ` +
          "filer's own tables.\n",
  );
  process.stdout.write(
    usable === undefined
      ? `  NO window reaches ${(100 * REQUIRED_RECALL).toFixed(0)}% of the ` +
          "filer's own tables, up to " +
          `${WINDOWS[WINDOWS.length - 1]} characters.\n`
      : `  narrowest window reaching ${(100 * REQUIRED_RECALL).toFixed(0)}%: ` +
          `${usable.window}, and it mis-attributes ${usable.misattributed}/` +
          `${usable.otherTotal} (${percent(usable.misattributed, usable.otherTotal)}).\n`,
  );

  const shippable =
    usable !== undefined && usable.misattributed === 0 ? 'SHIP' : 'DO NOT SHIP';
  process.stdout.write(
    `  ${shippable}: the gate opens only on a window that reaches ` +
      `${(100 * REQUIRED_RECALL).toFixed(0)}% recall with zero mis-attribution.\n`,
  );

  process.stdout.write(
    "\n=== every table the check would publish under the wrong company's name, " +
      'at the tightest windows ===\n',
  );
  const leaks = theirs
    .filter((row) => row.filerAbove !== null && row.filerAbove <= 1_000)
    .sort((left, right) => (left.filerAbove ?? 0) - (right.filerAbove ?? 0));
  for (const row of leaks) {
    process.stdout.write(
      `  ${row.symbol.padEnd(11)} seq ${row.seqId}  ` +
        `filer ${String(row.filerAbove).padStart(5)} above, ` +
        `owner ${String(row.otherAbove).padStart(5)} above ` +
        `("${row.otherName}")  | ${row.line}\n`,
    );
  }
  if (leaks.length === 0) {
    process.stdout.write('  none within 1,000 characters.\n');
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `measurement failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
