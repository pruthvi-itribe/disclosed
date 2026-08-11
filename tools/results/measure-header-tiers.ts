/**
 * Measures how a results table's column identity is spread over its header
 * rows, and what the gate reads out of it.
 *
 * WHY THIS EXISTS. `results-verify.ts` reads ONE quoted line as the column
 * header. Docling emits a statement as a markdown table, and a markdown table
 * has exactly one header row — so when the printed statement stacks a grouping
 * tier (`Quarter ended` / `Year ended`, or just the scale) above the row of
 * dates, Docling puts the grouping tier in the header row and the dates in the
 * first BODY row. A model told to quote "the line of column period-end dates at
 * the head of that table" then has two lines to choose from and the gate accepts
 * only one of them.
 *
 * Three different documents produce the same family of refusals and they want
 * three different fixes, so this tool names which one each table is:
 *
 *   1. **A stacked header.** The head row carries no date and the row under it
 *      carries all of them. Merging the tiers before alignment fixes it.
 *   2. **A date spelling `columnDatesIn` does not read.** `31.3.2026` (one-digit
 *      month) and `30June 2026` (no space) are dates a human reads and the
 *      regexes do not, so a four-column header parses as two. No column model
 *      can fix that; the fix is in `results-tokens.ts`.
 *   3. **Two statement rows Docling merged onto one markdown line.** The row
 *      states 2x the values and no header can match it. Not fixable from the
 *      header end at all.
 *
 * IT RE-CONVERTS rather than trusting a stored reading, for the reason
 * `measure-basis-reach.ts` gives: text a different parser produced is not
 * evidence about this one. Every conversion's character count is checked against
 * the `documentChars` the filing already carries, and a document that comes back
 * a different length is reported and dropped from the counts rather than quietly
 * analysed.
 *
 * It makes NO model calls and writes NOTHING to the collection. Conversions run
 * one at a time with a pause between them because `docling-serve` holds one
 * engine worker and is shared with the live enrichment workers.
 *
 * Usage:
 *   npm run tiers:measure -- --dump DIR [--limit N] [--pause-ms N] [--seq A,B]
 *   npm run tiers:measure -- --from-dir DIR      (re-analyse, no conversions)
 */
import 'dotenv/config';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import mongoose from 'mongoose';
import {
  AttachmentFetcher,
  columnDatesIn,
  decideAttachment,
  extractPdfText,
  FilingSchema,
  readWithRouting,
  valueTokensIn,
  type FilingDocument,
} from '@app/filings';
import { buildDoclingConverter } from '../../apps/ingest/src/enrichment/docling.factory';
import { loadConfig } from '../../apps/ingest/src/config/configuration';

/** One markdown table's rows, in document order, separator rows dropped. */
interface MarkdownTable {
  readonly rows: readonly string[];
}

const isTableLine = (line: string): boolean => line.trimStart().startsWith('|');
const isSeparator = (line: string): boolean =>
  /^\s*\|[\s|:-]+\|\s*$/.test(line);

/** Every run of consecutive pipe lines, which is what Docling emits a table as. */
function tablesIn(text: string): readonly MarkdownTable[] {
  const tables: MarkdownTable[] = [];
  let rows: string[] = [];
  for (const line of text.split('\n')) {
    if (isTableLine(line)) {
      if (!isSeparator(line)) rows.push(line);
    } else if (rows.length > 0) {
      tables.push({ rows });
      rows = [];
    }
  }
  if (rows.length > 0) tables.push({ rows });
  return tables;
}

const cellsOf = (row: string): readonly string[] =>
  row
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.trim());

/**
 * The most common non-zero value count across a table's rows.
 *
 * THE TABLE'S REAL COLUMN COUNT, and the only reading of it that survives
 * Docling's damage: one row may be two rows merged and another a subtotal with
 * a blank cell, but a statement's twenty ordinary rows all state the same
 * number of values.
 */
function dataArity(rows: readonly string[]): number {
  const counts = new Map<number, number>();
  for (const row of rows) {
    const values = valueTokensIn(row).length;
    if (values === 0) continue;
    counts.set(values, (counts.get(values) ?? 0) + 1);
  }
  let best = 0;
  let bestSeen = 0;
  for (const [count, seen] of counts) {
    if (seen > bestSeen || (seen === bestSeen && count > best)) {
      best = count;
      bestSeen = seen;
    }
  }
  return best;
}

/**
 * A cell naming a period end that `columnDatesIn` cannot read.
 *
 * WIDER THAN THE PARSER ON PURPOSE. `results-tokens.ts` accepts
 * `30.06.2026`, `30/06/2026`, `30-06-2026`, `June 30, 2026` and `30 June 2026`
 * and nothing else; this matches everything a human reads as a date so the
 * difference between the two is countable. Every hit is a column the document
 * names and the gate cannot.
 */
const MONTH_NAMES =
  'jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|june|july|sept';
const UNREAD_DATE = new RegExp(
  [
    // `31.3.2026`, `30.6.25` — a one-digit day or month, or a two-digit year.
    String.raw`\d{1,2}\s*[./-]\s*\d{1,2}\s*[./-]\s*\d{2,4}`,
    // `30-Jun-26`, `30/Jun/2026` — a month name between separators.
    String.raw`\d{1,2}\s*[./-]\s*(?:${MONTH_NAMES})[a-z]*\s*[./-]\s*\d{2,4}`,
    // `30June 2026` — no space between the day and the month name.
    String.raw`\d{1,2}(?:${MONTH_NAMES})[a-z]*\.?,?\s*\d{2,4}`,
    // `Jun-26`, `March 2026` — a month and a year with no day at all.
    String.raw`(?:${MONTH_NAMES})[a-z]*\s*[-/]?\s*\d{2,4}`,
  ].join('|'),
  'i',
);
const UNREAD_DATE_ALL = new RegExp(UNREAD_DATE.source, 'gi');

/**
 * Which fix, if any, this table's header would take.
 *
 * ORDERED, and the order is the finding: a tier merge is credited only when
 * merging the head row with the date row under it is what closes the gap. A
 * header whose own cells already name every column and whose dates the parser
 * simply failed to read is a spelling miss, and counting it as a tier would
 * overstate what a column model can do.
 */
type Cause =
  | 'aligned-head'
  | 'stacked-head-datefree'
  | 'stacked-head-dated'
  | 'date-spelling'
  | 'dates-unreadable'
  | 'row-merge'
  | 'no-dates-anywhere'
  | 'unexplained';

interface TableReading {
  readonly cause: Cause;
  readonly rowCount: number;
  readonly arity: number;
  /** Dates parsed out of the markdown header row on its own. */
  readonly headDates: number;
  /** Index of the first row parsing two or more dates, or -1. */
  readonly dateRow: number;
  /** Dates parsed out of every row from the head down to the date row. */
  readonly mergedDates: number;
  /** Header-block cells naming a period the parser cannot read. */
  readonly unreadCells: number;
  /** Those cells' date-like text, so the spellings can be counted. */
  readonly unread: readonly string[];
  readonly headLine: string;
  readonly dateLine: string;
}

function readTable(table: MarkdownTable): TableReading {
  const arity = dataArity(table.rows);
  const headDates = columnDatesIn(table.rows[0]).length;
  const dateRow = table.rows.findIndex((row) => columnDatesIn(row).length >= 2);
  const merged =
    dateRow < 0
      ? 0
      : columnDatesIn(table.rows.slice(0, dateRow + 1).join('\n')).length;
  // The header BLOCK, not just the head row: a table whose dates are one row
  // down still has its column identity there, and a table with no readable
  // date row has it nowhere the parser looks.
  const block = table.rows.slice(0, Math.max(1, dateRow < 0 ? 3 : dateRow + 1));
  const unread = block
    .flatMap((row) => cellsOf(row))
    .filter(
      (cell) => UNREAD_DATE.test(cell) && columnDatesIn(cell).length === 0,
    )
    .flatMap((cell) => cell.match(UNREAD_DATE_ALL) ?? []);
  const unreadCells = unread.length;

  const shorten = (row: string | undefined): string =>
    (row ?? '').replace(/\s+/g, ' ').slice(0, 150);

  const cause = ((): Cause => {
    if (dateRow < 0) {
      return unreadCells >= 2 ? 'dates-unreadable' : 'no-dates-anywhere';
    }
    if (dateRow === 0)
      return headDates === arity
        ? 'aligned-head'
        : headDates + unreadCells === arity
          ? 'date-spelling'
          : arity % Math.max(1, headDates) === 0
            ? 'row-merge'
            : 'unexplained';
    // The date row is BELOW the head. Whether a merge is safe turns on whether
    // the head contributes dates of its own: a head that contributes none
    // cannot reorder the composite, and one that does is two date sources this
    // pipeline has no rule for.
    if (headDates > 0) return 'stacked-head-dated';
    return merged === arity ? 'stacked-head-datefree' : 'unexplained';
  })();

  return {
    cause,
    rowCount: table.rows.length,
    arity,
    headDates,
    dateRow,
    mergedDates: merged,
    unreadCells,
    unread,
    headLine: shorten(table.rows[0]),
    dateLine: shorten(dateRow < 0 ? undefined : table.rows[dateRow]),
  };
}

/**
 * Statements only.
 *
 * Six rows and two value columns. A director-appointment table — which every
 * `Outcome of Board Meeting` filing also carries — has one value column at
 * most, and counting its header against this would drown the signal.
 */
const isStatement = (reading: TableReading): boolean =>
  reading.rowCount >= 6 && reading.arity >= 2;

interface Filing {
  readonly seqId: number;
  readonly symbol: string;
  readonly category: string;
  readonly attachmentUrl: string | null;
  readonly storedChars: number | null;
  readonly storedRoute: string | null;
  readonly refusal: string | null;
  readonly notAligned: number;
}

const argValue = (name: string): string | null => {
  const at = process.argv.indexOf(name);
  return at < 0 || at + 1 >= process.argv.length ? null : process.argv[at + 1];
};

/**
 * Prints one document's tables, folds them into the running counts, and says
 * whether any statement in it has a stacked header.
 */
function report(
  filing: Filing,
  text: string,
  causes: Map<Cause, number>,
  byFiling: Map<Cause, Set<number>>,
  depths: Map<number, number>,
  spellings: Map<string, number>,
): boolean {
  let stacked = false;
  process.stdout.write(
    `\n=== ${filing.seqId} ${filing.symbol} ${text.length} chars, ` +
      `refusal=${filing.refusal ?? 'none'}, ` +
      `columns-not-aligned=${filing.notAligned} ===\n`,
  );
  for (const reading of tablesIn(text).map(readTable).filter(isStatement)) {
    for (const spelling of reading.unread) {
      const key = spelling.replace(/\d/g, '9').toLowerCase();
      spellings.set(key, (spellings.get(key) ?? 0) + 1);
    }
    if (reading.cause === 'stacked-head-datefree') {
      stacked = true;
      depths.set(reading.dateRow, (depths.get(reading.dateRow) ?? 0) + 1);
    }
    causes.set(reading.cause, (causes.get(reading.cause) ?? 0) + 1);
    const seen = byFiling.get(reading.cause) ?? new Set<number>();
    seen.add(filing.seqId);
    byFiling.set(reading.cause, seen);
    process.stdout.write(
      `  ${reading.cause.padEnd(22)} rows=${String(reading.rowCount).padStart(3)} ` +
        `arity=${reading.arity} headDates=${reading.headDates} ` +
        `dateRow=${reading.dateRow} mergedDates=${reading.mergedDates} ` +
        `unreadCells=${reading.unreadCells}\n` +
        `      head: ${reading.headLine}\n` +
        `      date: ${reading.dateLine}\n`,
    );
  }
  return stacked;
}

/**
 * The cross-tab the decision turns on: of the filings the results lane refused,
 * how many carry a statement whose header is stacked.
 *
 * A STRUCTURAL COUNT AND NOT A PROMISE. It says the shape that produces the
 * refusal is present in the document, not that the extractor quoted that
 * particular row — nothing stores the quoted `columnsSpan` of a refused filing.
 * `npm run results:prove` is what settles one filing end to end.
 */
function crossTab(
  refusals: Map<string, { readonly total: number; readonly stacked: number }>,
): void {
  process.stdout.write(
    '\nrefusal                   filings  with a stacked head\n',
  );
  for (const [reason, counts] of [...refusals.entries()].sort(
    (left, right) => right[1].total - left[1].total,
  )) {
    process.stdout.write(
      `  ${reason.padEnd(24)} ${String(counts.total).padStart(4)}  ` +
        `${String(counts.stacked).padStart(4)}\n`,
    );
  }
}

function summarise(
  selected: number,
  converted: number,
  charMismatch: number,
  unreadable: number,
  causes: Map<Cause, number>,
  byFiling: Map<Cause, Set<number>>,
  depths: Map<number, number>,
  spellings: Map<string, number>,
): void {
  process.stdout.write(
    `\n\n================ SWEEP ================\n` +
      `selected=${selected} analysed=${converted} ` +
      `charMismatch=${charMismatch} unreadable=${unreadable}\n\n` +
      `cause                     tables  filings\n`,
  );
  for (const [cause, count] of [...causes.entries()].sort(
    (left, right) => right[1] - left[1],
  )) {
    process.stdout.write(
      `  ${cause.padEnd(24)} ${String(count).padStart(4)}  ` +
        `${String(byFiling.get(cause)?.size ?? 0).padStart(4)}\n`,
    );
  }
  for (const cause of [
    'stacked-head-datefree',
    'stacked-head-dated',
  ] as const) {
    process.stdout.write(
      `\n--- ${cause} filings ---\n` +
        `${[...(byFiling.get(cause) ?? [])].join(' ')}\n`,
    );
  }
  // HOW DEEP THE DATE ROW SITS, so the bound the merge uses is read off a
  // distribution instead of chosen. A grouping tier is one or two rows; a date
  // row ten rows down is a different table that happens to print two dates.
  // THE SPELLINGS THE PARSER CANNOT READ, digits masked so `30-Jun-26` and
  // `31-Mar-26` count as one shape. Every one of these is a column the document
  // names and `columnDatesIn` returns nothing for.
  process.stdout.write('\n--- date shapes the parser cannot read ---\n');
  for (const [shape, count] of [...spellings.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 15)) {
    process.stdout.write(`  ${shape.padEnd(28)} ${count}\n`);
  }
  process.stdout.write('\n--- rows between the head and the date row ---\n');
  for (const [depth, count] of [...depths.entries()].sort(
    (left, right) => left[0] - right[0],
  )) {
    process.stdout.write(`  dateRow=${depth}  ${count}\n`);
  }
}

const main = async (): Promise<void> => {
  const fromDir = argValue('--from-dir');
  const limit = Number(argValue('--limit') ?? '0');
  const pauseMs = Number(argValue('--pause-ms') ?? '1500');
  const only = (argValue('--seq') ?? '')
    .split(',')
    .map(Number)
    .filter((value) => Number.isInteger(value) && value > 0);
  const dump = argValue('--dump');
  if (dump !== null) mkdirSync(dump, { recursive: true });

  const config = loadConfig();
  await mongoose.connect(config.mongoUri);
  const model = mongoose.model<FilingDocument>('Filing', FilingSchema);

  const cached =
    fromDir === null
      ? []
      : readdirSync(fromDir)
          .filter((name) => name.endsWith('.md'))
          .map((name) => Number(name.replace('.md', '')));
  const query =
    cached.length > 0
      ? { seqId: { $in: cached } }
      : only.length > 0
        ? { seqId: { $in: only } }
        : {
            'enrichment.parseRoute': 'docling-layout',
            'enrichment.resultsProposed': { $gt: 0 },
          };
  const found = await model
    .find(query, {
      _id: 0,
      seqId: 1,
      symbol: 1,
      category: 1,
      attachmentUrl: 1,
      enrichment: 1,
    })
    .sort({ seqId: 1 })
    .lean()
    .exec();

  const selected: Filing[] = found.map((filing) => ({
    seqId: filing.seqId,
    symbol: filing.symbol,
    category: filing.category,
    attachmentUrl: filing.attachmentUrl ?? null,
    storedChars: filing.enrichment?.documentChars ?? null,
    storedRoute: filing.enrichment?.parseRoute ?? null,
    refusal: filing.enrichment?.resultsRefusalReason ?? null,
    notAligned: (filing.enrichment?.resultsDiscards ?? []).filter(
      (each) => each.reason === 'columns-not-aligned',
    ).length,
  }));
  const work = limit > 0 ? selected.slice(0, limit) : selected;

  const causes = new Map<Cause, number>();
  const byFiling = new Map<Cause, Set<number>>();
  const depths = new Map<number, number>();
  const spellings = new Map<string, number>();
  const refusals = new Map<string, { total: number; stacked: number }>();
  const countRefusal = (filing: Filing, stacked: boolean): void => {
    const key = filing.refusal ?? 'published';
    const counts = refusals.get(key) ?? { total: 0, stacked: 0 };
    counts.total += 1;
    if (stacked) counts.stacked += 1;
    refusals.set(key, counts);
  };
  let analysed = 0;
  let charMismatch = 0;
  let unreadable = 0;

  if (fromDir !== null) {
    for (const filing of work) {
      const text = readFileSync(join(fromDir, `${filing.seqId}.md`), 'utf8');
      countRefusal(
        filing,
        report(filing, text, causes, byFiling, depths, spellings),
      );
      analysed += 1;
    }
    summarise(work.length, analysed, 0, 0, causes, byFiling, depths, spellings);
    crossTab(refusals);
    await mongoose.disconnect();
    return;
  }

  const converter = buildDoclingConverter(config);
  const fetcher = new AttachmentFetcher(config.enrichmentMaxBytes);
  for (const filing of work) {
    const decision = decideAttachment(filing.attachmentUrl);
    if (decision.outcome === 'skip') {
      unreadable += 1;
      continue;
    }
    const fetched = await fetcher.fetch(decision.url);
    if (fetched.outcome !== 'ok') {
      process.stdout.write(`${filing.seqId} FETCH ${fetched.outcome}\n`);
      unreadable += 1;
      continue;
    }
    const parsed = await extractPdfText(fetched.body);
    if (parsed.outcome !== 'ok') {
      process.stdout.write(`${filing.seqId} PARSE failed\n`);
      unreadable += 1;
      continue;
    }
    const routed = await readWithRouting({
      category: filing.category,
      data: fetched.body,
      fileName: `${filing.seqId}.pdf`,
      text: parsed.text,
      pages: parsed.pages,
      converter,
    });
    await new Promise((resolve) => setTimeout(resolve, pauseMs));

    // THE CHECK THAT MAKES THIS A MEASUREMENT OF WHAT THE GATE SAW. A different
    // character count is a different document; it is reported and dropped.
    if (
      routed.route !== filing.storedRoute ||
      routed.text.length !== filing.storedChars
    ) {
      process.stdout.write(
        `${filing.seqId} ${filing.symbol} MISMATCH stored=` +
          `${filing.storedRoute}/${filing.storedChars} now=` +
          `${routed.route}/${routed.text.length}\n`,
      );
      charMismatch += 1;
      continue;
    }
    analysed += 1;
    if (dump !== null) {
      writeFileSync(join(dump, `${filing.seqId}.md`), routed.text);
    }
    countRefusal(
      filing,
      report(filing, routed.text, causes, byFiling, depths, spellings),
    );
  }

  summarise(
    work.length,
    analysed,
    charMismatch,
    unreadable,
    causes,
    byFiling,
    depths,
    spellings,
  );
  crossTab(refusals);
  await mongoose.disconnect();
};

void main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
