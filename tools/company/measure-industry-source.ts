/**
 * How many of the companies NSE printed no industry for can get one from BSE,
 * and — with `--write` — gives it to them.
 *
 * WHY IT EXISTS. The company page's industry chip is hidden when the value is
 * null, which was the honest thing to do and was happening far too often: NSE's
 * `smIndustry` reaches 522 of the 1,289 companies held, so 767 company pages
 * had no industry at all. The BSE lane already stores a scrip row per company
 * it has seen announce, and BSE's scrip header carries its own classification.
 * The question this answers is whether that is a real fix or a rounding error.
 *
 * WHAT IT MEASURED (2026-08-09, 3,933 filings, 1,289 companies):
 *
 *   NSE printed an industry for   522 companies (40.5%)
 *   blank                          767
 *     matched to a BSE scrip       357 (46.5% of blank) — 356 by ISIN prefix,
 *                                  1 by company name
 *     BSE carried an industry for  357 of 357 matched (100.0%)
 *     unmatched                    410 — no BSE scrip is held for them, which
 *                                  is a gap in the shadow lane's coverage
 *                                  rather than in BSE's data
 *
 *   after the write: 879 of 1,289 companies carry an industry (68.2%), up from
 *   40.5%. 1,370 filings touched, 110 distinct strings, longest 43 characters
 *   ("Healthcare Research, Analytics & Technology"). The commonest are Civil
 *   Construction (17), Pharmaceuticals (16) and Industrial Products (16).
 *
 * THE MATCH IS `cross-exchange-match.ts`'s, NOT A NEW ONE. `isinCompanyKey`
 * first — the first nine ISIN characters, because face-value changes rewrite
 * the last three — and `companyKey` as the fallback. The fallback earned 1
 * company of 767, which is worth knowing and is why it is reported separately
 * rather than folded into a single total.
 *
 * IT WRITES `bseIndustry`, NEVER `industry`. `industry` is what NSE's feed said
 * and stays that; a fill-in would have overwritten a null that MEANS something
 * on 767 companies and there would be no way back. `toView` prefers NSE's and
 * falls back to this one, and sends `industrySource` so the page can say which.
 *
 * COSTS NO MODEL CALLS. It does make one BSE request per matched scrip, paced
 * at the same delay the ISIN resolver uses, so a full run is a few minutes of
 * requests. `--limit` bounds it for a spot check.
 *
 * WRITING IS OPT-IN. `--dry-run` is the default and there is no way to write
 * without typing `--write`, for the reason `requeue-terminal.ts` gives: the
 * collection this points at is the live one.
 *
 * Usage:
 *   npm run company:industry -- [--write] [--limit N] [--delay MS]
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import {
  BseClient,
  companyKey,
  FilingSchema,
  isinCompanyKey,
  type FilingDocument,
} from '@app/filings';
import { loadConfig } from '../../apps/ingest/src/config/configuration';

/** How many worked examples of each outcome are printed. */
const EXAMPLES = 10;

/** How often the fetch loop says where it is. */
const PROGRESS_EVERY = 25;

const write = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

const numberArg = (name: string, fallback: number): number => {
  const at = process.argv.indexOf(`--${name}`);
  if (at === -1) return fallback;
  const value = Number(process.argv[at + 1]);
  // FAIL LOUDLY. `--limit banana` silently becoming "all of them" is how a spot
  // check turns into a four-minute sweep against an exchange.
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(
      `--${name} needs a positive number, got: ${String(process.argv[at + 1])}`,
    );
  }
  return value;
};

const pct = (part: number, whole: number): string =>
  whole === 0 ? '—' : `${((part / whole) * 100).toFixed(1)}%`;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** One company as the filings collection describes it. */
interface Company {
  readonly symbol: string;
  companyName: string;
  readonly isins: Set<string>;
  /** True when any filing carries NSE's own `smIndustry`. */
  nseIndustry: string | null;
  /** True when a previous run of this tool already filled one in. */
  bseIndustry: string | null;
  filings: number;
}

interface Row {
  readonly symbol?: unknown;
  readonly companyName?: unknown;
  readonly isin?: unknown;
  readonly industry?: unknown;
  readonly bseIndustry?: unknown;
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null;

/** Folds the filings collection down to one row per company. */
const foldCompanies = (rows: readonly Row[]): Map<string, Company> => {
  const companies = new Map<string, Company>();
  for (const row of rows) {
    const symbol = text(row.symbol);
    if (symbol === null) continue;

    const held = companies.get(symbol) ?? {
      symbol,
      companyName: '',
      isins: new Set<string>(),
      nseIndustry: null,
      bseIndustry: null,
      filings: 0,
    };
    held.filings += 1;
    held.companyName = text(row.companyName) ?? held.companyName;
    held.nseIndustry = held.nseIndustry ?? text(row.industry);
    held.bseIndustry = held.bseIndustry ?? text(row.bseIndustry);
    const isin = text(row.isin);
    if (isin !== null) held.isins.add(isin);
    companies.set(symbol, held);
  }
  return companies;
};

/** The BSE side: a scrip code reachable by ISIN prefix or by normalised name. */
interface ScripIndex {
  readonly byIsin: Map<string, number>;
  readonly byName: Map<string, number>;
}

const buildScripIndex = async (db: mongoose.mongo.Db): Promise<ScripIndex> => {
  const byIsin = new Map<string, number>();
  const scrips = await db
    .collection('bse_scrips')
    .find({ isin: { $ne: null } })
    .project({ _id: 0, scripCode: 1, isin: 1 })
    .toArray();
  for (const scrip of scrips) {
    const key = isinCompanyKey(text(scrip.isin));
    if (key !== null && typeof scrip.scripCode === 'number') {
      byIsin.set(key, scrip.scripCode);
    }
  }

  // The name side comes from the ANNOUNCEMENTS, not the scrips: `bse_scrips`
  // declares a `companyName` its resolver has never written, and a map built
  // from a column of nulls would report zero name matches and look like a
  // finding rather than a bug.
  const byName = new Map<string, number>();
  const announcements = await db
    .collection('bse_announcements')
    .find({})
    .project({ _id: 0, scripCode: 1, companyName: 1 })
    .toArray();
  for (const one of announcements) {
    const key = companyKey(text(one.companyName));
    if (key !== null && typeof one.scripCode === 'number') {
      byName.set(key, one.scripCode);
    }
  }

  return { byIsin, byName };
};

type MatchHow = 'isin' | 'name';

interface Match {
  readonly company: Company;
  readonly scripCode: number;
  readonly how: MatchHow;
}

/**
 * A blank company's BSE scrip, by the rules `cross-exchange-match.ts` measured.
 *
 * ISIN PREFIX FIRST AND NAME ONLY AFTER. The prefix agreed on 8 of 8 sampled
 * cross-listings where the full ISIN agreed on 6; the name key is the weaker
 * test and is reported separately so its contribution stays visible.
 */
const matchToScrip = (company: Company, index: ScripIndex): Match | null => {
  for (const isin of company.isins) {
    const key = isinCompanyKey(isin);
    const scripCode = key === null ? undefined : index.byIsin.get(key);
    if (scripCode !== undefined) return { company, scripCode, how: 'isin' };
  }
  const nameKey = companyKey(company.companyName);
  const byName = nameKey === null ? undefined : index.byName.get(nameKey);
  return byName === undefined
    ? null
    : { company, scripCode: byName, how: 'name' };
};

/** Asks BSE for each matched scrip's industry, paced. */
const fetchIndustries = async (
  matches: readonly Match[],
  client: BseClient,
  delayMs: number,
): Promise<Map<string, string>> => {
  const found = new Map<string, string>();
  let done = 0;
  for (const match of matches) {
    const industry = await client.industryForScrip(match.scripCode);
    if (industry !== null) found.set(match.company.symbol, industry);
    done += 1;
    if (done % PROGRESS_EVERY === 0 || done === matches.length) {
      write(
        `  asked ${done}/${matches.length} · industries so far ${found.size}`,
      );
    }
    if (done < matches.length) await sleep(delayMs);
  }
  return found;
};

/** The report's first two sections: what is held, and what matched. */
const reportCoverage = (
  companies: Map<string, Company>,
  blank: readonly Company[],
  matches: readonly Match[],
): void => {
  const total = companies.size;
  const withNse = [...companies.values()].filter(
    (c) => c.nseIndustry !== null,
  ).length;

  write(
    `\ncompanies ${total} · filings ${[...companies.values()].reduce((n, c) => n + c.filings, 0)}\n`,
  );
  write('1. WHAT NSE PRINTED');
  write(
    `   companies with an industry: ${withNse} of ${total} (${pct(withNse, total)})`,
  );
  write(`   blank: ${blank.length}`);

  const byIsin = matches.filter((m) => m.how === 'isin').length;
  const byName = matches.filter((m) => m.how === 'name').length;
  write('\n2. THE BLANK ONES, MATCHED TO A BSE SCRIP');
  write(
    `   matched: ${matches.length} of ${blank.length} (${pct(matches.length, blank.length)})`,
  );
  write(`     by ISIN prefix: ${byIsin} · by company name: ${byName}`);
  write(`   unmatched: ${blank.length - matches.length}`);
  write(
    '     no BSE scrip is held for these. That is the shadow lane not having',
  );
  write('     seen them announce, not BSE having no industry for them.');
};

/** The report's third section: what BSE actually answered. */
const reportIndustries = (
  matches: readonly Match[],
  found: Map<string, string>,
): void => {
  write('\n3. WHAT BSE ANSWERED');
  write(
    `   carried an industry: ${found.size} of ${matches.length} (${pct(found.size, matches.length)})`,
  );

  const values = [...found.values()];
  const longest = values.reduce((max, one) => Math.max(max, one.length), 0);
  write(
    `   distinct strings: ${new Set(values).size} · longest: ${longest} characters`,
  );

  const tally = new Map<string, number>();
  for (const one of values) tally.set(one, (tally.get(one) ?? 0) + 1);
  const top = [...tally.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, EXAMPLES);
  for (const [industry, count] of top) {
    write(`     ${String(count).padStart(4)}  ${industry}`);
  }
};

async function main(): Promise<void> {
  const config = loadConfig();
  const commit = process.argv.includes('--write');
  const delayMs = numberArg('delay', config.enrichmentRequestDelayMs);
  const limit = process.argv.includes('--limit')
    ? numberArg('limit', 0)
    : Number.POSITIVE_INFINITY;

  await mongoose.connect(config.mongoUri);
  const db = mongoose.connection.db;
  if (db === undefined) throw new Error('no database handle');

  const rows = (await db
    .collection('filings')
    .find({})
    .project({
      _id: 0,
      symbol: 1,
      companyName: 1,
      isin: 1,
      industry: 1,
      bseIndustry: 1,
    })
    .toArray()) as Row[];

  const companies = foldCompanies(rows);
  const blank = [...companies.values()].filter((c) => c.nseIndustry === null);

  const index = await buildScripIndex(db);
  const matched = blank
    .map((company) => matchToScrip(company, index))
    .filter((match): match is Match => match !== null);

  reportCoverage(companies, blank, matched);

  const asking = matched.slice(0, Math.min(matched.length, limit));
  write(
    `\n--- asking BSE for ${asking.length} scrip header(s), ${delayMs}ms apart ---`,
  );
  const found = await fetchIndustries(asking, new BseClient(), delayMs);
  reportIndustries(asking, found);

  await applyWrites(companies, found, commit);
  await mongoose.disconnect();
}

/** The fourth section, and the only place anything is written. */
async function applyWrites(
  companies: Map<string, Company>,
  found: Map<string, string>,
  commit: boolean,
): Promise<void> {
  const changed = [...found.entries()].filter(
    ([symbol, industry]) => companies.get(symbol)?.bseIndustry !== industry,
  );
  const filings = changed.reduce(
    (n, [symbol]) => n + (companies.get(symbol)?.filings ?? 0),
    0,
  );

  write('\n4. THE WRITE');
  write(
    `   companies to fill: ${changed.length} · filings to touch: ${filings}`,
  );
  for (const [symbol, industry] of changed.slice(0, EXAMPLES)) {
    write(`     ${symbol.padEnd(12)} ${industry}`);
  }

  if (changed.length === 0) {
    write(
      "   nothing to change; every matched company already carries BSE's industry",
    );
    return;
  }

  if (!commit) {
    write('\nDRY RUN. Nothing is written. Re-run with --write to apply.');
    return;
  }

  write('\n*** WRITING *** --write was given; bseIndustry will be set.');
  const model = mongoose.model<FilingDocument>('Filing', FilingSchema);
  const result = await model.bulkWrite(
    changed.map(([symbol, industry]) => ({
      updateMany: {
        filter: { symbol },
        update: { $set: { bseIndustry: industry } },
      },
    })),
    { ordered: false },
  );
  write(`   filings updated: ${result.modifiedCount} of ${filings} offered`);
  if (result.modifiedCount !== filings) {
    // Not an error — a re-run over a company whose value is unchanged modifies
    // nothing — but a silent disagreement between what was offered and what
    // moved is exactly the thing a backfill must never swallow.
    write('   WARNING: the counts disagree. Re-run to see whether it settles.');
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
