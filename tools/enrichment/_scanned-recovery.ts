/**
 * ONE-OFF. Re-reads the raster-scan filings one at a time, with Docling wired.
 *
 * WHY PER-FILING RATHER THAN ONE DRAIN. A previous-build enrichment worker is
 * running against the same collection and claims from the same queue. A sweep
 * that re-queues all 21 at once loses most of them to that worker inside a
 * second, and it re-marks them `no-text-layer` because it has no OCR parser.
 * Re-queuing one filing and claiming it in the same process closes the window
 * to microseconds.
 *
 * It uses the SAME repository call the supported tool uses
 * (`requeueUnparseable`) and the SAME worker, so nothing here is a private path
 * into the collection — only the pacing differs.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import {
  AttachmentFetcher,
  EnrichmentRepository,
  FilingSchema,
  type FilingDocument,
} from '@app/filings';
import type { TelegramService } from '@app/notify';
import { yauzlReader } from '@app/filings/pdf/yauzl-reader';
import {
  buildClaimExtractor,
  buildResultsExtractor,
} from '../../apps/ingest/src/enrichment/claim-extractor.factory';
import { buildDoclingConverter } from '../../apps/ingest/src/enrichment/docling.factory';
import { EnrichmentWorker } from '../../apps/ingest/src/enrichment/enrichment.worker';
import { FilingContextService } from '../../apps/ingest/src/enrichment/filing-context.service';
import { loadConfig } from '../../apps/ingest/src/config/configuration';

class RecordingTelegram {
  public readonly sent: string[] = [];
  async send(text: string): Promise<void> {
    this.sent.push(text);
  }
}

const main = async (): Promise<void> => {
  const config = loadConfig();
  await mongoose.connect(config.mongoUri);
  const model = mongoose.model<FilingDocument>('Filing', FilingSchema);
  const repository = new EnrichmentRepository(model);
  const telegram = new RecordingTelegram();

  const worker = new EnrichmentWorker(
    repository,
    new AttachmentFetcher(config.enrichmentMaxBytes),
    new FilingContextService(repository, config.contextWindowDays),
    telegram as unknown as TelegramService,
    {
      idleIntervalMs: config.enrichmentIdleIntervalMs,
      requestDelayMs: 0,
      batchSize: 1,
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
    yauzlReader(),
    buildResultsExtractor(config),
    buildDoclingConverter(config),
  );

  const targets = await model
    .find(
      { 'enrichment.unparseableReason': 'no-text-layer' },
      { _id: 0, seqId: 1, symbol: 1 },
    )
    .lean()
    .exec();

  process.stdout.write(`${targets.length} scanned filing(s) to re-read\n\n`);

  let recovered = 0;
  let stillScanned = 0;
  let lost = 0;

  for (const target of targets) {
    const requeued = await repository.requeueUnparseable(target.seqId);
    if (!requeued) {
      process.stdout.write(`${target.seqId} ${target.symbol}: not requeued\n`);
      continue;
    }
    await worker.tick();

    const after = await model
      .findOne({ seqId: target.seqId }, { _id: 0, enrichment: 1 })
      .lean()
      .exec();
    const enrichment = after?.enrichment;

    if (enrichment?.state === 'enriched') {
      recovered += 1;
      process.stdout.write(
        `${target.seqId} ${String(target.symbol).padEnd(11)} RECOVERED  ` +
          `route=${enrichment.parseRoute} chars=${enrichment.documentChars}\n`,
      );
    } else if (enrichment?.unparseableReason === 'no-text-layer') {
      stillScanned += 1;
      process.stdout.write(
        `${target.seqId} ${String(target.symbol).padEnd(11)} STILL BLANK ` +
          `${enrichment.lastError ?? ''}\n`,
      );
    } else {
      lost += 1;
      process.stdout.write(
        `${target.seqId} ${String(target.symbol).padEnd(11)} ` +
          `state=${enrichment?.state} reason=${enrichment?.unparseableReason}\n`,
      );
    }
  }

  process.stdout.write(
    `\nrecovered=${recovered} still-blank=${stillScanned} other=${lost} ` +
      `of ${targets.length}\n`,
  );
  await mongoose.disconnect();
};

void main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
