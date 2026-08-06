import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import {
  AttachmentFetcher,
  EnrichmentRepository,
  FilingRepository,
  FilingSchema,
  NseAdapter,
  type ClaimExtractor,
  type FilingDocument,
} from '@app/filings';
import { buildClaimExtractor } from './enrichment/claim-extractor.factory';
import { TelegramService } from '@app/notify';
import { AlertService } from './alert/alert.service';
import { loadConfig, type ClaimEffort } from './config/configuration';
import { EnrichmentWorker } from './enrichment/enrichment.worker';
import { FilingContextService } from './enrichment/filing-context.service';
import { CircuitBreaker } from './poller/circuit-breaker';
import { PollerService } from './poller/poller.service';
import { SessionService } from './session/session.service';

/** The mongoose model name; the collection itself is named by the schema. */
export const FILING_MODEL = 'Filing';

/**
 * The claim extractor's injection token.
 *
 * A string token rather than a class, because the provider resolves to `null`
 * when no key is configured — and Nest cannot key a provider on a type that may
 * legitimately be absent.
 */
export const CLAIM_EXTRACTOR = 'CLAIM_EXTRACTOR';

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
      provide: EnrichmentRepository,
      inject: [getModelToken(FILING_MODEL)],
      useFactory: (model: Model<FilingDocument>) =>
        new EnrichmentRepository(model),
    },
    {
      provide: AttachmentFetcher,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new AttachmentFetcher(config.getOrThrow<number>('enrichmentMaxBytes')),
    },
    {
      provide: FilingContextService,
      inject: [EnrichmentRepository, ConfigService],
      useFactory: (repository: EnrichmentRepository, config: ConfigService) =>
        new FilingContextService(
          repository,
          config.getOrThrow<number>('contextWindowDays'),
        ),
    },
    {
      provide: AlertService,
      inject: [TelegramService, ConfigService, FilingContextService],
      useFactory: (
        telegram: TelegramService,
        config: ConfigService,
        context: FilingContextService,
      ) =>
        new AlertService(
          telegram,
          {
            alertWindowMs: config.getOrThrow<number>('alertWindowMs'),
            watchlist: config.getOrThrow<readonly string[]>('watchlist'),
          },
          // The derived-context line. Contained inside AlertService, so a slow
          // or failing query costs the line and never the alert.
          context,
        ),
    },
    {
      /**
       * Null when claims are switched off or no key is configured, and that is
       * a supported state rather than a broken one: the worker keeps reading
       * documents, and every eligible filing records `extractor-unavailable`
       * instead of a claim. Built once at startup so an unconfigured pipeline
       * says so on the startup line rather than discovering it 700 times a day.
       */
      provide: CLAIM_EXTRACTOR,
      inject: [ConfigService],
      useFactory: (config: ConfigService): ClaimExtractor | null =>
        buildClaimExtractor({
          claimsEnabled: config.getOrThrow<boolean>('claimsEnabled'),
          anthropicApiKey: config.getOrThrow<string>('anthropicApiKey'),
          claimModel: config.getOrThrow<string>('claimModel'),
          claimEffort: config.getOrThrow<ClaimEffort>('claimEffort'),
        }),
    },
    {
      provide: EnrichmentWorker,
      inject: [
        EnrichmentRepository,
        AttachmentFetcher,
        FilingContextService,
        TelegramService,
        ConfigService,
        CLAIM_EXTRACTOR,
      ],
      useFactory: (
        repository: EnrichmentRepository,
        fetcher: AttachmentFetcher,
        context: FilingContextService,
        telegram: TelegramService,
        config: ConfigService,
        claimExtractor: ClaimExtractor | null,
      ) =>
        new EnrichmentWorker(
          repository,
          fetcher,
          context,
          telegram,
          {
            idleIntervalMs: config.getOrThrow<number>(
              'enrichmentIdleIntervalMs',
            ),
            requestDelayMs: config.getOrThrow<number>(
              'enrichmentRequestDelayMs',
            ),
            batchSize: config.getOrThrow<number>('enrichmentBatchSize'),
            maxAttempts: config.getOrThrow<number>('enrichmentMaxAttempts'),
            retryBaseMs: config.getOrThrow<number>('enrichmentRetryBaseMs'),
            retryMaxMs: config.getOrThrow<number>('enrichmentRetryMaxMs'),
            parseWindowMs: config.getOrThrow<number>('enrichmentParseWindowMs'),
            maxParseAttempts: config.getOrThrow<number>(
              'enrichmentMaxParseAttempts',
            ),
            parseRetryBaseMs: config.getOrThrow<number>(
              'enrichmentParseRetryBaseMs',
            ),
            leaseMs: config.getOrThrow<number>('enrichmentLeaseMs'),
            alertWindowMs: config.getOrThrow<number>('alertWindowMs'),
            watchlist: config.getOrThrow<readonly string[]>('watchlist'),
            maxClaims: config.getOrThrow<number>('claimMaxClaims'),
          },
          undefined,
          claimExtractor,
        ),
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
          drainIntervalMs: config.getOrThrow<number>('drainIntervalMs'),
          burstThreshold: config.getOrThrow<number>('burstThreshold'),
        }),
    },
  ],
})
export class IngestModule {}
