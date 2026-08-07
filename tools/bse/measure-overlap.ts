/**
 * Drains BSE for a set of IST days, stores it in the shadow collection, and
 * reports how much of it we already had from NSE.
 *
 * THIS TOOL IS THE POINT OF THE SHADOW LANE. Everything about a second exchange
 * turns on one number nobody has: what fraction of BSE is genuinely new. If it
 * is small, BSE is a latency play and the merge has to be careful about
 * duplicates. If it is large, BSE is a coverage play and the duplicates are a
 * side issue. The first real drain already suggests the second — BSE served
 * 2,080 announcements for 2026-08-06 where NSE gave us 1,156 — but a count of
 * rows is not a count of DISTINCT EVENTS, and only the matcher can tell those
 * apart.
 *
 * Costs no model calls and downloads no documents. The strongest match tier
 * compares byte counts BOTH exchanges advertise, so a duplicate is identified
 * without fetching either file.
 *
 * Usage:
 *   npm run bse:overlap -- [--days 3] [--no-store]
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import {
  BseAnnouncementSchema,
  BseClient,
  BseRepository,
  bestMatch,
  FilingSchema,
  isinCompanyKey,
  matchAcrossExchanges,
  DISSEMINATION_WINDOW_MS,
  type BseAnnouncement,
  type CrossExchangeCandidate,
  type FilingDocument,
} from '@app/filings';
import { loadConfig } from '../../apps/ingest/src/config/configuration';

const readArg = (name: string, fallback: number): number => {
  const at = process.argv.indexOf(`--${name}`);
  if (at === -1) return fallback;
  const value = Number(process.argv[at + 1]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Start of the IST day `back` days before `from`, as an instant. */
const istDay = (from: Date, back: number): Date =>
  new Date(from.getTime() - back * 24 * 60 * 60 * 1000);

const pct = (part: number, whole: number): string =>
  whole === 0 ? '—' : `${((part / whole) * 100).toFixed(1)}%`;

async function main(): Promise<void> {
  const config = loadConfig();
  const days = readArg('days', 3);
  const store = !process.argv.includes('--no-store');

  await mongoose.connect(config.mongoUri);
  const filings = mongoose.model<FilingDocument>('Filing', FilingSchema);
  const bseModel = mongoose.model<BseAnnouncement>(
    'BseAnnouncement',
    BseAnnouncementSchema,
  );
  const repository = new BseRepository(bseModel);
  await repository.assertIndexes();

  const client = new BseClient({
    warn: (message) => process.stdout.write(`WARN ${message}\n`),
  });

  const now = new Date();
  const collected: BseAnnouncement[] = [];

  process.stdout.write(`--- draining ${days} IST day(s) from BSE ---\n`);
  for (let back = 0; back < days; back += 1) {
    const day = istDay(now, back);
    const result = await client.fetchDay(day, now);
    const label = new Date(day.getTime() + IST_OFFSET_MS)
      .toISOString()
      .slice(0, 10);

    process.stdout.write(
      `${label}  ${String(result.announcements.length).padStart(5)} collected  ` +
        `ROWCNT ${String(result.totalForRange ?? -1).padStart(5)}  ` +
        `${String(result.pages).padStart(3)} page(s)  ` +
        `skipped ${result.skipped}  ` +
        `${result.complete ? 'COMPLETE' : 'SHORT'}\n`,
    );

    collected.push(...result.announcements);
    if (store) {
      const written = await repository.insertNew(result.announcements);
      process.stdout.write(`           stored ${written.length} new\n`);
    }
  }

  // The ISIN a scrip resolves to, looked up once per company rather than once
  // per announcement: a busy company files a dozen times a day and the lookup
  // is a request to the exchange.
  process.stdout.write(
    `\n--- resolving ISINs for ${
      new Set(collected.map((a) => a.scripCode)).size
    } scrip code(s) ---\n`,
  );
  const isinFor = new Map<number, string | null>();
  for (const scrip of new Set(collected.map((a) => a.scripCode))) {
    isinFor.set(scrip, await client.isinForScrip(scrip));
    await new Promise((resolve) =>
      setTimeout(resolve, config.enrichmentRequestDelayMs),
    );
  }
  const resolved = [...isinFor.values()].filter((v) => v !== null).length;
  process.stdout.write(`resolved ${resolved} of ${isinFor.size}\n`);

  process.stdout.write('\n--- matching against what NSE already gave us ---\n');
  const tally: Record<string, number> = {
    'same-document': 0,
    'same-event': 0,
    'same-company': 0,
    none: 0,
  };
  let bseFirst = 0;
  let nseFirst = 0;
  const leads: number[] = [];

  for (const item of collected) {
    const isin = isinFor.get(item.scripCode) ?? null;
    const key = isinCompanyKey(isin);

    // Candidates: the same company's NSE filings inside the window. Matched on
    // the ISIN PREFIX, because the full ISIN disagrees across exchanges on a
    // quarter of companies.
    const query: Record<string, unknown> = {
      disseminatedAt: {
        $gte: new Date(item.disseminatedAt.getTime() - DISSEMINATION_WINDOW_MS),
        $lte: new Date(item.disseminatedAt.getTime() + DISSEMINATION_WINDOW_MS),
      },
    };
    if (key !== null) query.isin = new RegExp(`^${key}`);
    else
      query.companyName = new RegExp(
        `^${item.companyName.slice(0, 10).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
        'i',
      );

    const nseRows = (await filings
      .find(query)
      .select({
        isin: 1,
        companyName: 1,
        category: 1,
        disseminatedAt: 1,
      })
      .lean()
      .exec()) as unknown as FilingDocument[];

    const candidates: CrossExchangeCandidate[] = nseRows.map((filing) =>
      matchAcrossExchanges({
        filing,
        // NSE's byte count is not stored today, so the strongest tier is
        // unreachable from this side. Stated rather than worked around: it is
        // one field on the fetch path, and adding it is what would let a
        // duplicate be identified without downloading anything.
        filingBytes: null,
        announcement: item,
        announcementIsin: isin,
      }),
    );

    const best = bestMatch(candidates);
    const confidence = best?.confidence ?? 'none';
    tally[confidence] += 1;
    if (best !== null) {
      leads.push(best.bseLeadMs);
      if (best.bseLeadMs > 0) bseFirst += 1;
      else nseFirst += 1;
    }
  }

  const total = collected.length;
  const matched = total - tally.none;

  process.stdout.write(`\nBSE announcements examined   ${total}\n`);
  process.stdout.write(
    `  matched to an NSE filing   ${matched}  (${pct(matched, total)})\n`,
  );
  for (const tier of ['same-document', 'same-event', 'same-company'] as const) {
    process.stdout.write(
      `    ${tier.padEnd(15)}          ${String(tally[tier]).padStart(5)}  (${pct(tally[tier], total)})\n`,
    );
  }
  process.stdout.write(
    `  NOT on NSE at all          ${tally.none}  (${pct(tally.none, total)})\n`,
  );

  if (leads.length > 0) {
    const sorted = [...leads].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] / 1000;
    process.stdout.write(
      `\nof the matched pairs: BSE first ${bseFirst}, NSE first ${nseFirst}, ` +
        `median lead ${median.toFixed(0)}s\n`,
    );
  }

  process.stdout.write(
    `\nThe number that matters is "NOT on NSE at all": it is the coverage a ` +
      `second exchange buys.\nThe matched count is what a merge must suppress ` +
      `before enrichment, or pay a model call for twice.\n`,
  );

  await mongoose.disconnect();
}

void main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
