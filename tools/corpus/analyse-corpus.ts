/**
 * Phase 1 deliverable. Replays the deterministic funnel stages over the corpus
 * and reports survivor counts at each stage.
 *
 * The size-relative materiality threshold is NOT applied here — it needs a
 * securities master (market cap by ISIN) that does not exist yet. This measures
 * everything upstream of that gate, which is the bulk of the filtering.
 *
 * Usage: npm run corpus:analyse -- data/corpus/<file>.jsonl
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import {
  isRoutine,
  ROUTINE_CATEGORIES,
  hasAmbiguityKeyword,
  extractRupeeAmounts,
  safeEcho,
  type Filing,
} from '@app/filings';

/**
 * The on-disk shape. `JSON.parse` does not revive Date fields, so the three
 * timestamps arrive as ISO strings however they are typed. Modelling that
 * honestly is what keeps the IST bucketing below correct.
 */
type StoredFiling = Omit<
  Filing,
  'announcedAt' | 'disseminatedAt' | 'ingestedAt'
> & {
  announcedAt: string;
  disseminatedAt: string;
  ingestedAt: string;
};

/** Categories that carry defamation or SEBI exposure — never auto-drafted. */
const LEGAL_BLOCK_PATTERNS: readonly RegExp[] = [
  /litigation|arbitration|court|tribunal/i,
  /sebi|show[- ]cause|enforcement|adjudicat/i,
  /insolvency|ibc\b|nclt|liquidat/i,
  /auditor.*(resign|qualif)|qualif.*auditor/i,
  /whistle ?blower|fraud|default|misstatement/i,
];

const isLegallyBlocked = (
  filing: Pick<Filing, 'category' | 'summary'>,
): boolean =>
  LEGAL_BLOCK_PATTERNS.some(
    (p) => p.test(filing.category) || p.test(filing.summary),
  );

/**
 * NSE disseminates on IST (UTC+05:30). Bucketing a filing by its raw UTC
 * calendar day splits the IST day at 18:30 UTC, so everything filed between
 * 00:00 and 05:30 IST is attributed to the previous day and the day count that
 * divides every per-day figure below is wrong.
 */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

function parseTimestamp(iso: string): number {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    throw new Error(`Unparseable timestamp in corpus: ${safeEcho(iso)}`);
  }
  return ms;
}

const istDay = (iso: string): string =>
  new Date(parseTimestamp(iso) + IST_OFFSET_MS).toISOString().slice(0, 10);

const utcDay = (iso: string): string =>
  new Date(parseTimestamp(iso)).toISOString().slice(0, 10);

/**
 * Sensitivity probe only — NOT a funnel stage. `extractRupeeAmounts` is the
 * shipped contract; this permissive variant exists solely to measure how far
 * that contract under-counts on real NSE text, so the Phase 1 decision is taken
 * on a range rather than on one deflated number. It covers three misses
 * observed in this corpus: plural units ("Rs 1,063 crores" — the trailing \b
 * cannot match after "crore"), the un-decoded HTML entity NSE emits for the
 * rupee sign ("&#8377;561 cr"), and mn/bn units used in press-release titles.
 */
const PERMISSIVE_AMOUNT_PATTERN =
  /(?:rs\.?|inr|₹|&#8377;)\s*([\d,]+(?:\.\d+)?)\s*(crores|crore|crs|cr|lakhs|lakh|lacs|lac|mn|million|bn|billion)\b/gi;

/** `matchAll` clones the regex, so the shared /g instance stays stateless. */
const hasPermissiveAmount = (text: string): boolean =>
  [...text.matchAll(PERMISSIVE_AMOUNT_PATTERN)].length > 0;

/** Any rupee token at all — the ceiling for what summary text could ever yield. */
const RUPEE_TOKEN = /(?:\brs\.?|\binr\b|₹|&#8377;)/i;

function resolveInputPath(argv: string[]): string {
  const explicit = argv[2];
  if (explicit) return explicit;
  const dir = join(process.cwd(), 'data', 'corpus');
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .sort();
  if (files.length === 0) {
    throw new Error('No corpus found. Run `npm run corpus:fetch` first.');
  }
  return join(dir, files[files.length - 1]);
}

const distinct = (values: readonly string[]): number => new Set(values).size;

const collapseSpaces = (value: string): string =>
  value.trim().toLowerCase().replace(/\s+/g, ' ');

function main(): void {
  const path = resolveInputPath(process.argv);
  const filings: StoredFiling[] = readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as StoredFiling);

  const istDays = filings.map((f) => istDay(f.disseminatedAt));
  const days = distinct(istDays);
  const utcDays = distinct(filings.map((f) => utcDay(f.disseminatedAt)));
  const moved = filings.filter(
    (f) => istDay(f.disseminatedAt) !== utcDay(f.disseminatedAt),
  ).length;

  const afterRoutine = filings.filter((f) => !isRoutine(f.category));
  const afterLegal = afterRoutine.filter((f) => !isLegallyBlocked(f));
  const withAmount = afterLegal.filter(
    (f) => extractRupeeAmounts(f.summary).length > 0,
  );
  const unambiguous = withAmount.filter((f) => !hasAmbiguityKeyword(f.summary));

  const line = (label: string, n: number): void => {
    const pct = ((n / filings.length) * 100).toFixed(1);
    console.log(
      `${label.padEnd(34)} ${String(n).padStart(6)}  ${pct.padStart(5)}%  ${(n / days).toFixed(1)}/day`,
    );
  };

  const sorted = [...istDays].sort();
  console.log(`\nCorpus: ${path}`);
  console.log(
    `${filings.length} filings across ${days} IST days ` +
      `(${sorted[0]}..${sorted[sorted.length - 1]}, both ends partial)`,
  );
  console.log(
    `Day bucketing: IST (UTC+05:30). Bucketing by raw UTC instead would report ` +
      `${utcDays} days\nand move ${moved} filings ` +
      `(${((moved / filings.length) * 100).toFixed(1)}%) onto the previous day.\n`,
  );

  line('total', filings.length);
  line('after routine-category discard', afterRoutine.length);
  line('after legal blocklist', afterLegal.length);
  line('with an extractable amount', withAmount.length);
  line('unambiguous (newsjack candidates)', unambiguous.length);

  // The long tail is the funnel's biggest assumption: every category that
  // ROUTINE_CATEGORIES does not name survives stage 1 by failing open.
  const normalised = filings.map((f) => f.category.trim().toLowerCase());
  const outside = normalised.filter((c) => !ROUTINE_CATEGORIES.has(c));
  const distinctAll = distinct(filings.map((f) => f.category));
  console.log('\nCategory long tail:');
  console.log(`  distinct category values (raw)          ${distinctAll}`);
  console.log(
    `  ...after trim + case-fold               ${distinct(normalised)}`,
  );
  console.log(
    `  ...after also collapsing inner spaces   ${distinct(filings.map((f) => collapseSpaces(f.category)))}`,
  );
  console.log(
    `  matched by ROUTINE_CATEGORIES           ${distinct(normalised) - distinct(outside)} of ${ROUTINE_CATEGORIES.size} listed`,
  );
  console.log(
    `  OUTSIDE ROUTINE_CATEGORIES              ${distinct(outside)} categories, ` +
      `${outside.length} records (${((outside.length / filings.length) * 100).toFixed(1)}%)`,
  );
  console.log(
    '  These survive stage 1 only because the gate fails open, not because\n' +
      '  they were judged interesting.',
  );

  console.log('\nTop categories among candidates:');
  const byCategory = new Map<string, number>();
  for (const f of unambiguous) {
    byCategory.set(f.category, (byCategory.get(f.category) ?? 0) + 1);
  }
  [...byCategory.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .forEach(([cat, n]) => console.log(`  ${String(n).padStart(5)}  ${cat}`));

  // How much of the funnel's narrowness is the amount pattern rather than the
  // filings themselves.
  const permissive = afterLegal
    .filter((f) => hasPermissiveAmount(f.summary))
    .filter((f) => !hasAmbiguityKeyword(f.summary));
  const rupeeTokens = filings.filter((f) => RUPEE_TOKEN.test(f.summary)).length;
  console.log('\nMeasurement sensitivity (not funnel stages):');
  console.log(
    `  summaries containing any rupee token    ${rupeeTokens} of ${filings.length} ` +
      `(${((rupeeTokens / filings.length) * 100).toFixed(1)}%)`,
  );
  console.log(
    `  candidates, shipped amount pattern      ${unambiguous.length}  ` +
      `(${(unambiguous.length / days).toFixed(2)}/day)`,
  );
  console.log(
    `  candidates, permissive amount pattern   ${permissive.length}  ` +
      `(${(permissive.length / days).toFixed(2)}/day)`,
  );
  console.log(
    `  distinct symbols among candidates       ${distinct(unambiguous.map((f) => f.symbol))}`,
  );
  console.log(
    '  The gap is plural units ("Rs 1,063 crores"), the un-decoded HTML\n' +
      '  entity &#8377; that NSE emits for the rupee sign, and mn/bn units.\n' +
      '  Amounts stated only inside the attachment PDF are invisible to both.',
  );

  const perDay = unambiguous.length / days;
  console.log(
    `\nVERDICT: ${perDay.toFixed(1)} newsjack candidates/day before the ` +
      `market-cap gate.\nThe market-cap gate will reduce this further. If the ` +
      `post-gate figure lands below ~1/day, the newsjack lane cannot sustain a ` +
      `cadence and only the teardown lane justifies itself.\n` +
      `This figure is an UPPER BOUND for the lane: every remaining stage ` +
      `(market-cap\nmateriality, dedup, watchlist) only removes. It is also ` +
      `measured on summary text\nalone, so treat ${perDay.toFixed(1)}` +
      `-${(permissive.length / days).toFixed(1)}/day as the honest pre-gate range.\n`,
  );
}

main();
