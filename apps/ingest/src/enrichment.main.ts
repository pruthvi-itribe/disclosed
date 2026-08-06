import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import type { FilingDocument } from '@app/filings';
import { describeConfig, loadConfig } from './config/configuration';
import { EnrichmentWorker } from './enrichment/enrichment.worker';
import { runEnrichmentLane } from './enrichment/enrichment.lane';
import { FILING_MODEL, IngestModule } from './ingest.module';

/**
 * The enrichment lane's entrypoint: the real world, handed to `runEnrichmentLane`.
 *
 * Everything with a decision in it lives in `enrichment/enrichment.lane.ts` and
 * is tested there. What is left here is the four things a test cannot supply —
 * a Nest container, the signal table, the exit code and a logger — and it is
 * kept to exactly those, because this file is not reachable by any test and so
 * every line of behaviour in it is a line nothing checks. `main.ts` is the
 * cautionary example: its shutdown re-entrancy latch is real behaviour that no
 * test covers.
 */
const logger = new Logger('enrichment');

void runEnrichmentLane({
  logger,
  onSignal: (signal, handler) => {
    process.on(signal, handler);
  },
  exit: (code) => process.exit(code),
  createContext: async () => {
    const app = await NestFactory.createApplicationContext(IngestModule);
    return {
      describeConfig: () => describeConfig(loadConfig()),
      initModel: async () => {
        await app
          .get<Model<FilingDocument>>(getModelToken(FILING_MODEL))
          .init();
      },
      worker: () => app.get(EnrichmentWorker),
      close: () => app.close(),
    };
  },
});
