import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { describeError, stackOf } from '@app/common';
import type { FilingDocument } from '@app/filings';
import { describeConfig, loadConfig } from './config/configuration';
import { EnrichmentWorker } from './enrichment/enrichment.worker';
import { FILING_MODEL, IngestModule } from './ingest.module';
import { PollerService } from './poller/poller.service';

const logger = new Logger('bootstrap');

async function bootstrap(): Promise<void> {
  // Creating the context runs `loadConfig`, so a malformed setting stops the
  // process here — before a connection is opened or a single poll is issued.
  const app = await NestFactory.createApplicationContext(IngestModule);

  // The effective configuration, once, with the secrets named but not printed.
  // `ConfigModule` has already merged any `.env` file into `process.env`, so
  // this reads exactly what the container resolved. A default that silently
  // applied is otherwise indistinguishable from a setting that was read, until
  // the poller behaves in a way nobody expected.
  logger.log(describeConfig(loadConfig()));

  // Waits for mongoose to finish building the indexes the SCHEMA declares,
  // including the unique one on seqId. This is not the app creating an index
  // behind the operator's back: the declaration lives in `filing.schema.ts` and
  // mongoose builds it on connect either way. Awaiting it only removes the race
  // where `assertIndexes()` inspects the collection mid-build and reports a
  // missing index that is milliseconds away from existing.
  await app.get<Model<FilingDocument>>(getModelToken(FILING_MODEL)).init();

  const poller = app.get(PollerService);
  const enrichment = app.get(EnrichmentWorker);
  const config = loadConfig();

  let closing = false;
  const shutdown = async (signal: string): Promise<void> => {
    // A second Ctrl-C must not start a second teardown.
    if (closing) return;
    closing = true;

    logger.log(`${signal} received, stopping poller and enrichment worker`);
    // `stop()` cuts the sleep short, so a shutdown during the 30s idle interval
    // does not present as a hung process to whatever is waiting on the exit.
    poller.stop();
    enrichment.stop();

    try {
      await app.close();
    } catch (error) {
      logger.error(`Shutdown failed: ${describeError(error)}`);
    }
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  // DETACHED, and deliberately so. The attachment worker is a second loop in
  // the same process, and it must not be able to stop the poller: its failures
  // cost an amount, the poller's failures cost a filing. It is contained by its
  // own `tick()` contract, so this catch is the last resort for a rejection
  // that escapes `start()` itself.
  if (config.enrichmentEnabled) {
    void enrichment.start().catch((error: unknown) => {
      logger.error(
        `Enrichment worker stopped: ${describeError(error)}`,
        stackOf(error),
      );
    });
  } else {
    logger.warn(
      'ENRICH_ENABLED is off: source PDFs will not be read, so no filing ' +
        'will carry an amount, a counterparty or a composed headline.',
    );
  }

  logger.log('Starting ingest poll loop');
  // `start()` runs the startup checks — the unique-index assertion first — and
  // then loops until `stop()`. A failed assertion rejects here and stops the
  // process, which is the intended outcome: without that index every re-seen
  // filing reads as new and a restart re-alerts the whole day.
  await poller.start();
}

void bootstrap().catch((error: unknown) => {
  logger.error(
    `Ingest failed to start: ${describeError(error)}`,
    stackOf(error),
  );
  process.exit(1);
});
