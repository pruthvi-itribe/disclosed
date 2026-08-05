import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { FilingSchema, type FilingDocument } from '@app/filings';
import { loadDashboardConfig } from './config/configuration';
import { DashboardController } from './filings/dashboard.controller';
import { FilingQueryService } from './filings/filing-query.service';
import type { FilingReadModel } from './filings/filing-read.model';

/** The mongoose model name; the collection itself is named by the schema. */
export const FILING_MODEL = 'Filing';

/**
 * ================================================================
 * WHY THIS IS A SEPARATE APPLICATION, AND MUST STAY ONE
 * ================================================================
 *
 * `apps/ingest` has NO HTTP SERVER. It bootstraps with
 * `NestFactory.createApplicationContext`, not `NestFactory.create`, and
 * `@nestjs/platform-express` is absent from its runtime graph on purpose.
 *
 * The reason is concrete rather than architectural taste. `@nestjs/platform-express`
 * depends on `multer`, whose advisory history is a run of high-severity
 * denial-of-service reports (incomplete cleanup, resource exhaustion,
 * uncontrolled recursion, deeply nested field names, aborted-upload cleanup).
 * The ingest process serves nothing, accepts no request and parses no
 * multipart body, so carrying that dependency bought it exactly zero
 * capability and a permanent audit finding. It was removed in Task 1 for that
 * reason.
 *
 * This application is where the HTTP surface lives, and it is where the
 * dependency has been re-added. Three things keep it from re-importing the
 * problem it was removed for:
 *
 *   1. NO MULTIPART ROUTE EXISTS. The multer advisories are reachable only
 *      through `FileInterceptor`/`FilesInterceptor`, which this app never
 *      registers. Multer is present in the tree and never on a code path.
 *   2. BODY PARSING IS OFF. `main.ts` creates the app with `bodyParser: false`,
 *      so no request body of any kind is read, by any parser.
 *   3. THE VULNERABLE VERSIONS ARE PINNED OUT. `package.json` carries
 *      `overrides` moving multer to 2.2.0, express to 4.22.2, body-parser to
 *      1.20.6 and qs to 6.15.3 — the first versions clear of the advisories
 *      that `@nestjs/platform-express@10` otherwise pins in. `npm audit
 *      --omit=dev` reports the same findings after this change as before it.
 *
 * SO: DO NOT "SIMPLIFY" THESE TWO APPS TOGETHER.
 *
 * Adding a controller to `apps/ingest`, or switching its bootstrap to
 * `NestFactory.create`, puts an HTTP listener and a multipart parser inside the
 * process whose job is to never miss a filing — a process that already holds
 * the only unique-index guarantee, the Telegram send queue and the poll loop.
 * Merging them costs the ingest its dependency hygiene and gains nothing: the
 * two have different lifecycles (one must run to be useful, the other only when
 * someone is looking), different failure modes (a crashed viewer is an
 * inconvenience; a crashed poller is lost filings) and different security
 * postures (one makes only outbound calls; the other listens).
 *
 * They share `libs/filings` — the schema and the domain types — which is the
 * coupling that is actually wanted.
 *
 * ================================================================
 * READ-ONLY
 * ================================================================
 *
 * This application NEVER writes. The factory below hands `FilingQueryService` a
 * `FilingReadModel`, which is `Model<FilingDocument>` narrowed to `find`,
 * `findOne`, `countDocuments` and `aggregate`; the write methods are not on the
 * object the service holds, so a write is a compile error rather than a review
 * comment. That matters because this process shares a live collection with the
 * poller: a stray write would corrupt the cursor the poller resumes from and
 * either re-drain or skip a day of filings.
 *
 * `MongooseModule.forRoot` is used with no index synchronisation and the schema
 * is registered read-side only. Note that mongoose builds schema-declared
 * indexes on connect by default; `autoIndex: false` below prevents even that,
 * so this app cannot alter the collection in any way, including its indexes.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [loadDashboardConfig] }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow<string>('mongoUri'),
        // A viewer must not create indexes. Index management belongs to the
        // process that owns the write path, and `FilingRepository.assertIndexes`
        // is deliberately written to FAIL rather than repair when one is
        // missing — a dashboard quietly building it behind the operator would
        // defeat that check.
        autoIndex: false,
      }),
    }),
    MongooseModule.forFeature([{ name: FILING_MODEL, schema: FilingSchema }]),
  ],
  controllers: [DashboardController],
  providers: [
    {
      provide: FilingQueryService,
      inject: [getModelToken(FILING_MODEL)],
      // The widening to `FilingReadModel` happens HERE, at the one point the
      // full model exists, so nothing downstream is ever handed a writable
      // handle. `() => new Date()` is injected rather than called inside the
      // service so the IST-day and lag arithmetic is testable against a fixed
      // clock.
      useFactory: (model: Model<FilingDocument>) =>
        new FilingQueryService(
          model satisfies FilingReadModel,
          () => new Date(),
        ),
    },
  ],
})
export class DashboardModule {}
