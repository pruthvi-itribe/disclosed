/**
 * What a 50-symbol watchlist actually costs a reader, counted on the recorded
 * corpus rather than bracketed.
 *
 * WHY THIS TOOL EXISTS. The per-user cap is a number about ATTENTION: how many
 * notable filings a day a watchlist of N symbols produces. That figure needs
 * three inputs — alertable filings per day, distinct companies, and the cap —
 * and only the first was ever measured. The design doc bracketed distinct
 * companies at 1,500-2,500 from a four-day sample of 960 and derived "8-13
 * filings a day", which is a range wide enough to justify either 25 or 100.
 * A guessed number in a comment poisons the record this codebase keeps, so the
 * bracket is replaced by a run of this.
 *
 * COSTS NOTHING AND TOUCHES NOTHING. It reads the corpus JSONL off disk and
 * applies this repository's own `isRoutine`, which is the same gate the alert
 * path applies. No database, no network, no model call.
 *
 * WHAT IT MEASURED (2026-08-08, data/corpus/05-07-2026_05-08-2026.jsonl):
 *
 *     filings                17,442 over 33 IST days
 *     alertable              12,415 (71.2%)  -> 376/day
 *     distinct companies      2,294
 *     alertable per company   0.164 / day
 *     a 50-symbol watchlist   8.2 notable filings / day
 *
 * Usage:
 *   npm run watch:cap -- [path/to/corpus.jsonl]
 */
import * as fs from 'fs';
import * as readline from 'readline';
import { isRoutine } from '@app/filings';

/** The corpus the numbers in `watchlist-cap.ts` were measured on. */
const DEFAULT_CORPUS = 'data/corpus/05-07-2026_05-08-2026.jsonl';

/** The cap being sized. Imported rather than restated would be circular — this
 * tool is what justifies the constant, so it names the candidate itself. */
const CANDIDATE_CAP = 50;

interface Row {
  readonly symbol?: unknown;
  readonly category?: unknown;
  readonly disseminatedAt?: unknown;
}

const asText = (value: unknown): string =>
  typeof value === 'string' ? value : '';

const main = async (): Promise<void> => {
  const path = process.argv[2] ?? DEFAULT_CORPUS;

  if (!fs.existsSync(path)) {
    // Reported rather than fetched. A measurement tool that quietly downloads
    // its own input is a tool whose numbers nobody can reproduce.
    console.error(`No corpus at ${path}. Run npm run corpus:fetch first.`);
    process.exitCode = 1;
    return;
  }

  const lines = readline.createInterface({
    input: fs.createReadStream(path),
  });

  const companies = new Set<string>();
  const days = new Set<string>();
  let filings = 0;
  let alertable = 0;

  for await (const line of lines) {
    if (line.trim() === '') continue;

    // A malformed line is skipped LOUDLY. A corpus half-read reports a company
    // count that is simply wrong, and this number ends up in a comment.
    let row: Row;
    try {
      row = JSON.parse(line) as Row;
    } catch {
      console.error(`Skipping an unparseable line at record ${filings + 1}`);
      continue;
    }

    filings += 1;
    const symbol = asText(row.symbol);
    if (symbol !== '') companies.add(symbol);

    const when = asText(row.disseminatedAt);
    if (when !== '') days.add(when.slice(0, 10));

    if (!isRoutine(asText(row.category))) alertable += 1;
  }

  const perDay = alertable / days.size;
  const perCompanyPerDay = perDay / companies.size;

  console.log(`corpus                ${path}`);
  console.log(`filings               ${filings} over ${days.size} days`);
  console.log(
    `alertable             ${alertable} (${((alertable / filings) * 100).toFixed(1)}%) -> ${perDay.toFixed(0)}/day`,
  );
  console.log(`distinct companies    ${companies.size}`);
  console.log(`alertable per company ${perCompanyPerDay.toFixed(3)}/day`);
  console.log(
    `a ${CANDIDATE_CAP}-symbol watchlist  ${(perCompanyPerDay * CANDIDATE_CAP).toFixed(1)} notable filings/day`,
  );
};

void main();
