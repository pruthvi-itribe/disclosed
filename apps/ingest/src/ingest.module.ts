import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import {
  FilingRepository,
  FilingSchema,
  NseAdapter,
  type FilingDocument,
} from '@app/filings';
import { TelegramService } from '@app/notify';
import { AlertService } from './alert/alert.service';
import { loadConfig } from './config/configuration';
import { CircuitBreaker } from './poller/circuit-breaker';
import { PollerService } from './poller/poller.service';
import { SessionService } from './session/session.service';

/** The mongoose model name; the collection itself is named by the schema. */
export const FILING_MODEL = 'Filing';

/**
 * Wires the ingest application.
 *
 * Almost everything here is a `useFactory` rather than an injectable class, and
 * that is deliberate rather than incidental: `CircuitBreaker`, `AlertService`,
 * `PollerService` and `FilingRepository` all take primitives or plain objects,
 * which Nest cannot resolve by type. A factory reading `ConfigService` is the
 * only way to hand them validated values — the alternative, an inline
 * `parseInt(process.env.X)` at the point of use, would scatter the parsing
 * across the codebase and route straight past the validation in
 * `config/configuration.ts`, which is where the NaN hazard is actually caught.
 *
 * `getOrThrow` rather than `get`: a key missing here means the config factory
 * and this wiring have drifted apart, and a silent `undefined` reaching a
 * constructor reproduces exactly the failure the validation exists to prevent.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [loadConfig] }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow<string>('mongoUri'),
      }),
    }),
    MongooseModule.forFeature([{ name: FILING_MODEL, schema: FilingSchema }]),
  ],
  providers: [
    SessionService,
    TelegramService,
    {
      provide: NseAdapter,
      inject: [SessionService],
      useFactory: (session: SessionService) =>
        // The logger is required, not defaulted: it carries the skip warnings
        // that say filings are being discarded.
        new NseAdapter(session, new Logger(NseAdapter.name)),
    },
    {
      provide: FilingRepository,
      inject: [getModelToken(FILING_MODEL)],
      useFactory: (model: Model<FilingDocument>) => new FilingRepository(model),
    },
    {
      provide: CircuitBreaker,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new CircuitBreaker(config.getOrThrow<number>('failureThreshold')),
    },
    {
      provide: AlertService,
      inject: [TelegramService, ConfigService],
      useFactory: (telegram: TelegramService, config: ConfigService) =>
        new AlertService(telegram, {
          alertWindowMs: config.getOrThrow<number>('alertWindowMs'),
          watchlist: config.getOrThrow<readonly string[]>('watchlist'),
        }),
    },
    {
      provide: PollerService,
      inject: [
        NseAdapter,
        FilingRepository,
        AlertService,
        TelegramService,
        CircuitBreaker,
        ConfigService,
      ],
      useFactory: (
        adapter: NseAdapter,
        repository: FilingRepository,
        alerts: AlertService,
        telegram: TelegramService,
        breaker: CircuitBreaker,
        config: ConfigService,
      ) =>
        new PollerService(adapter, repository, alerts, telegram, breaker, {
          hotIntervalMs: config.getOrThrow<number>('hotIntervalMs'),
          idleIntervalMs: config.getOrThrow<number>('idleIntervalMs'),
          burstThreshold: config.getOrThrow<number>('burstThreshold'),
        }),
    },
  ],
})
export class IngestModule {}
