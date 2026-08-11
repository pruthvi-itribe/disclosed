/**
 * Measures the results lane's largest remaining refusal class: a column header
 * whose columns are FISCAL LABELS rather than dates.
 *
 * WHY THIS EXISTS. `results-verify.ts` identifies a column by the period-end
 * date printed above it, and refuses `period-not-derivable` when the quoted
 * header states fewer than two. A press release does not print dates there. It
 * prints
 *
 *     | Particulars | Q1FY27 | Q1FY26 | YoY% |
 *
 * which names the same two periods a statutory statement names with
 * `30.06.2026` and `30.06.2025`, in the notation a desk actually reads.
 *
 * MAPPING A LABEL TO A PERIOD END ASSUMES AN APRIL-MARCH FINANCIAL YEAR, and
 * that assumption is the whole risk. Section 2(41) of the Companies Act 2013
 * requires it, but the Act's own exception — a subsidiary of a foreign holding
 * company permitted to follow its parent's year — makes `Q1 FY27` name a
 * DIFFERENT quarter for a December-year-end filer. A right figure under a wrong
 * period end is this pipeline's worst failure, so the proposal is that a label
 * is read ONLY when the same document independently prints the period end it
 * implies. This tool measures whether such corroboration is actually there.
 *
 * ================================================================
 * WHAT IT FOUND, AND WHY NOTHING WAS BUILT ON TOP OF IT
 * ================================================================
 *
 * MEASURED over the 137 char-verified Docling conversions of the `npm run
 * tiers:measure` sweep, of which 43 are refused `period-not-derivable`:
 *
 *     carry a fiscal-label header               10 of 43
 *     a label the document corroborates          9
 *     ... some row states as many values as
 *         the header states labels, and two
 *         labels are a year-on-year pair         7
 *     ... but no statement heading above it      4
 *     ... but no scale declared near it          5
 *     ... clears every stage and publishes       1   (106730137 IRMENERGY)
 *
 * ONE FILING. The header is not what is holding these back. A press release
 * prints its summary table under `Consolidated Financial Highlights`, not under
 * `Statement of Unaudited Consolidated Financial Results` — so `results-basis.ts`,
 * which requires a basis word within 40 characters of the word `result`, finds
 * nothing above it and refuses the block whatever the columns say. Reading the
 * labels would move four filings from `period-not-derivable` to
 * `basis-not-determinable` and publish none of them.
 *
 * THE MAPPING ITSELF HELD UP. No document in the 137 states a December year end
 * for its own filer; the single hit is Sonata Software's note about a US
 * subsidiary's `year ended December 31, 2024` earn-out, inside a March-year-end
 * filer — which is the confounder a naive contradiction guard would trip on, and
 * the reason the design corroborated per document rather than screening for the
 * word. Corroboration was available in 9 of the 10 label-bearing filings and is
 * insensitive to the reach: the same 9 at every window from 20 to 200 characters
 * past the word `ended`.
 *
 * AND A HAZARD CAME OUT OF IT THAT IS WORTH MORE THAN THE FEATURE. `resolveRow`
 * proves a row's column correspondence by counting: as many value tokens as the
 * header has columns. That is a proof only when the header names EVERY value
 * column, which a statutory statement's date row does and a press release's
 * label row does not — `| Q1 FY27 | Q1 FY26 | Y-o-Y | Q4 FY26 | Q-o-Q |` names
 * three of five. Over the 137 documents, 137 rows would pass that count check
 * and TWO of them put their tokens in unlabelled columns: DRCSYSTEMS 106728252
 * and 106728266, where Docling split one printed table in half and the row
 * `| 1,829.2 | 28% | 9,550.5 | |` states the full-year figure one cell left of
 * its `FY25-26` heading. Two labels, two tokens, count agrees, wrong columns.
 * A fiscal-label header would have to bring its own cell-position model rather
 * than inherit the token-count one.
 *
 * The summary's four blocks are the four questions the design had to answer:
 *
 *   (a) how many refused filings carry a fiscal-label header at all;
 *   (b) in how many the same document prints the implied period end in words it
 *       already parses — `for the quarter ended June 30, 2026`;
 *   (c) whether any document in the corpus contradicts April-March;
 *   (d) which label spellings exist, with counts.
 *
 * It reads documents from a directory `measure-header-tiers.ts --dump` wrote, so
 * it makes NO Docling requests and NO model calls, and writes NOTHING to the
 * collection.
 *
 * Usage:
 *   npm run fiscal:measure -- --from-dir DIR [--refusal period-not-derivable]
 *                             [--ended-reach N]
 */
import 'dotenv/config';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import mongoose from 'mongoose';
import {
  basisReachFor,
  columnDatesIn,
  FilingSchema,
  governingBasis,
  governingScale,
  scaleReachFor,
  valueTokensIn,
  type ColumnDate,
  type FilingDocument,
} from '@app/filings';
import { loadConfig } from '../../apps/ingest/src/config/configuration';

const argValue = (name: string): string | null => {
  const at = process.argv.indexOf(name);
  return at < 0 || at + 1 >= process.argv.length ? null : process.argv[at + 1];
};

const isTableLine = (line: string): boolean => line.trimStart().startsWith('|');
const isSeparator = (line: string): boolean =>
  /^\s*\|[\s|:-]+\|\s*$/.test(line);

const cellsOf = (row: string): readonly string[] =>
  row
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.trim());

/** Every run of consecutive pipe lines, which is what Docling emits a table as. */
function tablesIn(text: string): readonly (readonly string[])[] {
  const tables: string[][] = [];
  let rows: string[] = [];
  for (const line of text.split('\n')) {
    if (isTableLine(line)) {
      if (!isSeparator(line)) rows.push(line);
    } else if (rows.length > 0) {
      tables.push(rows);
      rows = [];
    }
  }
  if (rows.length > 0) tables.push(rows);
  return tables;
}

/**
 * Every shape this corpus writes a fiscal period in, read WIDE.
 *
 * Wider than anything that would ship, on purpose: the difference between what
 * a human reads as a period label and what a rule would accept is the finding.
 * The exploratory pass this was built from masked every digit and counted
 * distinct cell shapes over all 137 documents; these are the ones that came back
 * naming a period and nothing else.
 */
const FISCAL_LABEL =
  /(?<![A-Za-z0-9])(?:(Q[1-4]|H[12]|9M)[\s-]{0,2})?F\.?Y\.?[\s'’]{0,2}(\d{4}|\d{2})(?:\s?-\s?(\d{2,4}))?(?!\d)|(?<![A-Za-z0-9])(Q[1-4]|H[12]|9M)[\s'’-]{0,2}(\d{2})(?!\d)/gi;

/** The period end an April-March fiscal label implies. */
interface ImpliedEnd {
  readonly raw: string;
  /** `Q1 FY27`, the canonical form the label names. */
  readonly canonical: string;
  readonly day: number;
  readonly month: number;
  readonly year: number;
}

/** Which calendar month-end each part of an April-March year closes on. */
const PART_ENDS: Readonly<
  Record<string, { readonly month: number; readonly day: number }>
> = {
  Q1: { month: 6, day: 30 },
  Q2: { month: 9, day: 30 },
  Q3: { month: 12, day: 31 },
  Q4: { month: 3, day: 31 },
  H1: { month: 9, day: 30 },
  '9M': { month: 12, day: 31 },
  FY: { month: 3, day: 31 },
};

/**
 * The period end a label implies under an April-March year.
 *
 * `FY27` is the year April 2026 to March 2027, so its Q1 ends 30 June 2026 and
 * its Q4 ends 31 March 2027 — the calendar year steps back for every part that
 * closes before January.
 */
function impliedEnd(raw: string): ImpliedEnd | null {
  FISCAL_LABEL.lastIndex = 0;
  const match = FISCAL_LABEL.exec(raw);
  if (match === null) return null;
  const part = (match[1] ?? match[4] ?? 'FY').toUpperCase();
  const written = match[2] ?? match[5];
  if (written === undefined) return null;
  const fiscalYearEnd =
    written.length === 4 ? Number(written) : 2000 + Number(written);
  const end = PART_ENDS[part];
  if (end === undefined) return null;
  return {
    raw: match[0],
    canonical:
      part === 'FY'
        ? `FY${fiscalYearEnd % 100}`
        : `${part} FY${fiscalYearEnd % 100}`,
    day: end.day,
    month: end.month,
    // Every part but Q4 closes in the calendar year BEFORE the fiscal year ends.
    year: end.month === 3 ? fiscalYearEnd : fiscalYearEnd - 1,
  };
}

/** A cell that is a fiscal label and nothing else, ignoring an audit note. */
const NOISE = /\((?:un)?audited\)|\[[^\]]*\]|\((?:refer )?note[^)]*\)|[():]/gi;
const labelOnly = (cell: string): string | null => {
  const stripped = cell.replace(NOISE, ' ').replace(/\s+/g, ' ').trim();
  if (stripped.length === 0 || stripped.length > 24) return null;
  FISCAL_LABEL.lastIndex = 0;
  const match = FISCAL_LABEL.exec(stripped);
  if (match === null) return null;
  // The label must BE the cell, not sit inside a sentence: a `Q1 FY27 v/s
  // Q1 FY26` delta column names no period of its own.
  return match[0].length >= stripped.length - 2 ? match[0] : null;
};

/**
 * How far past the word `ended` the date it introduces may sit.
 *
 * Swept below rather than chosen; the summary prints the corroboration count at
 * several reaches so the bound is read off a distribution.
 */
const ENDED_REACH = 60;

const sameDate = (left: ColumnDate, right: ImpliedEnd): boolean =>
  left.day === right.day &&
  left.month === right.month &&
  left.year === right.year;

/**
 * Every period end the document states in words — `for the quarter ended
 * June 30, 2026`, `Year ended 31 March 2026`.
 *
 * THIS IS THE CORROBORATION, and it is deliberately not "any date anywhere in
 * the document". A press release prints its board-meeting date, its allotment
 * dates and its auditor's signature date; matching a label against those would
 * corroborate almost anything. A date introduced by `ended` is the document
 * saying which period it is reporting on.
 */
function endedDatesIn(text: string, reach: number): readonly ColumnDate[] {
  const found: ColumnDate[] = [];
  for (const match of text.matchAll(/ended/gi)) {
    const from = match.index + match[0].length;
    const dates = columnDatesIn(text.slice(from, from + reach));
    if (dates.length > 0) found.push(dates[0]);
  }
  return found;
}

/**
 * Signals that a filer does NOT run an April-March year.
 *
 * A year END in December is the thing that breaks the mapping. `31 December`
 * alone does not: every March-year filer prints it as the nine-months
 * comparative. So the phrase has to bind `year ended` to a December date.
 */
const DECEMBER_YEAR_END =
  /(?:financial |fiscal )?year\s+end(?:ed|ing)?[^.\n]{0,40}?(?:31\s?(?:st)?[\s.,/-]{0,3}(?:december|dec\b)|december\s?31|31[./-]12[./-])/gi;

interface TableFinding {
  /** The header-block cells that are fiscal labels, in printed order. */
  readonly labels: readonly string[];
  readonly ends: readonly ImpliedEnd[];
  /** Dates the header block states that `columnDatesIn` already reads. */
  readonly headerDates: number;
  readonly valueRows: number;
  /**
   * The most common non-zero value-token count across the table's rows.
   *
   * THE NUMBER THE WHOLE PROPOSAL TURNS ON. `resolveRow` refuses a row whose
   * token count is not the header's column count, so a fiscal-label header is
   * only useful where every value column carries a label. A press release that
   * prints `| Q1FY27 | Q1FY26 | YoY% |` states three values against two labels
   * and every row of it is discarded as `columns-not-aligned` — the refusal
   * moves, the figure still does not ship.
   */
  readonly modalTokens: number;
  /**
   * Rows the gate's column check would ACCEPT: the row states exactly as many
   * value tokens as the header states labels.
   */
  readonly countMatchingRows: number;
  /**
   * Of those, rows whose tokens are NOT in the labelled columns.
   *
   * THE HAZARD, and the reason this measurement exists. Crompton's header is
   *
   *     | Particulars | Q1 FY27 | Q1 FY26 | Y-o-Y | Q4 FY26 | Q-o-Q |
   *
   * — five data columns, three of them labelled. Its rows read as three value
   * tokens because `11.2%` and `-2.9%` are one-decimal cells `valueTokensIn`
   * does not recognise, and three tokens against three labels passes
   * `resolveRow`'s check. That check is a correspondence proof only when the
   * header names EVERY value column, which a statutory statement's date row
   * does and a press release's label row does not. Any row where the readable
   * cells are not the labelled ones is a figure published under the wrong
   * period, and the count check cannot see it.
   */
  readonly misplacedRows: number;
  /** One misplaced row, quoted, so the hazard is readable rather than asserted. */
  readonly misplacedExample: string | null;
  readonly labelIndices: readonly number[];
  /**
   * Whether the two checks that run AFTER the columns would also pass.
   *
   * A header the gate can read is necessary and not sufficient: `frameTable`
   * goes on to require a statement heading above the table and a scale
   * declaration near it, and refuses the whole block without either. Counting
   * fiscal-label headers without these two would be counting a fix that ends in
   * a different refusal.
   */
  readonly basisFound: boolean;
  readonly scaleFound: boolean;
  readonly headLine: string;
}

/**
 * Which cell each of a row's value tokens came from, one entry per token.
 *
 * Per TOKEN and not per cell, because a cell Docling merged — `| 187 208 |` —
 * contributes two tokens to one column and shifts everything after it.
 */
const tokenCellIndices = (row: string): readonly number[] =>
  cellsOf(row).flatMap((cell, index) => valueTokensIn(cell).map(() => index));

/** The most common non-zero value count across a table's rows. */
function modalTokenCount(rows: readonly string[]): number {
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
 * The fiscal-label tables in one document.
 *
 * A table qualifies when its HEADER BLOCK — every row above the first row
 * carrying values — states two or more distinct fiscal labels and fewer than
 * two dates the parser reads. Fewer than two dates is precisely the condition
 * `frameTable` refuses on, so a table that qualifies here is a table the gate
 * cannot currently identify a column in.
 */
function fiscalTablesIn(text: string): readonly TableFinding[] {
  const findings: TableFinding[] = [];
  for (const rows of tablesIn(text)) {
    // ONE value token, not two. A press release prints `1,041.6 | 880.6 | 18%`
    // and `valueTokensIn` reads one cell of that three — `880.6` has a single
    // decimal place and `18%` is not a money cell — so a two-token floor here
    // would drop the very tables this is counting. Whether such a row can then
    // be aligned against the header is a different question, counted separately.
    const firstValueRow = rows.findIndex(
      (row) => valueTokensIn(row).length >= 1,
    );
    if (firstValueRow < 1) continue;
    const valueRows = rows.filter(
      (row) => valueTokensIn(row).length >= 1,
    ).length;
    if (valueRows < 3) continue;

    const block = rows.slice(0, firstValueRow);
    const headerDates = columnDatesIn(block.join('\n')).length;
    if (headerDates >= 2) continue;

    const labels = block
      .flatMap((row) => cellsOf(row))
      .map(labelOnly)
      .filter((label): label is string => label !== null);
    const distinct = [...new Set(labels.map((label) => label.toUpperCase()))];
    if (distinct.length < 2) continue;

    // The header row that carries the labels, so their COLUMN POSITIONS can be
    // compared with the value columns. The row with the most of them; a header
    // block that spreads labels over two rows has no single column line.
    const labelRow = [...block].sort(
      (left, right) =>
        cellsOf(right).filter((cell) => labelOnly(cell) !== null).length -
        cellsOf(left).filter((cell) => labelOnly(cell) !== null).length,
    )[0];
    const labelIndices = cellsOf(labelRow).flatMap((cell, index) =>
      labelOnly(cell) !== null ? [index] : [],
    );

    // The row-by-row hazard: of the rows whose token COUNT the gate would
    // accept, how many put those tokens somewhere other than the labelled
    // columns.
    let countMatchingRows = 0;
    let misplacedRows = 0;
    let misplacedExample: string | null = null;
    for (const row of rows.slice(firstValueRow)) {
      if (valueTokensIn(row).length !== labelIndices.length) continue;
      countMatchingRows += 1;
      if (tokenCellIndices(row).join(',') === labelIndices.join(',')) continue;
      misplacedRows += 1;
      misplacedExample ??= row.replace(/\s+/g, ' ').trim().slice(0, 130);
    }

    // The label row's own position, so the two later stages are asked the same
    // question `frameTable` would ask them about this header.
    const headerOffset = text.indexOf(labelRow);
    const basis =
      headerOffset < 0
        ? { outcome: 'none' as const }
        : governingBasis(text, headerOffset, basisReachFor('docling-layout'));
    const scale =
      headerOffset < 0
        ? { outcome: 'none' as const }
        : governingScale(
            text,
            headerOffset,
            labelRow.length,
            scaleReachFor('docling-layout'),
          );

    const ends = labels
      .map(impliedEnd)
      .filter((end): end is ImpliedEnd => end !== null);
    findings.push({
      labels,
      ends,
      headerDates,
      valueRows,
      modalTokens: modalTokenCount(rows),
      countMatchingRows,
      misplacedRows,
      misplacedExample,
      labelIndices,
      basisFound: basis.outcome !== 'none',
      scaleFound: scale.outcome !== 'none',
      headLine: block.join(' ').replace(/\s+/g, ' ').slice(0, 140),
    });
  }
  return findings;
}

interface Row {
  readonly seqId: number;
  readonly symbol: string;
  readonly refusal: string;
  readonly findings: readonly TableFinding[];
  readonly ended: readonly ColumnDate[];
  readonly corroborated: readonly string[];
  readonly uncorroborated: readonly string[];
  readonly decemberSignals: readonly string[];
  /** Whether the document ALSO carries a table the gate can already read. */
  readonly hasDatedStatement: boolean;
}

const main = async (): Promise<void> => {
  const fromDir = argValue('--from-dir');
  if (fromDir === null) {
    process.stderr.write('usage: measure-fiscal-labels --from-dir DIR\n');
    process.exitCode = 1;
    return;
  }
  const wantedRefusal = argValue('--refusal');
  const reach = Number(argValue('--ended-reach') ?? String(ENDED_REACH));

  const config = loadConfig();
  await mongoose.connect(config.mongoUri);
  const model = mongoose.model<FilingDocument>('Filing', FilingSchema);
  const cached = readdirSync(fromDir)
    .filter((name) => name.endsWith('.md'))
    .map((name) => Number(name.replace('.md', '')));

  const filings = await model
    .find(
      { seqId: { $in: cached } },
      { _id: 0, seqId: 1, symbol: 1, enrichment: 1 },
    )
    .sort({ seqId: 1 })
    .lean()
    .exec();

  const spellings = new Map<string, { n: number; files: Set<number> }>();
  const rows: Row[] = [];

  for (const filing of filings) {
    const refusal = filing.enrichment?.resultsRefusalReason ?? 'published';
    if (wantedRefusal !== null && refusal !== wantedRefusal) continue;
    const text = readFileSync(join(fromDir, `${filing.seqId}.md`), 'utf8');

    const findings = fiscalTablesIn(text);
    const ended = endedDatesIn(text, reach);
    const corroborated: string[] = [];
    const uncorroborated: string[] = [];
    for (const finding of findings) {
      for (const end of finding.ends) {
        const key = end.raw.replace(/\d/g, '9');
        const seen = spellings.get(key) ?? { n: 0, files: new Set<number>() };
        seen.n += 1;
        seen.files.add(filing.seqId);
        spellings.set(key, seen);
        const agrees = ended.some((date) => sameDate(date, end));
        (agrees ? corroborated : uncorroborated).push(
          `${end.raw}->${end.day}/${end.month}/${end.year}`,
        );
      }
    }

    const decemberSignals = [...text.matchAll(DECEMBER_YEAR_END)].map((match) =>
      match[0].replace(/\s+/g, ' '),
    );

    const hasDatedStatement = tablesIn(text).some((table) => {
      const firstValueRow = table.findIndex(
        (row) => valueTokensIn(row).length >= 2,
      );
      if (firstValueRow < 0) return false;
      const block = table.slice(0, Math.max(1, firstValueRow));
      return columnDatesIn(block.join('\n')).length >= 2;
    });

    rows.push({
      seqId: filing.seqId,
      symbol: filing.symbol,
      refusal,
      findings,
      ended,
      corroborated,
      uncorroborated,
      decemberSignals,
      hasDatedStatement,
    });
  }

  for (const row of rows) {
    if (row.findings.length === 0 && row.decemberSignals.length === 0) continue;
    process.stdout.write(
      `\n=== ${row.seqId} ${row.symbol} refusal=${row.refusal} ` +
        `datedStatementAlso=${row.hasDatedStatement ? 'YES' : 'no'} ===\n`,
    );
    for (const finding of row.findings) {
      process.stdout.write(
        `  labels=[${finding.labels.join(', ')}] valueRows=${finding.valueRows} ` +
          `modalTokens=${finding.modalTokens} labelCols=[${finding.labelIndices.join(',')}] ` +
          `gateWouldAccept=${finding.countMatchingRows} ` +
          `misplaced=${finding.misplacedRows} ` +
          `basis=${finding.basisFound ? 'YES' : 'no'} ` +
          `scale=${finding.scaleFound ? 'YES' : 'no'}` +
          `\n      head: ${finding.headLine}\n` +
          (finding.misplacedExample === null
            ? ''
            : `      MISPLACED: ${finding.misplacedExample}\n`),
      );
    }
    if (row.ended.length > 0) {
      const shown = [
        ...new Set(row.ended.map((d) => `${d.day}/${d.month}/${d.year}`)),
      ];
      process.stdout.write(`  ended dates: ${shown.join(' ')}\n`);
    }
    if (row.corroborated.length > 0) {
      process.stdout.write(`  CORROBORATED: ${row.corroborated.join(' ')}\n`);
    }
    if (row.uncorroborated.length > 0) {
      process.stdout.write(
        `  uncorroborated: ${row.uncorroborated.join(' ')}\n`,
      );
    }
    for (const signal of row.decemberSignals) {
      process.stdout.write(`  !! DECEMBER YEAR END: "${signal}"\n`);
    }
  }

  const withLabels = rows.filter((row) => row.findings.length > 0);
  const anyCorroborated = withLabels.filter(
    (row) => row.corroborated.length > 0,
  );
  const contradicting = rows.filter((row) => row.decemberSignals.length > 0);

  // THE SHIPPABLE SET, and it is the intersection of every stage rather than
  // the first of them. A header the gate could read is worth nothing on its own:
  // some row must state as many values as the header states labels (or every row
  // is `columns-not-aligned`), two labels must name a year-on-year pair (or the
  // block is `not-year-on-year`, which is what a `Q1 FY27 | Q4 FY26` table is),
  // the document must corroborate the calendar, and the basis and scale stages
  // must both find what they need. Counting the header alone would credit a fix
  // that ends in a different refusal.
  const corroborates = (row: Row, finding: TableFinding): boolean =>
    finding.ends.some((end) => row.ended.some((date) => sameDate(date, end)));
  const hasYearOnYearPair = (finding: TableFinding): boolean =>
    finding.ends.some((left) =>
      finding.ends.some(
        (right) =>
          left.day === right.day &&
          left.month === right.month &&
          left.year - right.year === 1,
      ),
    );
  const publishable = (finding: TableFinding): boolean =>
    finding.countMatchingRows > 0 &&
    hasYearOnYearPair(finding) &&
    finding.basisFound &&
    finding.scaleFound;
  const publishes = withLabels.filter((row) =>
    row.findings.some(
      (finding) => publishable(finding) && corroborates(row, finding),
    ),
  );

  // WHERE THE CANDIDATES ARE ACTUALLY LOST. A fiscal-label header that the gate
  // could read still has to clear the two stages after it, and counting the
  // header alone would credit a fix that ends in a different refusal.
  const columnReady = (finding: TableFinding): boolean =>
    finding.countMatchingRows > 0 && hasYearOnYearPair(finding);
  const readable = withLabels.filter((row) =>
    row.findings.some(
      (finding) => columnReady(finding) && corroborates(row, finding),
    ),
  );
  const lostToBasis = readable.filter(
    (row) =>
      !row.findings.some(
        (finding) =>
          columnReady(finding) &&
          corroborates(row, finding) &&
          finding.basisFound,
      ),
  );
  const lostToScale = readable.filter(
    (row) =>
      !row.findings.some(
        (finding) =>
          columnReady(finding) &&
          corroborates(row, finding) &&
          finding.scaleFound,
      ),
  );
  const misplacing = withLabels.filter((row) =>
    row.findings.some((finding) => finding.misplacedRows > 0),
  );
  const misplacedTotal = withLabels
    .flatMap((row) => row.findings)
    .reduce((sum, finding) => sum + finding.misplacedRows, 0);
  const acceptedTotal = withLabels
    .flatMap((row) => row.findings)
    .reduce((sum, finding) => sum + finding.countMatchingRows, 0);

  process.stdout.write(
    `\n\n================ FISCAL LABELS ================\n` +
      `filings=${rows.length} endedReach=${reach}\n` +
      `  (a) carry a fiscal-label header         ${withLabels.length}\n` +
      `  (b) a label the document corroborates   ${anyCorroborated.length}\n` +
      `      ... columns readable, YoY pair      ${readable.length}\n` +
      `      ... but no statement heading above  ${lostToBasis.length}\n` +
      `      ... but no scale declared near it   ${lostToScale.length}\n` +
      `      ... clears every stage, publishes   ${publishes.length}\n` +
      `      also carry a dated statement        ${withLabels.filter((r) => r.hasDatedStatement).length}\n` +
      `  (c) December-year-end signals           ${contradicting.length}\n` +
      `  hazard: rows the gate would accept      ${acceptedTotal}\n` +
      `          of those, tokens off-column     ${misplacedTotal} ` +
      `(in ${misplacing.length} filing(s))\n`,
  );
  process.stdout.write(
    `\n--- filings a corroborated fiscal label would publish ---\n` +
      `${publishes.map((row) => `${row.seqId} ${row.symbol}`).join('\n')}\n`,
  );

  process.stdout.write(
    '\n--- (d) label spellings, digits masked ---\n  files cells shape\n',
  );
  for (const [shape, seen] of [...spellings.entries()].sort(
    (left, right) => right[1].files.size - left[1].files.size,
  )) {
    process.stdout.write(
      `  ${String(seen.files.size).padStart(5)} ${String(seen.n).padStart(5)} ${shape}\n`,
    );
  }

  // THE REACH SWEEP. Printed rather than asserted so the bound above is read off
  // a distribution instead of chosen.
  process.stdout.write('\n--- corroborated filings by ended-reach ---\n');
  for (const candidate of [20, 30, 40, 60, 80, 120, 200]) {
    let count = 0;
    for (const row of withLabels) {
      const text = readFileSync(join(fromDir, `${row.seqId}.md`), 'utf8');
      const dates = endedDatesIn(text, candidate);
      const hit = row.findings.some((finding) =>
        finding.ends.some((end) => dates.some((date) => sameDate(date, end))),
      );
      if (hit) count += 1;
    }
    process.stdout.write(
      `  reach=${String(candidate).padStart(4)}  ${count}\n`,
    );
  }

  process.stdout.write(
    `\n--- filings with a fiscal-label header ---\n` +
      `${withLabels.map((row) => `${row.seqId} ${row.symbol}`).join('\n')}\n`,
  );

  await mongoose.disconnect();
};

void main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
