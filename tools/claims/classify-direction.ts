/**
 * Files every stored claim under the movement its own SPAN printed.
 *
 * COSTS NOTHING. No document is fetched, no model is called, no attachment is
 * re-read. The span is already stored — it is the source document's own bytes,
 * matched character for character when the claim was accepted — so reading a
 * direction out of it is a pure function of data we hold. A model pass over a
 * collection this size would be roughly $2 and would have to be paid again on
 * every change of mind; this is a re-run.
 *
 * WHY IT IS SAFE TO DO WITH RULES, AND WHY IT READS THE SPAN. A wrong tag
 * MISLABELS a claim that is already verified; it cannot publish anything false,
 * because the verbatim gate ran upstream and is not touched here — `span` and
 * `text` are read and never written. That argument only holds while the tag
 * comes from the document's characters: a direction read off the model's
 * compressed `text` could assert a movement the filing never printed, which is
 * a publication rather than a filing decision. See `claim-direction.ts`.
 *
 * Usage:
 *   npm run claims:direction -- [--today] [--dry-run]
 *
 * `--today` restricts to the current IST day, which is what a nightly run
 * wants; without it the whole collection is filed.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { IST_DAY_MS, startOfIstDay } from '@app/common';
import {
  claimDirection,
  CLAIM_DIRECTIONS,
  type ClaimDirection,
} from '@app/filings';
import { loadConfig } from '../../apps/ingest/src/config/configuration';

interface StoredClaim {
  readonly span?: unknown;
  readonly direction?: unknown;
  readonly directionEvidence?: unknown;
}

interface Reading {
  readonly direction: ClaimDirection;
  readonly evidence: string | null;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const todayOnly = process.argv.includes('--today');
  const dryRun = process.argv.includes('--dry-run');

  await mongoose.connect(config.mongoUri);
  const db = mongoose.connection.db;
  if (db === undefined) throw new Error('no database handle');
  const filings = db.collection('filings');

  const now = new Date();
  const dayStart = startOfIstDay(now);
  // Bounded at BOTH ends, like every other IST window in this codebase: an
  // open-ended range folds a filing dated into the future into today's work.
  const scope = todayOnly
    ? {
        disseminatedAt: {
          $gte: dayStart,
          $lt: new Date(dayStart.getTime() + IST_DAY_MS),
        },
        'enrichment.claims.0': { $exists: true },
      }
    : { 'enrichment.claims.0': { $exists: true } };

  const rows = await filings
    .find(scope)
    .project({ _id: 1, seqId: 1, 'enrichment.claims': 1 })
    .toArray();

  process.stdout.write(
    `${todayOnly ? "today's" : 'all'} claim-bearing filings: ${rows.length}\n`,
  );

  const tally: Record<string, number> = {};
  for (const direction of CLAIM_DIRECTIONS) tally[direction] = 0;

  const writes: {
    updateOne: {
      filter: Record<string, unknown>;
      update: Record<string, unknown>;
    };
  }[] = [];
  let claims = 0;
  let unclassified = 0;
  let changed = 0;

  for (const row of rows) {
    const stored = ((row as { enrichment?: { claims?: unknown } }).enrichment
      ?.claims ?? []) as StoredClaim[];
    const readings: Reading[] = [];
    let rowChanged = false;

    for (const claim of stored) {
      const span = typeof claim.span === 'string' ? claim.span : '';
      const reading = claimDirection(span);
      const evidence = reading.evidence === '' ? null : reading.evidence;
      readings.push({ direction: reading.direction, evidence });
      tally[reading.direction] += 1;
      claims += 1;
      // "Never classified" is a different fact from "classified as unrated",
      // and only the first is what this run is here to fix. Counted so the
      // before/after is a number rather than an impression.
      if (typeof claim.direction !== 'string') unclassified += 1;
      if (
        claim.direction !== reading.direction ||
        (claim.directionEvidence ?? null) !== evidence
      ) {
        rowChanged = true;
      }
    }

    if (!rowChanged) continue;
    changed += 1;

    // ONE $set PER CLAIM POSITION rather than rewriting the claims array.
    // Replacing the array wholesale would overwrite the span, the text and the
    // period evidence with whatever this projection happened to read back —
    // and this tool has no business writing any of those.
    const update: Record<string, unknown> = {};
    for (let i = 0; i < readings.length; i += 1) {
      update[`enrichment.claims.${i}.direction`] = readings[i].direction;
      update[`enrichment.claims.${i}.directionEvidence`] = readings[i].evidence;
    }
    writes.push({
      updateOne: { filter: { _id: row._id }, update: { $set: update } },
    });
  }

  process.stdout.write(
    `claims examined: ${claims} (${unclassified} carried no direction)\n\n`,
  );
  for (const direction of CLAIM_DIRECTIONS) {
    const share = claims === 0 ? 0 : (tally[direction] / claims) * 100;
    process.stdout.write(
      `  ${direction.padEnd(12)}${String(tally[direction]).padStart(5)}  ${share.toFixed(1)}%\n`,
    );
  }
  const tagged = claims - tally.unrated;
  process.stdout.write(
    `\ntagged: ${tagged} of ${claims} (${claims === 0 ? 0 : ((tagged / claims) * 100).toFixed(1)}%)\n`,
  );

  if (dryRun) {
    process.stdout.write(
      `\n--dry-run: ${writes.length} filing(s) would change\n`,
    );
    await mongoose.disconnect();
    return;
  }

  if (writes.length > 0) {
    const result = await filings.bulkWrite(writes, { ordered: false });
    process.stdout.write(
      `\nfilings updated: ${result.modifiedCount} of ${changed} offered\n`,
    );
    if (result.modifiedCount !== changed) {
      // Never silent. A count that does not add up means some filing was not
      // filed, and guessing which is worse than saying so.
      process.stdout.write(
        'WARNING: modifiedCount disagrees with the number offered\n',
      );
    }
  } else {
    process.stdout.write('\nnothing to change; every claim already filed\n');
  }

  await mongoose.disconnect();
}

void main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
