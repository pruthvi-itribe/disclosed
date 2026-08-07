/**
 * Files every stored claim under a topic, from the claim's own text.
 *
 * COSTS NOTHING. No document is fetched, no model is called, no attachment is
 * re-read. The claim text is already stored — it was matched character for
 * character against the source PDF when it was accepted — so classifying it is
 * a pure function of data we hold. Reclassifying the whole collection with a
 * model would be roughly $2 and would have to be paid again on every change of
 * mind; this is a re-run.
 *
 * WHY IT IS SAFE TO DO WITH RULES. A wrong topic FILES a claim badly. It cannot
 * publish anything false, because the verbatim gate ran upstream and is not
 * touched here — the claim's text and span are read and never written. That
 * asymmetry is the whole argument, and it is why the same reasoning would NOT
 * justify extracting claims with rules.
 *
 * Usage:
 *   npm run claims:topics -- [--today] [--dry-run]
 *
 * `--today` restricts to the current IST day, which is what a nightly run
 * wants; without it the whole collection is filed.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { IST_DAY_MS, startOfIstDay } from '@app/common';
import { claimTopic, CLAIM_TOPICS, type ClaimTopic } from '@app/filings';
import { loadConfig } from '../../apps/ingest/src/config/configuration';

interface StoredClaim {
  readonly text?: unknown;
  readonly topic?: unknown;
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
  for (const topic of CLAIM_TOPICS) tally[topic] = 0;

  const writes: {
    updateOne: {
      filter: Record<string, unknown>;
      update: Record<string, unknown>;
    };
  }[] = [];
  let claims = 0;
  let changed = 0;

  for (const row of rows) {
    const stored = ((row as { enrichment?: { claims?: unknown } }).enrichment
      ?.claims ?? []) as StoredClaim[];
    const topics: ClaimTopic[] = [];
    let rowChanged = false;

    for (const claim of stored) {
      const text = typeof claim.text === 'string' ? claim.text : '';
      const topic = claimTopic(text);
      topics.push(topic);
      tally[topic] += 1;
      claims += 1;
      if (claim.topic !== topic) rowChanged = true;
    }

    if (!rowChanged) continue;
    changed += 1;

    // ONE $set PER CLAIM POSITION rather than rewriting the claims array.
    // Replacing the array wholesale would overwrite the span, the text and the
    // period evidence with whatever this projection happened to read back —
    // and this tool has no business writing any of those.
    const update: Record<string, unknown> = {};
    for (let i = 0; i < topics.length; i += 1) {
      update[`enrichment.claims.${i}.topic`] = topics[i];
    }
    writes.push({
      updateOne: { filter: { _id: row._id }, update: { $set: update } },
    });
  }

  process.stdout.write(`claims examined: ${claims}\n\n`);
  const named = claims - tally.other;
  for (const topic of CLAIM_TOPICS) {
    if (tally[topic] === 0) continue;
    const share = claims === 0 ? 0 : (tally[topic] / claims) * 100;
    process.stdout.write(
      `  ${topic.padEnd(12)}${String(tally[topic]).padStart(5)}  ${share.toFixed(1)}%\n`,
    );
  }
  process.stdout.write(
    `\nnamed: ${named} of ${claims} (${claims === 0 ? 0 : ((named / claims) * 100).toFixed(1)}%)\n`,
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
