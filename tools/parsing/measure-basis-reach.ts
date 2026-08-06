/**
 * Measures how far a results table's column header sits below the statement
 * heading that governs it, in whatever text a parser produced.
 *
 * WHY THIS EXISTS AS A TOOL RATHER THAN A NOTE. `BASIS_HEADING_REACH` is the
 * bound that turns "the nearest heading is 3,395 characters away" into a
 * refusal instead of a mislabelled statement, and it was set from a measured
 * bimodal gap in `pdf-parse` output. Docling emits more text per table — pipes,
 * padding, repeated column headers — so the same real pairings sit further
 * apart, and a bound tuned on one parser's output is not evidence about the
 * other's. This prints the distribution so the constant can be moved on a
 * measurement rather than on a guess.
 *
 * Usage:
 *   npm run basis:measure -- <file.md|file.txt> [more files...]
 *
 * Each file is text a parser produced for one filing. Every line carrying two
 * or more column dates is treated as a table header, exactly as
 * `results-verify.ts` locates one, and paired with the nearest basis marker
 * above it.
 */
import { readFileSync } from 'fs';
import { basisMarkersIn, type BasisMarker } from '@app/filings';
import { columnDatesIn } from '@app/filings';

/** One header line and the heading nearest above it. */
interface Pairing {
  readonly file: string;
  readonly offset: number;
  readonly distance: number | null;
  readonly basis: string;
  readonly line: string;
  /**
   * Whether the line is a table row rather than prose that happens to carry two
   * dates.
   *
   * THE DISTINCTION THAT MAKES THE MEASUREMENT MEAN ANYTHING. A note reading
   * "the figures for the quarter ended March 31, 2026 are the balancing figures
   * between..." carries two dates and is not a column header; the extractor
   * never quotes one as `columnsSpan`, so pairing it with a heading measures
   * nothing. Under Docling a real column header is a markdown table row.
   */
  readonly tableRow: boolean;
}

const isTableRow = (line: string): boolean => line.trimStart().startsWith('|');

/** Byte offsets of every line, so a header's position is exact. */
const linesWithOffsets = (
  text: string,
): readonly { readonly offset: number; readonly line: string }[] => {
  const rows: { offset: number; line: string }[] = [];
  let at = 0;
  for (const line of text.split('\n')) {
    rows.push({ offset: at, line });
    at += line.length + 1;
  }
  return rows;
};

const nearestAbove = (
  markers: readonly BasisMarker[],
  offset: number,
): BasisMarker | undefined => {
  const reachable = markers.filter((marker) => marker.offset <= offset);
  return reachable[reachable.length - 1];
};

const pairingsIn = (file: string, text: string): readonly Pairing[] => {
  const markers = basisMarkersIn(text);
  return linesWithOffsets(text)
    .filter((row) => columnDatesIn(row.line).length >= 2)
    .map((row) => {
      const marker = nearestAbove(markers, row.offset);
      return {
        file,
        offset: row.offset,
        distance: marker === undefined ? null : row.offset - marker.offset,
        basis: marker?.basis ?? '(none)',
        line: row.line.replace(/\s+/g, ' ').trim().slice(0, 70),
        tableRow: isTableRow(row.line),
      };
    });
};

const main = (): void => {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error('usage: measure-basis-reach <file> [more files...]');
    process.exitCode = 1;
    return;
  }

  const all: Pairing[] = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const pairings = pairingsIn(file, text);
    all.push(...pairings);
    console.log(
      `\n=== ${file} — ${text.length} chars, ` +
        `${basisMarkersIn(text).length} basis markers, ` +
        `${pairings.length} column-date header line(s) ===`,
    );
    for (const pairing of pairings) {
      console.log(
        `  ${pairing.tableRow ? 'TABLE' : 'prose'} ` +
          `offset=${String(pairing.offset).padStart(7)} ` +
          `distance=${String(pairing.distance ?? 'none').padStart(7)} ` +
          `basis=${pairing.basis.padEnd(12)} | ${pairing.line}`,
      );
    }
  }

  const sortedDistances = (rows: readonly Pairing[]): readonly number[] =>
    rows
      .map((pairing) => pairing.distance)
      .filter((distance): distance is number => distance !== null)
      .sort((left, right) => left - right);

  const tables = sortedDistances(all.filter((pairing) => pairing.tableRow));
  const everything = sortedDistances(all);

  console.log(`\n=== ${everything.length} pairing(s), sorted ===`);
  console.log(everything.join(', '));
  console.log(`\n=== ${tables.length} TABLE-ROW pairing(s), sorted ===`);
  console.log(tables.join(', '));

  // The gap is what a bound is set inside, so it is printed rather than eyeballed.
  console.log('\n=== gaps between consecutive table-row distances ===');
  for (let index = 1; index < tables.length; index += 1) {
    const gap = tables[index] - tables[index - 1];
    if (gap >= 500) {
      console.log(`  ${tables[index - 1]} -> ${tables[index]}  (gap ${gap})`);
    }
  }
};

main();
