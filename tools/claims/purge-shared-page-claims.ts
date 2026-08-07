/**
 * Applies the shared-page gate to claims that were stored before it existed.
 *
 * WHY DATA HAS TO MOVE AND NOT JUST CODE. `claim-eligibility.ts` now refuses a
 * document that names four or more companies, because the verbatim gate proves
 * a sentence is IN a document and says nothing about whose sentence it is. That
 * stops the next one. It does nothing about the ones already on the dashboard,
 * and one of those is wrong: SANOFI INDIA LIMITED, a pharmaceutical company,
 * carries "Shareholders approved MOA alteration to include telecom and
 * communication cables business" — another company's notice on the newspaper
 * page Sanofi filed.
 *
 * A stored claim the pipeline would now refuse is worse than one it never made.
 * It is indistinguishable from a verified one and it will stay on the page
 * until somebody notices, which is the failure mode this whole gate exists to
 * end.
 *
 * COSTS NOTHING AND CALLS NOTHING. The document text is read from the same
 * on-disk cache the measurement tools populate; a filing whose text is not
 * cached is REPORTED AND LEFT ALONE rather than re-fetched, because a tool that
 * quietly reaches for the network is a tool nobody can predict the cost of.
 * Re-running it after the cache fills finishes the job.
 *
 * WHAT IT WRITES. The claims, the claim line and the claim discards are cleared
 * and `coverageSkip` is set to `shared-page`, which is exactly the state the
 * worker would have produced had the gate existed when the filing was read. The
 * filing keeps its outcome, its category group and its amount: this refuses an
 * attribution, not a document.
 *
 * Usage:
 *   npm run claims:purge-shared -- [--dry-run]
 */
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import mongoose from 'mongoose';
import { companyIdentitiesIn, isSharedPage } from '@app/filings';
import { loadConfig } from '../../apps/ingest/src/config/configuration';

/** The same cache `measure-ambiguity-scope.ts` writes, keyed the same way. */
const CACHE_DIR = 'data/corpus/.ambiguity-scope-cache';

const cachePath = (seqId: number): string =>
  join(
    CACHE_DIR,
    `${createHash('sha256').update(String(seqId)).digest('hex').slice(0, 16)}.txt`,
  );

interface Row {
  readonly seqId: number;
  readonly symbol: string;
  readonly category: string;
  readonly enrichment?: { readonly claims?: readonly { text?: string }[] };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const dryRun = process.argv.includes('--dry-run');

  await mongoose.connect(config.mongoUri);
  const db = mongoose.connection.db;
  if (db === undefined) throw new Error('no database handle');
  const filings = db.collection('filings');

  const rows = (await filings
    .find(
      { 'enrichment.claims.0': { $exists: true } },
      {
        projection: {
          _id: 0,
          seqId: 1,
          symbol: 1,
          category: 1,
          'enrichment.claims.text': 1,
        },
      },
    )
    .toArray()) as unknown as readonly Row[];

  let uncached = 0;
  let shared = 0;
  let claimsCleared = 0;
  const writes: { seqId: number }[] = [];

  for (const row of rows) {
    const path = cachePath(row.seqId);
    if (!existsSync(path)) {
      uncached += 1;
      continue;
    }
    const text = readFileSync(path, 'utf8');
    if (!isSharedPage(text)) continue;

    shared += 1;
    const claims = row.enrichment?.claims ?? [];
    claimsCleared += claims.length;
    writes.push({ seqId: row.seqId });
    process.stdout.write(
      `${row.symbol.padEnd(12)} seq ${row.seqId}  ` +
        `${String(companyIdentitiesIn(text).size).padStart(2)} companies  ` +
        `${claims.length} claim(s)  ${row.category}\n`,
    );
    for (const claim of claims) {
      process.stdout.write(`    - ${(claim.text ?? '').slice(0, 96)}\n`);
    }
  }

  process.stdout.write(
    `\n${rows.length} filing(s) hold claims; ${uncached} have no text on disk ` +
      `and were left alone.\n${shared} sit on a shared page, carrying ` +
      `${claimsCleared} claim(s).\n`,
  );

  if (dryRun) {
    process.stdout.write('\n--dry-run: nothing written\n');
    await mongoose.disconnect();
    return;
  }

  if (writes.length > 0) {
    const result = await filings.bulkWrite(
      writes.map((write) => ({
        updateOne: {
          filter: { seqId: write.seqId },
          update: {
            $set: {
              'enrichment.claims': [],
              'enrichment.claimLine': null,
              'enrichment.claimDiscards': [],
              'enrichment.coverageSkip': 'shared-page',
            },
          },
        },
      })),
    );
    process.stdout.write(`\nfilings updated: ${result.modifiedCount}\n`);
  }

  await mongoose.disconnect();
}

void main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
