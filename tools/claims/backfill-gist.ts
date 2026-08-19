/**
 * Gives every over-long claim a headline, and says what it cost.
 *
 * THIS ONE CALLS A MODEL, unlike the other backfills in this folder, and
 * the header says so because `tools/` otherwise promises it does not. It
 * sends no documents: a request carries only claims already stored and
 * the spans they were matched against, so the whole backfill is a few
 * hundred thousand tokens rather than a re-extraction.
 *
 * NOTHING IT RECEIVES IS TRUSTED. Every answer goes through `verifyGist`,
 * which re-matches it against the claim's own span with the same
 * character-exact matcher that admitted the claim — a paraphrase is
 * refused, and so is a slice that drops the figure or the condition. The
 * refusal is STORED beside the claim, so a second run does not pay to be
 * told the same thing again.
 *
 * Usage:
 *   npm run claims:gist -- [--limit N] [--today] [--effort low] [--write]
 *
 * Without `--write` it reports and changes nothing, which is how a run
 * should always start: the report names every refusal by reason and
 * prints a sample of accepted headlines beside the claims they replace,
 * so a human can read them before any reader does.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import type { AnyBulkWriteOperation, ObjectId } from 'mongodb';
import { IST_DAY_MS, startOfIstDay } from '@app/common';
import {
  GIST_BATCH,
  GIST_MAX_CHARS,
  verifyGist,
  type GistRefusal,
  type GistRequestItem,
} from '@app/filings';
import { ClaudeClaimExtractor } from '../../libs/filings/src/llm/claude-claim-extractor';
import { OpenRouterClaimExtractor } from '../../libs/filings/src/llm/openrouter-claim-extractor';
import {
  claimApiKeyOf,
  loadConfig,
} from '../../apps/ingest/src/config/configuration';

interface StoredClaim {
  readonly text?: unknown;
  readonly span?: unknown;
  readonly gist?: unknown;
  readonly gistRefusal?: unknown;
}

/** One claim, addressed by the filing it sits on and its index in the array. */
interface Target {
  readonly id: string;
  /** The filing's own `_id`, carried back into the update untouched. */
  readonly filingId: ObjectId;
  readonly index: number;
  readonly text: string;
  readonly span: string;
}

const readable = (value: unknown): string =>
  typeof value === 'string' ? value : '';

async function main(): Promise<void> {
  const config = loadConfig();
  const write = process.argv.includes('--write');
  const todayOnly = process.argv.includes('--today');
  const limitAt = process.argv.indexOf('--limit');
  const limit =
    limitAt === -1
      ? Number.POSITIVE_INFINITY
      : Number(process.argv[limitAt + 1]);

  // THE PROVIDER THE OPERATOR CONFIGURED, not a hardcoded one. Both
  // adapters carry the gist lane, so this tool asks whichever the claim
  // lane already uses and with the same key — the first version reached
  // for the Anthropic key alone and refused to run on a pipeline
  // configured for OpenRouter, which is every pipeline this repo ships.
  const apiKey = claimApiKeyOf(config);
  // LOW EFFORT BY DEFAULT, AND THAT IS MEASURED. A 20-claim dry run at
  // the claim lane's `medium` burned 41,668 output tokens against 2,020
  // in — roughly 2,000 tokens of reasoning to choose a substring, which
  // is the whole of the cost at this scale. The task is bounded by a
  // gate that rejects everything outside one line, so depth buys
  // refusals rather than risk. `--effort` overrides it for a sweep.
  const effortAt = process.argv.indexOf('--effort');
  const effort = (
    effortAt === -1 ? 'low' : process.argv[effortAt + 1]
  ) as typeof config.claimEffort;
  const options = { model: config.claimModel, effort };
  const extractor =
    config.claimProvider === 'openrouter'
      ? OpenRouterClaimExtractor.fromApiKey(apiKey, options)
      : ClaudeClaimExtractor.fromApiKey(apiKey, options);
  if (extractor === null) {
    // Said once, at the start, rather than discovered per batch, and it
    // names the key the configured provider actually needs.
    throw new Error(
      `no API key for provider "${config.claimProvider}"; nothing can be proposed`,
    );
  }
  process.stdout.write(
    `provider ${config.claimProvider}, model ${config.claimModel}, effort ${effort}\n`,
  );

  await mongoose.connect(config.mongoUri);
  const db = mongoose.connection.db;
  if (db === undefined) throw new Error('no database handle');
  const filings = db.collection('filings');

  const dayStart = startOfIstDay(new Date());
  const scope = {
    'enrichment.claims.0': { $exists: true },
    ...(todayOnly
      ? {
          disseminatedAt: {
            $gte: dayStart,
            $lt: new Date(dayStart.getTime() + IST_DAY_MS),
          },
        }
      : {}),
  };

  const targets: Target[] = [];
  // NEWEST FIRST, AND THE LIMIT BOUNDS THE SCAN. The first version built
  // the whole target list before it asked anything, so `--limit 50` still
  // walked every filing in the collection — ten minutes of nothing, which
  // is indistinguishable from a hang. `disseminatedAt` is the index the
  // feed already sorts on, so a bounded run now stops as soon as it has
  // enough, and it looks at the filings a reader is most likely to open.
  const cursor = filings
    .find(scope, { projection: { 'enrichment.claims': 1 } })
    .sort({ disseminatedAt: -1 });
  let scanned = 0;
  for await (const doc of cursor) {
    scanned += 1;
    if (scanned % 500 === 0) {
      process.stdout.write(`  scanned ${scanned}, found ${targets.length}\r`);
    }
    if (targets.length >= limit) break;
    const claims = (doc as { enrichment?: { claims?: StoredClaim[] } })
      .enrichment?.claims;
    if (!Array.isArray(claims)) continue;
    claims.forEach((claim, index) => {
      const text = readable(claim.text);
      const span = readable(claim.span);
      // Already answered, either way: a stored gist or a stored refusal
      // is a question that has been asked and paid for.
      if (readable(claim.gist) !== '' || readable(claim.gistRefusal) !== '') {
        return;
      }
      // Only what is too long to be a headline. A claim that already fits
      // needs no second version of itself.
      if (text.length <= GIST_MAX_CHARS) return;
      if (span.length === 0) return;
      targets.push({
        id: `${String((doc as { _id: ObjectId })._id)}:${index}`,
        filingId: (doc as { _id: ObjectId })._id,
        index,
        text,
        span,
      });
    });
  }

  const work = targets.slice(0, Number.isFinite(limit) ? limit : undefined);
  process.stdout.write(
    `\nscanned ${scanned} filing(s); claims over ${GIST_MAX_CHARS} chars` +
      ` awaiting a headline: ${work.length}` +
      `${Number.isFinite(limit) ? ` (limit ${limit})` : ' (whole collection)'}\n`,
  );

  const byId = new Map(work.map((target) => [target.id, target]));
  const refusals = new Map<GistRefusal | 'no-answer', number>();
  const accepted: Array<{ target: Target; gist: string }> = [];
  // WHAT WAS REFUSED, NOT JUST HOW MANY. The first report counted
  // refusals and printed only what passed, so "what failed?" could not be
  // answered from it — which is the question a reader of a gate's report
  // asks first.
  const rejected: Array<{
    target: Target;
    reason: GistRefusal;
    candidate: string;
  }> = [];
  const writes: AnyBulkWriteOperation[] = [];
  let input = 0;
  let output = 0;
  let failed = 0;

  for (let at = 0; at < work.length; at += GIST_BATCH) {
    const batch = work.slice(at, at + GIST_BATCH);
    const items: GistRequestItem[] = batch.map((target) => ({
      id: target.id,
      claim: target.text,
    }));
    const reply = await extractor.proposeGists(items);
    if (reply.outcome === 'failed') {
      failed += batch.length;
      process.stdout.write(`  batch failed: ${reply.reason}\n`);
      continue;
    }
    input += reply.usage?.inputTokens ?? 0;
    output += reply.usage?.outputTokens ?? 0;

    const answered = new Set<string>();
    for (const answer of reply.answers) {
      const target = byId.get(answer.id);
      // An id that was not asked about is dropped, not guessed at: it
      // would attach a quote to a filing nobody proposed it for.
      if (target === undefined) continue;
      answered.add(answer.id);
      const verdict = verifyGist({
        candidate: answer.gist,
        claimText: target.text,
      });
      if (verdict.ok) {
        accepted.push({ target, gist: verdict.gist });
        writes.push({
          updateOne: {
            filter: { _id: target.filingId },
            update: {
              $set: {
                [`enrichment.claims.${target.index}.gist`]: verdict.gist,
              },
            },
          },
        });
      } else {
        refusals.set(verdict.refused, (refusals.get(verdict.refused) ?? 0) + 1);
        rejected.push({
          target,
          reason: verdict.refused,
          candidate: answer.gist,
        });
        writes.push({
          updateOne: {
            filter: { _id: target.filingId },
            update: {
              $set: {
                [`enrichment.claims.${target.index}.gistRefusal`]:
                  verdict.refused,
              },
            },
          },
        });
      }
    }
    for (const target of batch) {
      if (answered.has(target.id)) continue;
      refusals.set('no-answer', (refusals.get('no-answer') ?? 0) + 1);
    }
    process.stdout.write(
      `  ${Math.min(at + GIST_BATCH, work.length)}/${work.length}\r`,
    );
  }

  process.stdout.write(`\n\naccepted: ${accepted.length} of ${work.length}\n`);
  for (const [reason, count] of [...refusals].sort((a, b) => b[1] - a[1])) {
    process.stdout.write(`  refused ${reason}: ${count}\n`);
  }
  if (failed > 0)
    process.stdout.write(`  batches failed: ${failed} claim(s)\n`);
  process.stdout.write(
    `tokens: ${input} in, ${output} out over ${Math.ceil(work.length / GIST_BATCH)} request(s)\n`,
  );

  process.stdout.write('\nrefused, claim then what was proposed:\n');
  for (const { target, reason, candidate } of rejected.slice(0, 10)) {
    process.stdout.write(
      `  (${reason}) [${target.text.length}] ${target.text}\n`,
    );
    process.stdout.write(
      `      -> ${candidate === '' ? '(nothing returned)' : candidate}\n\n`,
    );
  }

  process.stdout.write('\naccepted, claim then headline:\n');
  for (const { target, gist } of accepted.slice(0, 12)) {
    process.stdout.write(`  [${target.text.length}] ${target.text}\n`);
    process.stdout.write(`  [${gist.length}] ${gist}\n\n`);
  }

  if (!write) {
    process.stdout.write(
      `--write not given: ${writes.length} claim(s) would change\n`,
    );
    await mongoose.disconnect();
    return;
  }

  if (writes.length > 0) {
    const result = await filings.bulkWrite(writes, { ordered: false });
    process.stdout.write(`claims updated: ${result.modifiedCount}\n`);
  } else {
    process.stdout.write('nothing to change\n');
  }
  await mongoose.disconnect();
}

void main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
