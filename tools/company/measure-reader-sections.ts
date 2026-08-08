/**
 * How many companies each of the company page's reader sections can honestly
 * carry, counted on the live collection.
 *
 * WHY IT EXISTS. The three sections that replaced the filing strip and the
 * group-mix bar are all hidden when there is nothing to show, and "hidden"
 * is only defensible if somebody has counted how often. Every floor and every
 * coverage figure in `script-company.ts`, `claim-commitment.ts` and
 * `docs/ui-components.md` comes from this run, and a comment whose number has
 * drifted is corrected from here rather than deleted.
 *
 * COSTS NOTHING AND WRITES NOTHING. Every input is already stored — the results
 * block, the claims and their directions — and the two rules it applies are the
 * same pure functions the dashboard applies on read.
 *
 * THE ONE MOVING NUMBER is "what's next": it is measured against an IST day, so
 * it falls as dates pass. `--today YYYY-MM-DD` pins it, which is how a figure in
 * a comment stays checkable after the day it was written.
 *
 * Usage:
 *   npm run company:sections -- [--today YYYY-MM-DD] [--examples N]
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { datedCommitments } from '@app/filings';
import { istDayKey } from '@app/common';
import { loadConfig } from '../../apps/ingest/src/config/configuration';

/** How many worked examples of each section are printed. */
const DEFAULT_EXAMPLES = 8;

interface ClaimRow {
  readonly span?: unknown;
  readonly direction?: unknown;
  readonly directionEvidence?: unknown;
}

interface Row {
  readonly symbol?: unknown;
  readonly disseminatedAt?: unknown;
  readonly enrichment?: {
    readonly claims?: readonly ClaimRow[];
    readonly results?: {
      readonly period?: unknown;
      readonly basis?: unknown;
      readonly figures?: readonly unknown[];
    } | null;
  };
}

/** The directions that draw a mark. `unrated` draws none, and neither does null. */
const MARKED = new Set(['expansion', 'contraction', 'mixed']);

const argOf = (name: string): string | null => {
  const at = process.argv.indexOf(name);
  return at === -1 ? null : (process.argv[at + 1] ?? null);
};

const numberArg = (name: string, fallback: number): number => {
  const raw = argOf(name);
  const parsed = Number(raw);
  return raw !== null && Number.isFinite(parsed) && parsed >= 0
    ? parsed
    : fallback;
};

const percent = (part: number, whole: number): string =>
  whole === 0 ? '0.0%' : `${((100 * part) / whole).toFixed(1)}%`;

async function main(): Promise<void> {
  const config = loadConfig();
  const today = argOf('--today') ?? istDayKey(new Date());
  const examples = numberArg('--examples', DEFAULT_EXAMPLES);

  await mongoose.connect(config.mongoUri);
  const db = mongoose.connection.db;
  if (db === undefined) throw new Error('no database handle');

  const rows = (await db
    .collection('filings')
    .find({})
    .project({
      _id: 0,
      symbol: 1,
      disseminatedAt: 1,
      'enrichment.claims.span': 1,
      'enrichment.claims.direction': 1,
      'enrichment.claims.directionEvidence': 1,
      'enrichment.results.period': 1,
      'enrichment.results.basis': 1,
      'enrichment.results.figures': 1,
    })
    .toArray()) as Row[];

  const companies = new Set<string>();
  const withFigures = new Set<string>();
  const withCommitment = new Set<string>();
  const withMarks = new Set<string>();

  let filings = 0;
  let figureFilings = 0;
  let figures = 0;
  let commitmentDates = 0;
  let commitmentClaims = 0;
  let marks = 0;
  const markDays = new Map<string, Set<string>>();
  const quarters = new Map<string, Set<string>>();
  const figureShown: string[] = [];
  const nextShown: string[] = [];

  for (const row of rows) {
    const symbol = typeof row.symbol === 'string' ? row.symbol : '';
    if (symbol === '') continue;
    filings += 1;
    companies.add(symbol);

    const results = row.enrichment?.results ?? null;
    const rowFigures = results?.figures ?? [];
    if (rowFigures.length > 0) {
      figureFilings += 1;
      figures += rowFigures.length;
      withFigures.add(symbol);
      const quarter = `${String(results?.period)} ${String(results?.basis)}`;
      const held = quarters.get(symbol) ?? new Set<string>();
      held.add(quarter);
      quarters.set(symbol, held);
      if (figureShown.length < examples) {
        figureShown.push(`${symbol}  ${quarter}  ${rowFigures.length} figures`);
      }
    }

    const day =
      row.disseminatedAt instanceof Date ? istDayKey(row.disseminatedAt) : null;

    for (const claim of row.enrichment?.claims ?? []) {
      const span = typeof claim.span === 'string' ? claim.span : '';
      const dated = datedCommitments(span, today);
      if (dated.length > 0) {
        commitmentClaims += 1;
        commitmentDates += dated.length;
        withCommitment.add(symbol);
        if (nextShown.length < examples) {
          nextShown.push(
            `${symbol}  ${dated.map((one) => `${one.date} (${one.evidence})`).join(', ')}`,
          );
        }
      }

      const direction =
        typeof claim.direction === 'string' ? claim.direction : '';
      if (MARKED.has(direction)) {
        marks += 1;
        withMarks.add(symbol);
        if (day !== null) {
          const days = markDays.get(symbol) ?? new Set<string>();
          days.add(day);
          markDays.set(symbol, days);
        }
      }
    }
  }

  const total = companies.size;
  process.stdout.write(
    `\nfilings ${filings} · companies ${total} · IST day ${today}\n\n`,
  );

  process.stdout.write('1. THE NUMBERS, AS PRINTED (enrichment.results)\n');
  process.stdout.write(
    `   companies drawn: ${withFigures.size} of ${total} (${percent(withFigures.size, total)})\n`,
  );
  process.stdout.write(
    `   filings carrying a table: ${figureFilings} · figures: ${figures}\n`,
  );
  const multiQuarter = [...quarters.values()].filter((q) => q.size >= 2).length;
  process.stdout.write(
    `   companies holding 2+ distinct quarter/basis blocks: ${multiQuarter}\n`,
  );
  for (const line of figureShown) process.stdout.write(`     ${line}\n`);

  process.stdout.write("\n2. WHAT'S NEXT (dated commitments still ahead)\n");
  process.stdout.write(
    `   companies drawn: ${withCommitment.size} of ${total} (${percent(withCommitment.size, total)})\n`,
  );
  process.stdout.write(
    `   claims: ${commitmentClaims} · dates: ${commitmentDates}\n`,
  );
  for (const line of nextShown) process.stdout.write(`     ${line}\n`);

  process.stdout.write('\n3. DIRECTION MARKS OVER TIME\n');
  process.stdout.write(
    `   companies drawn: ${withMarks.size} of ${total} (${percent(withMarks.size, total)})\n`,
  );
  process.stdout.write(`   marks: ${marks}\n`);
  const spans = [...markDays.values()];
  process.stdout.write(
    `   of those, spanning 2+ IST days: ${spans.filter((d) => d.size >= 2).length}` +
      ` · 3+ IST days: ${spans.filter((d) => d.size >= 3).length}\n`,
  );

  await mongoose.disconnect();
}

main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
