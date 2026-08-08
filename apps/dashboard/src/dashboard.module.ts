import {
  Module,
  type MiddlewareConsumer,
  type NestModule,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { getModelToken, InjectModel, MongooseModule } from '@nestjs/mongoose';
import { ThrottlerModule } from '@nestjs/throttler';
import * as express from 'express';
import type { Model } from 'mongoose';
import {
  Argon2idHasher,
  assertAccountIndexes,
  SESSION_MODEL,
  SessionRepository,
  SessionSchema,
  USER_MODEL,
  UserRepository,
  UserSchema,
  WATCHLIST_MODEL,
  WatchlistRepository,
  WatchlistSchema,
  type SessionDocument,
  type UserDocument,
  type WatchlistDocument,
} from '@app/accounts';
import { FilingSchema, type FilingDocument } from '@app/filings';
import { ApiErrorFilter } from './auth/api-error';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { AUTH_CONFIG, FIREBASE_SIGN_IN } from './auth/auth.tokens';
import { FirebaseSignInService } from './auth/firebase-sign-in';
import { AdminSdkVerifier } from './auth/firebase-verifier';
import { OriginGuard, SessionGuard } from './auth/session.guard';
import { SessionService } from './auth/session.service';
import { WatchlistController } from './auth/watchlist.controller';
import type { AuthConfig } from './config/auth-config';
import { loadDashboardConfig } from './config/configuration';
import { DashboardController } from './filings/dashboard.controller';
import { FilingQueryService } from './filings/filing-query.service';
import type { FilingReadModel } from './filings/filing-read.model';
import { CompanyDirectory } from './search/company-directory';
import { symbolsMatching } from './search/suggest';

/** The one path prefix that reads a request body. See point 2 of the header. */
export const BODY_PARSED_PATH = 'api/auth';

/**
 * The largest auth body accepted. Two fields, one of which is capped at 128
 * characters — 4 KB is generous by two orders of magnitude and still bounds
 * what an unauthenticated caller can make this process allocate.
 */
export const AUTH_BODY_LIMIT = '4kb';

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
 *   2. BODY PARSING IS JSON ONLY, ON `/api/auth`, AT 4 KB. `main.ts` still
 *      creates the app with `bodyParser: false`, so nothing is mounted
 *      globally; `configure()` at the bottom of this file mounts
 *      `express.json({limit: '4kb'})` on that one path prefix and nowhere
 *      else. This point used to read "body parsing is off", and it had to
 *      move: a password cannot travel in a query string, because query
 *      strings land in access logs, `Referer` headers and browser history.
 *      What did NOT move is the part that matters here — no `urlencoded`, so
 *      `qs`'s array handling stays off the request path, and no `multipart`,
 *      so multer stays unreachable. The feed routes, the watchlist routes and
 *      the page itself still see zero parsing.
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
 * READ-ONLY ABOUT FILINGS. NOT READ-ONLY ANY MORE.
 * ================================================================
 *
 * This application now writes `users`, `sessions` and `watchlists`, and it
 * still never writes a filing. The second half is the one the invariant was
 * ever about, and it is the one the type system enforces.
 *
 * The account collections are this process's own: it is their only writer,
 * nothing else reads them, and `assertAccountIndexes` builds their indexes at
 * boot. `autoIndex: false` stays on the connection, so `filings` remains
 * untouchable including its indexes — see `account-indexes.ts` for why the two
 * postures are deliberately opposite.
 *
 * The factory below hands `FilingQueryService` a
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
    MongooseModule.forFeature([
      { name: FILING_MODEL, schema: FilingSchema },
      // The three collections this process owns and writes. Registered on the
      // same connection, which is why their model names are prefixed: a name
      // collision with `Filing` would be a silent overwrite rather than an
      // error.
      { name: USER_MODEL, schema: UserSchema },
      { name: SESSION_MODEL, schema: SessionSchema },
      { name: WATCHLIST_MODEL, schema: WatchlistSchema },
    ]),
    /**
     * THE BRUTE-FORCE LIMITER, and it is not deferred to the exposure gate:
     * credential stuffing starts the hour a login endpoint exists, and this one
     * is reachable by every process on the host from the moment it ships.
     *
     * In-memory, which is fine for one process — the limits reset on restart,
     * and the per-account backoff in `login-backoff.ts` is PERSISTED, so the
     * defence that survives a restart is the one keyed on the account.
     *
     * TWO WINDOWS ON THE AUTH ROUTES, because one is not enough: 10/min alone
     * permits 600 an hour, and 60/hour alone permits a 60-guess burst in the
     * first second. Together they bound the burst and the sustained rate.
     *
     * The public-reads bucket (300/min) is deliberately NOT here. It belongs
     * with the reverse proxy and the rest of the exposure-gate checklist; on
     * loopback the only client is the page itself.
     */
    ThrottlerModule.forRoot([
      { name: 'auth-minute', ttl: 60_000, limit: 10 },
      { name: 'auth-hour', ttl: 3_600_000, limit: 60 },
      { name: 'watchlist-minute', ttl: 60_000, limit: 60 },
    ]),
  ],
  controllers: [DashboardController, AuthController, WatchlistController],
  providers: [
    {
      // The type-ahead's data source, and a SINGLETON on purpose: it holds one
      // cached snapshot of the collection's distinct companies, and the whole
      // reason a keystroke costs no database read is that every request shares
      // it. A per-request instance would rebuild it per keystroke, which is the
      // exact behaviour it exists to avoid.
      provide: CompanyDirectory,
      inject: [getModelToken(FILING_MODEL)],
      useFactory: (model: Model<FilingDocument>) =>
        new CompanyDirectory(model satisfies FilingReadModel),
    },
    {
      provide: FilingQueryService,
      inject: [getModelToken(FILING_MODEL), CompanyDirectory],
      // The widening to `FilingReadModel` happens HERE, at the one point the
      // full model exists, so nothing downstream is ever handed a writable
      // handle. `() => new Date()` is injected rather than called inside the
      // service so the IST-day and lag arithmetic is testable against a fixed
      // clock.
      //
      // The third argument is the PREFIX HALF OF SEARCH. A text index matches
      // whole words, so `brit` matches nothing; the directory answers prefixes
      // from memory. It is wired as a closure rather than as a constructor
      // dependency so `FilingQueryService` still depends on a read handle and a
      // clock and nothing else — and so the fallback is visibly a composition
      // decision made here rather than a behaviour hidden inside the service.
      useFactory: (model: Model<FilingDocument>, directory: CompanyDirectory) =>
        new FilingQueryService(
          model satisfies FilingReadModel,
          () => new Date(),
          async (query: string) =>
            symbolsMatching(await directory.snapshot(), query),
        ),
    },

    // ---------------------------------------------------------- accounts ----
    {
      provide: UserRepository,
      inject: [getModelToken(USER_MODEL)],
      useFactory: (model: Model<UserDocument>) => new UserRepository(model),
    },
    {
      provide: SessionRepository,
      inject: [getModelToken(SESSION_MODEL)],
      useFactory: (model: Model<SessionDocument>) =>
        new SessionRepository(model),
    },
    {
      provide: WatchlistRepository,
      inject: [getModelToken(WATCHLIST_MODEL)],
      useFactory: (model: Model<WatchlistDocument>) =>
        new WatchlistRepository(model),
    },
    {
      provide: AuthService,
      inject: [UserRepository],
      // The hasher is constructed HERE, at the one composition point, which is
      // what makes the scrypt escape hatch a one-line change rather than a
      // rewrite — see `password-hash.ts`.
      useFactory: (users: UserRepository) =>
        new AuthService(users, new Argon2idHasher(), () => new Date()),
    },
    {
      provide: SessionService,
      inject: [SessionRepository, UserRepository, ConfigService],
      useFactory: (
        sessions: SessionRepository,
        users: UserRepository,
        config: ConfigService,
      ) =>
        new SessionService(
          sessions,
          users,
          config.getOrThrow<number>('sessionTtlDays'),
          () => new Date(),
        ),
    },
    {
      provide: AUTH_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.getOrThrow<AuthConfig>('auth'),
    },
    {
      /**
       * THE FIREBASE HALF, OR NOTHING AT ALL.
       *
       * Null is a configured state rather than a wiring failure — see
       * `auth.tokens.ts`. The factory constructs the Admin SDK verifier only
       * when a project is actually configured, which is what lets this branch
       * boot with no Firebase keys and what stops `AUTH_MODE=local` from
       * leaving a live token-exchange route on a host that turned it off.
       *
       * CONSTRUCTED AT BOOT, NOT ON FIRST USE. A project id that Firebase
       * rejects should appear in the startup log rather than as a 500 the first
       * person to press "Continue with Google" discovers.
       */
      provide: FIREBASE_SIGN_IN,
      inject: [AUTH_CONFIG, UserRepository],
      useFactory: (auth: AuthConfig, users: UserRepository) =>
        auth.firebase === null
          ? null
          : new FirebaseSignInService(
              new AdminSdkVerifier(auth.firebase),
              users,
              () => new Date(),
            ),
    },
    // Both guards and the filter are referenced by class in `@UseGuards` /
    // `@UseFilters`, which Nest instantiates from their own metadata. They are
    // listed here so their own dependencies resolve in this module's context.
    SessionGuard,
    OriginGuard,
    ApiErrorFilter,
  ],
})
export class DashboardModule implements NestModule, OnModuleInit {
  constructor(
    @InjectModel(USER_MODEL) private readonly users: Model<UserDocument>,
    @InjectModel(SESSION_MODEL)
    private readonly sessions: Model<SessionDocument>,
    @InjectModel(WATCHLIST_MODEL)
    private readonly watchlists: Model<WatchlistDocument>,
  ) {}

  /**
   * BODY PARSING, MOUNTED ON ONE PATH PREFIX.
   *
   * Here rather than in `main.ts` for one reason: this application is
   * bootstrapped twice — once by `main.ts` and once by the Jest suite that
   * boots the real module against an in-memory mongod — and a posture declared
   * in only one of them is a posture the tests cannot see. Mounted with the
   * module, the two bootstraps cannot disagree about what parses a body.
   *
   * JSON ONLY. No `urlencoded`, so `qs`'s array handling never touches a
   * request; no `multipart`, so multer stays unreachable. See point 2 of this
   * file's header for the full argument.
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(express.json({ limit: AUTH_BODY_LIMIT }))
      .forRoutes(`${BODY_PARSED_PATH}/*`);
  }

  /**
   * Builds the account indexes before the first request.
   *
   * REJECTS RATHER THAN LOGS. Without the sessions TTL index nothing ever
   * expires a session, and without the unique email index two simultaneous
   * registrations are two accounts. A dashboard that boots without them is a
   * dashboard quietly accumulating both.
   */
  async onModuleInit(): Promise<void> {
    await assertAccountIndexes([this.users, this.sessions, this.watchlists]);
  }
}
