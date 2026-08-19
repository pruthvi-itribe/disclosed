/**
 * Puts every stored gist back through the gate it passed under, and clears
 * the ones the gate no longer accepts.
 *
 * WHY DATA HAS TO MOVE AND NOT JUST CODE. A stored gist is published: it is
 * the Brief card's headline and the notification's whole body. When a rule in
 * `claim-gist.ts` tightens, the code stops the NEXT bad slice and does nothing
 * about the ones already on the page — indistinguishable from a sound one, and
 * there until somebody reads it. Same argument, same remedy, as
 * `purge-unprinted-direction.ts`.
 *
 * The first `--write` backfill is what this was written for: a comma counted
 * as a sentence boundary, so for
 *
 *   "Expanding presence in Saudi Arabia, Kenya and other African markets…"
 *
 * the model was allowed to begin at "Kenya", and the headline dropped the
 * country listed first while reading as the whole of what was said.
 *
 * COSTS NOTHING AND CALLS NOTHING. No model, no document: the claim's `text`
 * and its `gist` are both stored, and the predicate is `verifyGist` itself,
 * imported rather than restated. A second copy of the rule here would be a
 * second rule.
 *
 * ================================================================
 * IT CLEARS, IT DOES NOT REWRITE
 * ================================================================
 *
 * A failing gist has `gist` and `gistRefusal` both set back to null — the
 * "never asked" state — so the next `claims:gist` run asks about the claim
 * again and the model may propose a different, legal slice. Writing the
 * refusal instead would be cheaper and wrong: the model was never asked under
 * this rule, so recording that it failed it would put words in its mouth and
 * make the claim ineligible forever.
 *
 * ONLY ACCEPTED GISTS ARE RE-READ. A stored refusal stays a refusal: rules
 * only ever turn an accept into a refusal, never the reverse, so re-checking
 * them would cost a scan to confirm what is already known.
 *
 * The claim itself is untouched. This tool has no opinion about claims — only
 * about the shorter version of one.
 *
 * RE-RUNNABLE. A cleared claim has no gist to re-read, so a second run finds
 * nothing and writes nothing.
 *
 * Usage:
 *   npm run claims:revalidate-gist -- [--write]
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { verifyGist } from '@app/filings';
import { loadConfig } from '../../apps/ingest/src/config/configuration';

interface StoredClaim {
  readonly text?: unknown;
  readonly gist?: unknown;
}

interface Row {
  readonly _id: unknown;
  readonly symbol: string;
  readonly seqId: number;
  readonly enrichment?: { readonly claims?: readonly StoredClaim[] };
}

const readable = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

async function main(): Promise<void> {
  const config = loadConfig();
  const write = process.argv.includes('--write');

  await mongoose.connect(config.mongoUri);
  const db = mongoose.connection.db;
  if (db === undefined) throw new Error('no database handle');
  const filings = db.collection('filings');

  const rows = (await filings
    .find(
      { 'enrichment.claims.gist': { $type: 'string' } },
      {
        projection: {
          _id: 1,
          symbol: 1,
          seqId: 1,
          'enrichment.claims.text': 1,
          'enrichment.claims.gist': 1,
        },
      },
    )
    .toArray()) as unknown as readonly Row[];

  let held = 0;
  let cleared = 0;
  const writes: {
    updateOne: {
      filter: Record<string, unknown>;
      update: Record<string, unknown>;
    };
  }[] = [];

  for (const row of rows) {
    const claims = row.enrichment?.claims ?? [];
    const unset: Record<string, null> = {};

    claims.forEach((claim, index) => {
      const gist = readable(claim.gist);
      if (gist === '') return;
      held += 1;
      const verdict = verifyGist({
        candidate: gist,
        claimText: readable(claim.text),
      });
      if (verdict.ok) return;

      cleared += 1;
      process.stdout.write(
        `  (${verdict.refused}) ${row.symbol} seq ${row.seqId}\n` +
          `      claim: ${readable(claim.text)}\n` +
          `      gist:  ${gist}\n`,
      );
      unset[`enrichment.claims.${index}.gist`] = null;
      unset[`enrichment.claims.${index}.gistRefusal`] = null;
    });

    if (Object.keys(unset).length === 0) continue;
    writes.push({
      updateOne: { filter: { _id: row._id }, update: { $set: unset } },
    });
  }

  process.stdout.write(
    `\n${held} stored gist(s) re-read; ${cleared} no longer pass, ` +
      `across ${writes.length} filing(s)\n`,
  );

  if (!write) {
    process.stdout.write('--write not given: nothing cleared\n');
    await mongoose.disconnect();
    return;
  }

  if (writes.length > 0) {
    const result = await filings.bulkWrite(writes, { ordered: false });
    process.stdout.write(`filings updated: ${result.modifiedCount}\n`);
    if (result.modifiedCount !== writes.length) {
      // Never silent. A count that does not add up means a headline this tool
      // said it would take down is still on a card.
      process.stdout.write(
        'WARNING: modifiedCount disagrees with the number offered\n',
      );
    }
  }

  await mongoose.disconnect();
}

void main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
