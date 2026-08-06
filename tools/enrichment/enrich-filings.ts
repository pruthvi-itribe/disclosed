/**
 * Runs the background attachment worker against the live filings collection,
 * from the command line, and prints what it found.
 *
 * WHY THIS EXISTS AS A TOOL AND NOT ONLY AS A SERVICE. The worker inside
 * `apps/ingest` starts with the poller and drains continuously, which is the
 * right shape in production and the wrong shape for two other jobs:
 *
 *   1. **Backfilling.** A collection that predates enrichment holds thousands
 *      of filings whose PDFs have never been read. Draining them at the
 *      service's polite pace is hours of work that should not be tangled up
 *      with a restart of the process that must not miss a filing.
 *   2. **Showing the thing working.** Every number in the report this task
 *      produces comes from here, against real documents NSE actually served.
 *
 * It uses the SAME worker class, the same fetcher, the same repository and the
 * same politeness pacing as the service. The only substitution is Telegram: a
 * recorder stands in for the real sender, so a backfill of a thousand filings
 * cannot flood a chat, and the messages it would have sent are printed instead.
 *
 * Run:  npx ts-node -r tsconfig-paths/register tools/enrichment/enrich-filings.ts [--limit N] [--delay MS]
 */
import mongoose from 'mongoose';
import {
  AttachmentFetcher,
  EnrichmentRepository,
  FilingSchema,
  type FilingDocument,
} from '@app/filings';
import type { TelegramService } from '@app/notify';
import { buildClaimExtractor } from '../../apps/ingest/src/enrichment/claim-extractor.factory';
import { EnrichmentWorker } from '../../apps/ingest/src/enrichment/enrichment.worker';
import { FilingContextService } from '../../apps/ingest/src/enrichment/filing-context.service';
import { loadConfig } from '../../apps/ingest/src/config/configuration';

/** Stands in for Telegram: records what would have been sent, sends nothing. */
class RecordingTelegram {
  public readonly sent: string[] = [];

  async send(text: string): Promise<void> {
    this.sent.push(text);
  }
}

const readArg = (name: string, fallback: number): number => {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = Number(process.argv[index + 1]);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`--${name} must be a finite number >= 0`);
  }
  return value;
};

async function main(): Promise<void> {
  const config = loadConfig();
  const limit = readArg('limit', 50);
  const delayMs = readArg('delay', config.enrichmentRequestDelayMs);

  await mongoose.connect(config.mongoUri);
  const model = mongoose.model<FilingDocument>('Filing', FilingSchema);

  // The claim query and the derived-context counts each need an index, and this
  // tool may well be the first thing to run after the schema changed.
  //
  // DELIBERATELY NOT `syncIndexes()`. That reconciles the collection against
  // the schema, which means dropping and recreating any index whose spec has
  // drifted — including the unique one on `seqId`. A live poller inserting
  // during that window would have every re-seen filing accepted as new, and a
  // restart would re-alert the whole day. `createIndex` is idempotent and
  // additive, and it cannot drop anything.
  await model.collection.createIndex(
    { 'enrichment.state': 1, disseminatedAt: -1 },
    { name: 'enrichment_state_1_disseminatedAt_-1' },
  );
  await model.collection.createIndex(
    { symbol: 1, category: 1, disseminatedAt: -1 },
    { name: 'symbol_1_category_1_disseminatedAt_-1' },
  );

  const repository = new EnrichmentRepository(model);
  const telegram = new RecordingTelegram();
  const worker = new EnrichmentWorker(
    repository,
    new AttachmentFetcher(config.enrichmentMaxBytes),
    new FilingContextService(repository, config.contextWindowDays),
    telegram as unknown as TelegramService,
    {
      idleIntervalMs: config.enrichmentIdleIntervalMs,
      requestDelayMs: delayMs,
      batchSize: limit,
      maxAttempts: config.enrichmentMaxAttempts,
      retryBaseMs: config.enrichmentRetryBaseMs,
      retryMaxMs: config.enrichmentRetryMaxMs,
      parseWindowMs: config.enrichmentParseWindowMs,
      maxParseAttempts: config.enrichmentMaxParseAttempts,
      parseRetryBaseMs: config.enrichmentParseRetryBaseMs,
      leaseMs: config.enrichmentLeaseMs,
      alertWindowMs: config.alertWindowMs,
      watchlist: config.watchlist,
      maxClaims: config.claimMaxClaims,
    },
    undefined,
    buildClaimExtractor(config),
  );

  const pendingBefore = await repository.pendingCount(new Date());
  process.stdout.write(
    `queue: ${pendingBefore} filing(s) awaiting a read; ` +
      `draining up to ${limit} at ${delayMs}ms apart\n\n`,
  );

  const started = Date.now();
  const result = await worker.tick();
  const elapsed = Date.now() - started;

  process.stdout.write(
    `claimed=${result.claimed} enriched=${result.enriched} ` +
      `(amount refused on ${result.refused}) unparseable=${result.unparseable} ` +
      `parse-retried=${result.parseRetried} ` +
      `retried=${result.retried} failed=${result.failed} ` +
      `would-alert=${result.alerted} in ${(elapsed / 1000).toFixed(1)}s\n`,
  );

  if (telegram.sent.length > 0) {
    process.stdout.write('\n--- messages the worker would have sent ---\n');
    for (const message of telegram.sent) {
      process.stdout.write(`\n${message}\n`);
    }
  }

  const tally = await repository.tallyByState();
  process.stdout.write('\n--- collection by enrichment state ---\n');
  for (const row of tally) {
    process.stdout.write(`${row.state.padEnd(14)} ${row.count}\n`);
  }

  await mongoose.disconnect();
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `enrichment run failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
