/**
 * Puts back on the queue the filings whose terminal verdict this pipeline no
 * longer agrees with, and says why for every filing it did and did not touch.
 *
 * WHY A TOOL RATHER THAN A MIGRATION OR A WORKER BEHAVIOUR. `unparseable` is
 * terminal by design and must stay that way — `enrichment.types.ts` argues it,
 * and without it one 213-filing-a-month category is an infinite retry loop
 * aimed at NSE. So nothing automatic may ever reopen a terminal verdict. What
 * reopens one is a person, once, after a deployment that changed how a reason
 * is handled, having read what the change was. This is that person's tool.
 *
 * The judgement it runs on is `libs/filings/src/logic/requeue-policy.ts`, which
 * is a pure function and carries the whole argument for each reason. This file
 * owns only the three things a pure function cannot see:
 *
 *   1. **WRITING IS OPT-IN.** `--dry-run` is the default and there is no way to
 *      write without typing `--write`. A tool that resets production state on a
 *      typo is not a tool, and the collection it points at is the live one.
 *   2. **THE ATTEMPT BUDGET IS A BACKSTOP.** The policy cannot tell a verdict
 *      written by the old build from one the current build reached on the
 *      merits, so a filing the new code refuses again would be admitted again
 *      by a second sweep, and a third. Each sweep costs it one `attempts`
 *      increment, so refusing a candidate that has already reached
 *      `ENRICH_MAX_ATTEMPTS` makes repeated runs converge instead of looping —
 *      and it is the same budget the worker itself would spend, not a new one.
 *      It also answers the more ordinary hazard: a filing re-queued with no
 *      headroom fails to `failed` on its first hiccup, which is a worse state
 *      than the honest `unparseable` it started in.
 *   3. **NOTHING IS SWALLOWED.** A write that throws is reported against its
 *      seqId, the sweep continues so one bad row cannot strand the rest, and
 *      the process exits non-zero. A sweep that printed a tidy summary while
 *      three writes failed would be worse than one that crashed.
 *
 * The counters are deliberately NOT reset. `EnrichmentRepository.requeueUnparseable`
 * owns that decision and argues it in full.
 *
 * Run:  npm run enrich:requeue -- [--write] [--reason R] [--limit N]
 */
import mongoose from 'mongoose';
import {
  decideRequeue,
  EnrichmentRepository,
  FilingSchema,
  type FilingDocument,
  type RequeueDecision,
  type UnparseableReason,
} from '@app/filings';
import { loadConfig } from '../../apps/ingest/src/config/configuration';

/** Every reason a filing may carry, for validating `--reason`. */
const REASONS: readonly UnparseableReason[] = [
  'no-attachment',
  'not-a-pdf',
  'untrusted-host',
  'truncated-at-origin',
  'unreadable-pdf',
  'no-text-layer',
  'oversized',
  'not-found',
  'rejected',
];

/** What the sweep reads. Deliberately narrow: it must not carry a claim. */
interface Candidate {
  readonly seqId: number;
  readonly symbol: string;
  readonly category: string;
  readonly attachmentUrl: string | null;
  readonly reason: UnparseableReason | null;
  readonly attempts: number;
  readonly parseAttempts: number;
}

/** One reason's tally, in the order an operator reads it. */
interface Tally {
  matched: number;
  admitted: number;
  budgetExhausted: number;
  requeued: number;
  failed: number;
}

const emptyTally = (): Tally => ({
  matched: 0,
  admitted: 0,
  budgetExhausted: 0,
  requeued: 0,
  failed: 0,
});

const hasFlag = (name: string): boolean => process.argv.includes(`--${name}`);

const readNumberArg = (name: string, fallback: number): number => {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = Number(process.argv[index + 1]);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`--${name} must be a finite number > 0`);
  }
  return value;
};

const readReasonArg = (): UnparseableReason | null => {
  const index = process.argv.indexOf('--reason');
  if (index === -1) return null;
  const value = process.argv[index + 1];
  // Fail loudly rather than sweeping nothing: a typo'd reason that silently
  // matched zero filings would read exactly like "there is nothing to do".
  const match = REASONS.find((reason) => reason === value);
  if (match === undefined) {
    throw new Error(
      `--reason must be one of ${REASONS.join(', ')}; got ${String(value)}`,
    );
  }
  return match;
};

const write = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

async function main(): Promise<void> {
  const config = loadConfig();
  const commit = hasFlag('write');
  const onlyReason = readReasonArg();
  const limit = readNumberArg('limit', Number.MAX_SAFE_INTEGER);
  const maxAttempts = config.enrichmentMaxAttempts;

  await mongoose.connect(config.mongoUri);

  try {
    const model = mongoose.model<FilingDocument>('Filing', FilingSchema);
    const repository = new EnrichmentRepository(model);

    const query: Record<string, unknown> = {
      'enrichment.state': 'unparseable',
    };
    if (onlyReason !== null) {
      query['enrichment.unparseableReason'] = onlyReason;
    }

    const rows = await model
      .find(query, {
        _id: 0,
        seqId: 1,
        symbol: 1,
        category: 1,
        attachmentUrl: 1,
        'enrichment.unparseableReason': 1,
        'enrichment.attempts': 1,
        'enrichment.parseAttempts': 1,
      })
      .sort({ seqId: 1 })
      .lean()
      .exec();

    const candidates: readonly Candidate[] = rows.map((row) => {
      const enrichment = (row as { enrichment?: Record<string, unknown> })
        .enrichment;
      return {
        seqId: row.seqId,
        symbol: row.symbol,
        category: row.category,
        attachmentUrl: row.attachmentUrl ?? null,
        reason: (enrichment?.unparseableReason ??
          null) as UnparseableReason | null,
        attempts: Number(enrichment?.attempts ?? 0),
        parseAttempts: Number(enrichment?.parseAttempts ?? 0),
      };
    });

    write(
      commit
        ? '*** WRITING *** --write was given; terminal verdicts will be reset.'
        : 'DRY RUN. Nothing is written. Re-run with --write to apply.',
    );
    write(
      `mongo=${config.mongoUri.replace(/\/\/[^@]*@/, '//***@')} ` +
        `candidates=${candidates.length} ` +
        `attempt-budget=${maxAttempts} ` +
        `${onlyReason === null ? 'all reasons' : `reason=${onlyReason}`}` +
        `${limit === Number.MAX_SAFE_INTEGER ? '' : ` limit=${limit}`}\n`,
    );

    const tallies = new Map<string, Tally>();
    const explanations = new Map<string, number>();
    const failures: string[] = [];
    const moved: Candidate[] = [];
    let admittedSoFar = 0;

    for (const candidate of candidates) {
      // A record in state `unparseable` with no reason is a corrupt row, not an
      // empty one. It is reported and never acted on: this tool decides from
      // the reason, and it has nothing to decide from.
      const key = candidate.reason ?? '(no reason recorded)';
      const tally = tallies.get(key) ?? emptyTally();
      tally.matched += 1;
      tallies.set(key, tally);

      if (candidate.reason === null) {
        failures.push(
          `seqId ${candidate.seqId} (${candidate.symbol}) is unparseable with ` +
            'no unparseableReason recorded; left alone',
        );
        continue;
      }

      const decision: RequeueDecision = decideRequeue({
        reason: candidate.reason,
        attachmentUrl: candidate.attachmentUrl,
        // READ FROM THIS DEPLOYMENT'S OWN CONFIGURATION, not assumed. A raster
        // scan is worth re-fetching only on a machine that has a parser able to
        // read one; on a machine with DOCLING_URL unset the same sweep would
        // spend 21 archive requests to re-measure zero characters.
        ocrAvailable: config.doclingUrl.trim().length > 0,
      });
      explanations.set(
        `${key} -> ${decision.outcome}: ${decision.explanation}`,
        (explanations.get(
          `${key} -> ${decision.outcome}: ${decision.explanation}`,
        ) ?? 0) + 1,
      );

      if (decision.outcome === 'keep') continue;

      if (candidate.attempts >= maxAttempts) {
        // Admitted by the policy and refused here. Counted apart from a `keep`
        // because they are different facts about the filing: the handling DID
        // change, and this filing has no budget left to take advantage of it.
        tally.budgetExhausted += 1;
        write(
          `  budget: seqId ${candidate.seqId} (${candidate.symbol}) has ` +
            `attempts=${candidate.attempts} against a budget of ${maxAttempts}; ` +
            'not re-queued',
        );
        continue;
      }

      tally.admitted += 1;
      admittedSoFar += 1;
      if (admittedSoFar > limit) continue;
      if (!commit) continue;

      try {
        if (await repository.requeueUnparseable(candidate.seqId)) {
          tally.requeued += 1;
          moved.push(candidate);
        } else {
          // Not a throw, and not a silence either: something moved this filing
          // between the read and the write.
          failures.push(
            `seqId ${candidate.seqId} (${candidate.symbol}) was no longer ` +
              'unparseable by the time it was written; skipped',
          );
          tally.failed += 1;
        }
      } catch (error) {
        // The sweep continues — one bad row must not strand the rest — but the
        // process will exit non-zero because of it.
        failures.push(
          `seqId ${candidate.seqId} (${candidate.symbol}) failed to re-queue: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
        tally.failed += 1;
      }
    }

    write('\n--- by reason ---');
    write(
      'reason                 matched  admitted  no-budget  requeued  errors',
    );
    for (const [reason, tally] of [...tallies].sort()) {
      write(
        `${reason.padEnd(22)} ${String(tally.matched).padStart(7)} ` +
          `${String(tally.admitted).padStart(9)} ` +
          `${String(tally.budgetExhausted).padStart(10)} ` +
          `${String(tally.requeued).padStart(9)} ` +
          `${String(tally.failed).padStart(7)}`,
      );
    }

    write('\n--- why, in the policy’s own words ---');
    for (const [line, count] of [...explanations].sort()) {
      write(`[${String(count).padStart(3)}] ${line}`);
    }

    if (moved.length > 0) {
      write('\n--- re-queued ---');
      for (const candidate of moved) {
        write(
          `${candidate.seqId} ${candidate.symbol.padEnd(12)} ` +
            `${candidate.category} <- ${candidate.reason}`,
        );
      }
    }

    if (failures.length > 0) {
      process.stderr.write('\n--- problems ---\n');
      for (const failure of failures) {
        process.stderr.write(`${failure}\n`);
      }
      throw new Error(
        `${failures.length} filing(s) could not be re-queued; see above`,
      );
    }

    if (!commit) {
      write('\nNothing was written. Re-run with --write to apply.');
    }
  } finally {
    // Always, so a failed sweep does not leave the connection open and the
    // process hanging on an unresolved handle.
    await mongoose.disconnect();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `requeue failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
