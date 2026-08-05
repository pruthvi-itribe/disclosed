import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import type { FilingDocument } from '@app/filings';
import { describeConfig, loadConfig } from './config/configuration';
import { FILING_MODEL, IngestModule } from './ingest.module';
import { PollerService } from './poller/poller.service';

const logger = new Logger('bootstrap');

/**
 * `String()` is not total: an object with a null prototype has neither
 * `Symbol.toPrimitive` nor `toString`, so it raises "Cannot convert object to
 * primitive value". Both callers are catch blocks — one of them the top-level
 * bootstrap handler — so a throw here would replace the diagnostic with an
 * unhandled rejection and lose the only account of why the process died.
 */
const describe = (error: unknown): string => {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  try {
    return String(error);
  } catch {
    return '[unprintable]';
  }
};

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

  let closing = false;
  const shutdown = async (signal: string): Promise<void> => {
    // A second Ctrl-C must not start a second teardown.
    if (closing) return;
    closing = true;

    logger.log(`${signal} received, stopping poller`);
    // `stop()` cuts the sleep short, so a shutdown during the 30s idle interval
    // does not present as a hung process to whatever is waiting on the exit.
    poller.stop();

    try {
      await app.close();
    } catch (error) {
      logger.error(`Shutdown failed: ${describe(error)}`);
    }
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  logger.log('Starting ingest poll loop');
  // `start()` runs the startup checks — the unique-index assertion first — and
  // then loops until `stop()`. A failed assertion rejects here and stops the
  // process, which is the intended outcome: without that index every re-seen
  // filing reads as new and a restart re-alerts the whole day.
  await poller.start();
}

void bootstrap().catch((error: unknown) => {
  logger.error(
    `Ingest failed to start: ${describe(error)}`,
    error instanceof Error ? error.stack : undefined,
  );
  process.exit(1);
});
