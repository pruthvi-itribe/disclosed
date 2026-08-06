/**
 * The typed configuration, and the only place an environment variable is read.
 *
 * Every numeric setting here is a silent failure waiting to happen: none of the
 * components that consume them validate their own inputs at runtime, because
 * they are pure functions taking config on trust. So the validation is here,
 * once, and it stops the process rather than logging a warning nobody reads.
 */
// NOT from the barrel: this module is loaded before anything else and the
// barrel drags in mongoose and an HTTP client. `claim-provider.ts` is types and
// constants only, and it is imported rather than restated so the allowlist the
// config validates against and the one the adapters implement cannot drift.
import {
  CLAIM_EFFORT_LEVELS,
  CLAIM_PROVIDERS,
  DEFAULT_CLAIM_MODEL,
  type ClaimEffortLevel,
  type ClaimProviderName,
} from '@app/filings/llm/claim-provider';

export interface IngestConfig {
  readonly mongoUri: string;
  readonly telegramBotToken: string;
  readonly telegramChatId: string;
  readonly telegramMinSendIntervalMs: number;
  readonly hotIntervalMs: number;
  readonly idleIntervalMs: number;
  readonly drainIntervalMs: number;
  readonly alertWindowMs: number;
  readonly burstThreshold: number;
  readonly failureThreshold: number;
  readonly watchlist: readonly string[];

  // --- the background attachment worker -------------------------------------
  /** False stops the worker being started at all. It never touches the poller. */
  readonly enrichmentEnabled: boolean;
  /**
   * Whether the ingest process runs the worker itself.
   *
   * Off means the enrichment lane is expected to be a SEPARATE process
   * (`npm run start:enrichment`), which is the stronger reading of "off the hot
   * path": Node runs one thread, and parsing a large PDF is CPU work inside
   * pdf.js that the poller's timers cannot preempt. On is the default so a
   * single-process deployment keeps working unchanged.
   */
  readonly enrichmentInProcess: boolean;
  readonly enrichmentIdleIntervalMs: number;
  /** Delay between two consecutive fetches of NSE's archive host. */
  readonly enrichmentRequestDelayMs: number;
  readonly enrichmentBatchSize: number;
  readonly enrichmentMaxAttempts: number;
  readonly enrichmentRetryBaseMs: number;
  readonly enrichmentRetryMaxMs: number;
  /** How long after dissemination a parse failure may still be an upload race. */
  readonly enrichmentParseWindowMs: number;
  readonly enrichmentMaxParseAttempts: number;
  readonly enrichmentParseRetryBaseMs: number;
  readonly enrichmentLeaseMs: number;
  readonly enrichmentMaxBytes: number;
  /** IST days the derived-context line asks about, before clamping to coverage. */
  readonly contextWindowDays: number;

  // --- notable-claim extraction ---------------------------------------------
  /** False stops any model being called. Nothing else changes. */
  readonly claimsEnabled: boolean;
  /**
   * Which provider is asked for claims.
   *
   * The key that is required, and the model that is used when none is named,
   * both follow from this — so an operator who sets only `CLAIM_PROVIDER` gets
   * a working configuration rather than a working provider pointed at the other
   * one's model id.
   */
  readonly claimProvider: ClaimProvider;
  /** Empty means no extractor is configured, which is a supported state. */
  readonly anthropicApiKey: string;
  /** The same, for OpenRouter. Both are read whichever provider is selected. */
  readonly openrouterApiKey: string;
  readonly claimModel: string;
  /** Thinking depth and token spend. See `claim-provider.ts`. */
  readonly claimEffort: ClaimEffort;
  readonly claimMaxClaims: number;
  /** How much of a document reaches the model. See `MAX_DOCUMENT_CHARS`. */
  readonly claimMaxDocumentChars: number;
}

/**
 * The effort levels and provider names, re-exported from the one place that
 * defines them.
 *
 * Aliases rather than fresh literals: `libs/filings` owns the vocabulary
 * because the adapters have to implement it, and a second copy here is how a
 * config comes to accept a value no adapter can send.
 */
export const CLAIM_EFFORTS = CLAIM_EFFORT_LEVELS;

export type ClaimEffort = ClaimEffortLevel;

export const CLAIM_PROVIDER_NAMES = CLAIM_PROVIDERS;

export type ClaimProvider = ClaimProviderName;

/** The environment keys carrying a number, in the order they are validated. */
export const NUMERIC_KEYS = [
  'NSE_HOT_INTERVAL_MS',
  'NSE_IDLE_INTERVAL_MS',
  'NSE_DRAIN_INTERVAL_MS',
  'TELEGRAM_MIN_SEND_INTERVAL_MS',
  'ALERT_WINDOW_MS',
  'BURST_THRESHOLD',
  'FAILURE_THRESHOLD',
  'ENRICH_IDLE_INTERVAL_MS',
  'ENRICH_REQUEST_DELAY_MS',
  'ENRICH_BATCH_SIZE',
  'ENRICH_MAX_ATTEMPTS',
  'ENRICH_RETRY_BASE_MS',
  'ENRICH_RETRY_MAX_MS',
  'ENRICH_PARSE_WINDOW_MS',
  'ENRICH_MAX_PARSE_ATTEMPTS',
  'ENRICH_PARSE_RETRY_BASE_MS',
  'ENRICH_LEASE_MS',
  'ENRICH_MAX_BYTES',
  'CONTEXT_WINDOW_DAYS',
  'CLAIM_MAX_CLAIMS',
  'CLAIM_MAX_DOCUMENT_CHARS',
] as const;

export type NumericKey = (typeof NUMERIC_KEYS)[number];

/**
 * Used when a key is absent. Absent is not an operator error — these are the
 * documented, shipped defaults — so it is the only case that does not throw.
 */
export const CONFIG_DEFAULTS = {
  MONGO_URI: 'mongodb://localhost:27117/turret',
  NSE_HOT_INTERVAL_MS: 2_000,
  NSE_IDLE_INTERVAL_MS: 30_000,
  // Five minutes, from the design spec. The corpus supports it: no window
  // shorter than a minute can roll the 20-record page, but a five-minute one
  // peaks at 26 filings — so this is the shortest span where reconciliation
  // has anything to find, and re-pulling the day more often than that buys
  // nothing but load.
  NSE_DRAIN_INTERVAL_MS: 300_000,
  // Telegram enforces roughly one message a second per chat and answers a
  // burst with 429s. A 429 is not a delay, it is an alert that is never
  // delivered, so sends are paced rather than fired as fast as they arrive.
  TELEGRAM_MIN_SEND_INTERVAL_MS: 1_000,
  ALERT_WINDOW_MS: 600_000,
  BURST_THRESHOLD: 8,
  FAILURE_THRESHOLD: 3,

  // --- the background attachment worker -------------------------------------
  // Ten seconds between sweeps of an empty queue. The worker is not latency
  // critical — the filing has already been stored and alerted — so this trades
  // a few seconds of enrichment delay for a database it barely touches.
  ENRICH_IDLE_INTERVAL_MS: 10_000,
  // Between two fetches of NSE's archive host. The measurement behind it: 60
  // sequential requests at ~2.5 req/s drew no rate limiting, and that is the
  // ONLY evidence there is. 800ms is deliberately slower than what was proven
  // safe, because the population is 17,000 documents and the sample was 60.
  ENRICH_REQUEST_DELAY_MS: 800,
  // Documents per tick. Bounds how long a single tick holds the loop, which
  // matters only for how promptly `stop()` takes effect.
  ENRICH_BATCH_SIZE: 20,
  ENRICH_MAX_ATTEMPTS: 5,
  ENRICH_RETRY_BASE_MS: 60_000,
  ENRICH_RETRY_MAX_MS: 3_600_000,
  // A parse failure is only ever an upload race while the filing is minutes
  // old; an hour is an order of magnitude beyond the one observed case and is
  // short enough that a backfill of week-old filings retries nothing. The
  // reasoning, and the LICHSGFIN filing this exists for, are in
  // `libs/filings/src/logic/parse-retry.ts`.
  ENRICH_PARSE_WINDOW_MS: 3_600_000,
  ENRICH_MAX_PARSE_ATTEMPTS: 3,
  ENRICH_PARSE_RETRY_BASE_MS: 300_000,
  // Twice the fetch timeout plus parse time: long enough that a second worker
  // cannot take a document still being fetched, short enough that a crashed
  // worker's claims free up within a couple of minutes.
  ENRICH_LEASE_MS: 120_000,
  // A denial-of-service bound, not a throughput one. The previous 26 MB was set
  // from a corpus whose largest attachment was 22.2 MB and then refused 8 live
  // filings whose true sizes are 25.05 to 41.52 MB — five of the six distinct
  // documents by 4-12%, which is a cap sitting inside the distribution rather
  // than beyond it. Parse cost is bounded separately by `MAX_PDF_PAGES`,
  // because bytes were measured not to predict it: the 41.5 MB document parses
  // in 0.185 s and the 39.7-second one is 19.6 MB.
  ENRICH_MAX_BYTES: 67_108_864,
  CONTEXT_WINDOW_DAYS: 30,
  // Three claims is what the wire format carries before a line stops being
  // readable at a glance, and each extra one is another chance to be wrong.
  CLAIM_MAX_CLAIMS: 3,
  // Raised from 24,000 after measuring what the extra characters buy. The old
  // value was set against a model context that no longer binds — the configured
  // model carries 1,048,576 tokens — and 24,000 characters cut every investor
  // presentation off before its guidance slide. See the sweep in
  // `gate-and-attachments-report.md`.
  CLAIM_MAX_DOCUMENT_CHARS: 96_000,
} as const;

/**
 * The provider asked for notable claims when the operator names none.
 *
 * Anthropic, because that is the path with a measured gate behind it and the
 * conservative default for a feature that publishes sentences about named
 * listed companies. Switching is one variable, and `claims:compare` exists so
 * the switch can be made on numbers rather than on price alone.
 */
export const DEFAULT_CLAIM_PROVIDER: ClaimProvider = 'anthropic';

/**
 * The model asked for notable claims, per provider.
 *
 * A CONFIGURED VALUE rather than a constant, because the cost/quality trade is
 * the operator's and can be made without a deploy. The Anthropic default is the
 * current Opus: the failure being defended against is a fluent invention, and
 * while `claim-verify.ts` catches one whatever produced it, a model that
 * proposes more inventions yields a stream of discards rather than a stream of
 * claims.
 *
 * PER PROVIDER, because one shared default would be a model id that only one of
 * them can resolve — and a 404 on every call presents as an extractor that has
 * silently stopped working.
 */
export const DEFAULT_CLAIM_MODEL_ID = DEFAULT_CLAIM_MODEL;

/**
 * Default effort.
 *
 * `medium` rather than the documented `high` starting point, because this is
 * bounded extraction with a hard verification gate downstream — the marginal
 * value of deeper reasoning is capped by what the gate will accept — and the
 * honest way to move it is a sweep against a real corpus, not a guess.
 */
export const DEFAULT_CLAIM_EFFORT: ClaimEffort = 'medium';

/**
 * The floor every numeric setting shares. Zero is not merely useless in any of
 * them, it is actively harmful: a zero burst threshold makes `newCount >= 0`
 * always true and busy-loops the poller, and a zero alert window suppresses
 * every alert there is.
 */
export const MINIMUM_NUMERIC = 1;

/**
 * Reads one numeric setting, or stops the process saying which one and why.
 *
 * `Number.isFinite` is the load-bearing clause and is NOT interchangeable with
 * a bare lower bound. The realistic bad value is `NaN` — what `Number()` and
 * `parseInt()` both produce from a typo or a missing variable — and `NaN < 1`
 * is FALSE, so `if (value < MINIMUM) throw` ACCEPTS it. Every consumer then
 * fails silently:
 *
 *   - `alertWindowMs: NaN` makes `age < windowMs` false for every filing, so
 *     the cold-start gate suppresses everything and the bot goes quiet for good.
 *   - `burstThreshold: NaN` makes `newCount >= threshold` false forever, losing
 *     the burst escape hatch that prevents a page rollover under load.
 *   - `failureThreshold: NaN` makes `failures >= threshold` false forever, so
 *     the circuit breaker reports healthy through an unlimited outage.
 *   - an interval of `NaN` makes `setTimeout(fn, NaN)` fire immediately, which
 *     is an unthrottled poll loop against Akamai bot protection.
 *
 * `Number` is used rather than `parseInt` on purpose: `parseInt('2000ms')` is
 * 2000 and `parseInt('1e3')` is 1, both of which quietly accept a value the
 * operator did not write. `Number` rejects trailing junk outright.
 *
 * The three checks are ordered so the message names the fix. "Not finite",
 * "not whole" and "below the minimum" are three different operator mistakes,
 * and collapsing them into one message would leave `ALERT_WINDOW_MS=abc` and
 * `ALERT_WINDOW_MS=0.5` indistinguishable.
 */
const readNumeric = (key: NumericKey, env: NodeJS.ProcessEnv): number => {
  const raw = env[key];

  // `KEY=` is how a .env file spells "not set"; treating it as 0 would be the
  // most damaging possible reading of an operator's blank line.
  if (raw === undefined || raw.trim() === '') return CONFIG_DEFAULTS[key];

  const value = Number(raw);

  if (!Number.isFinite(value)) {
    throw new Error(
      `${key} must be a finite number, but was "${raw}". A non-finite value is ` +
        'accepted by a bare lower-bound check and then fails silently in every ' +
        'consumer, so it is rejected at load.',
    );
  }

  if (!Number.isInteger(value)) {
    throw new Error(`${key} must be a whole number, but was "${raw}".`);
  }

  if (value < MINIMUM_NUMERIC) {
    throw new Error(
      `${key} must be at least ${MINIMUM_NUMERIC}, but was "${raw}".`,
    );
  }

  return value;
};

/**
 * Reads one string setting, treating a blank assignment as unset.
 *
 * The SAME rule as `readNumeric`, and that consistency is the point. `.env.example`
 * and the README both state the rule generally — "a blank assignment (KEY=) is
 * read as not set and falls back to the default" — and `readString` used to
 * exempt itself, so `MONGO_URI=` yielded `''` and the process tried to connect
 * to an empty connection string. One documented rule with a silent exception is
 * worse than either rule applied consistently.
 *
 * The value itself is returned untrimmed: a token is opaque and reshaping it
 * here would be this function inventing a value the operator did not write.
 */
const readString = (
  key: string,
  env: NodeJS.ProcessEnv,
  fallback: string,
): string => {
  const raw = env[key];
  return raw === undefined || raw.trim() === '' ? fallback : raw;
};

/**
 * Splits a comma-separated symbol list, dropping blanks.
 *
 * `WATCHLIST=` parses to `['']`, and a blank entry kept as a real member
 * matches no symbol and mutes the bot completely — a failure that presents as a
 * quiet market. Case is deliberately preserved: `AlertService` normalises both
 * sides of the comparison, and folding here as well is how the two sides drift.
 */
/**
 * Reads a boolean setting.
 *
 * Only the words `false`, `0`, `no` and `off` turn a feature off; everything
 * else that is set turns it on, and an absent or blank value takes the default.
 * A permissive reading in the OTHER direction would be worse here: a typo in
 * `ENRICH_ENABLED` must not silently disable the worker, because a worker that
 * is not running looks exactly like a queue with nothing in it.
 */
const readBoolean = (
  key: string,
  env: NodeJS.ProcessEnv,
  fallback: boolean,
): boolean => {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  return !['false', '0', 'no', 'off'].includes(raw.trim().toLowerCase());
};

/**
 * Reads one setting from a fixed set of words, or stops the process naming them.
 *
 * The string counterpart of `readNumeric`, and it exists for the same reason: an
 * unrecognised value is not caught by anything downstream. A bad effort level is
 * a 400 from the API on every single call and a bad provider name would select
 * no adapter at all — both of which present as an extractor that has silently
 * stopped working rather than as a typo in one environment variable.
 *
 * Case-folded and trimmed on the way in, because these are words an operator
 * types, not opaque tokens. The message lists every valid word, so the fix is in
 * the error rather than in the source.
 */
const readChoice = <T extends string>(
  key: string,
  env: NodeJS.ProcessEnv,
  allowed: readonly T[],
  fallback: T,
): T => {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = raw.trim().toLowerCase();
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(
      `${key} must be one of ${allowed.join(', ')}, but was "${raw}".`,
    );
  }
  return value as T;
};

const readList = (key: string, env: NodeJS.ProcessEnv): string[] =>
  (env[key] ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

/**
 * Builds the configuration, or throws naming the offending key.
 *
 * Takes the environment as an argument so it can be tested without mutating a
 * global. Nest's `ConfigModule` calls it with no arguments, after it has merged
 * any `.env` file into `process.env`.
 */
export const loadConfig = (
  env: NodeJS.ProcessEnv = process.env,
): IngestConfig => {
  // Read first, because the model default depends on it. An operator who names
  // a provider and nothing else must get that provider's own model.
  const claimProvider = readChoice(
    'CLAIM_PROVIDER',
    env,
    CLAIM_PROVIDER_NAMES,
    DEFAULT_CLAIM_PROVIDER,
  );

  return {
    mongoUri: readString('MONGO_URI', env, CONFIG_DEFAULTS.MONGO_URI),
    telegramBotToken: readString('TELEGRAM_BOT_TOKEN', env, ''),
    telegramChatId: readString('TELEGRAM_CHAT_ID', env, ''),
    telegramMinSendIntervalMs: readNumeric(
      'TELEGRAM_MIN_SEND_INTERVAL_MS',
      env,
    ),
    hotIntervalMs: readNumeric('NSE_HOT_INTERVAL_MS', env),
    idleIntervalMs: readNumeric('NSE_IDLE_INTERVAL_MS', env),
    drainIntervalMs: readNumeric('NSE_DRAIN_INTERVAL_MS', env),
    alertWindowMs: readNumeric('ALERT_WINDOW_MS', env),
    burstThreshold: readNumeric('BURST_THRESHOLD', env),
    failureThreshold: readNumeric('FAILURE_THRESHOLD', env),
    watchlist: readList('WATCHLIST', env),
    enrichmentEnabled: readBoolean('ENRICH_ENABLED', env, true),
    enrichmentInProcess: readBoolean('ENRICH_IN_PROCESS', env, true),
    enrichmentIdleIntervalMs: readNumeric('ENRICH_IDLE_INTERVAL_MS', env),
    enrichmentRequestDelayMs: readNumeric('ENRICH_REQUEST_DELAY_MS', env),
    enrichmentBatchSize: readNumeric('ENRICH_BATCH_SIZE', env),
    enrichmentMaxAttempts: readNumeric('ENRICH_MAX_ATTEMPTS', env),
    enrichmentRetryBaseMs: readNumeric('ENRICH_RETRY_BASE_MS', env),
    enrichmentRetryMaxMs: readNumeric('ENRICH_RETRY_MAX_MS', env),
    enrichmentParseWindowMs: readNumeric('ENRICH_PARSE_WINDOW_MS', env),
    enrichmentMaxParseAttempts: readNumeric('ENRICH_MAX_PARSE_ATTEMPTS', env),
    enrichmentParseRetryBaseMs: readNumeric('ENRICH_PARSE_RETRY_BASE_MS', env),
    enrichmentLeaseMs: readNumeric('ENRICH_LEASE_MS', env),
    enrichmentMaxBytes: readNumeric('ENRICH_MAX_BYTES', env),
    contextWindowDays: readNumeric('CONTEXT_WINDOW_DAYS', env),
    claimsEnabled: readBoolean('CLAIM_ENABLED', env, true),
    claimProvider,
    anthropicApiKey: readString('ANTHROPIC_API_KEY', env, ''),
    openrouterApiKey: readString('OPENROUTER_API_KEY', env, ''),
    claimModel: readString(
      'CLAIM_MODEL',
      env,
      DEFAULT_CLAIM_MODEL_ID[claimProvider],
    ),
    claimEffort: readChoice(
      'CLAIM_EFFORT',
      env,
      CLAIM_EFFORTS,
      DEFAULT_CLAIM_EFFORT,
    ),
    claimMaxClaims: readNumeric('CLAIM_MAX_CLAIMS', env),
    claimMaxDocumentChars: readNumeric('CLAIM_MAX_DOCUMENT_CHARS', env),
  };
};

/**
 * The key the selected provider needs, or an empty string.
 *
 * ONE PLACE, because three callers ask the same question — the startup line
 * deciding between `unconfigured` and a model name, the factory deciding
 * whether to build an extractor at all, and the comparison harness deciding
 * whether it may run. Answering it separately in each is how they come to
 * disagree, and the failure that produces is a startup line reporting a
 * configured lane that then extracts nothing.
 */
export const claimApiKeyOf = (config: {
  readonly claimProvider: ClaimProvider;
  readonly anthropicApiKey: string;
  readonly openrouterApiKey: string;
}): string =>
  config.claimProvider === 'openrouter'
    ? config.openrouterApiKey
    : config.anthropicApiKey;

/**
 * Strips the `user:password@` section of a connection string.
 *
 * A mongo URI routinely carries credentials, and the startup line below is the
 * one place the whole configuration is printed. Redacting is not optional: a
 * password in a log file outlives the process that wrote it.
 */
const redactCredentials = (uri: string): string =>
  uri.replace(/\/\/[^@/]*@/, '//***@');

/**
 * A single startup line describing the configuration actually in force.
 *
 * Exists because a default that silently applied is indistinguishable from a
 * setting that was read — until the poller behaves in a way the operator did
 * not expect. Secrets are named, never printed.
 */
export const describeConfig = (config: IngestConfig): string =>
  [
    `mongo=${redactCredentials(config.mongoUri)}`,
    `hot=${config.hotIntervalMs}ms`,
    `idle=${config.idleIntervalMs}ms`,
    `drain=${config.drainIntervalMs}ms`,
    `send=${config.telegramMinSendIntervalMs}ms`,
    `window=${config.alertWindowMs}ms`,
    `burst=${config.burstThreshold}`,
    `failures=${config.failureThreshold}`,
    `watchlist=${config.watchlist.length}`,
    `enrich=${config.enrichmentEnabled ? 'on' : 'off'}`,
    `enrichWhere=${config.enrichmentInProcess ? 'in-process' : 'separate-process'}`,
    `enrichDelay=${config.enrichmentRequestDelayMs}ms`,
    `context=${config.contextWindowDays}d`,
    // Both halves matter and they fail differently: the switch being off is a
    // decision, and a missing key with the switch on is a misconfiguration that
    // presents as a market with nothing to say.
    // The provider is named even when the lane is unconfigured, because
    // "unconfigured" answers "which key is missing?" differently depending on
    // it, and that is the first question an operator asks.
    `claims=${
      !config.claimsEnabled
        ? 'off'
        : claimApiKeyOf(config)
          ? `${config.claimProvider}/${config.claimModel}/${config.claimEffort}`
          : `${config.claimProvider}/unconfigured`
    }`,
    // Both halves are required to send anything, so a half-set pair is reported
    // as unconfigured rather than as a channel that will never deliver.
    `telegram=${
      config.telegramBotToken && config.telegramChatId
        ? 'configured'
        : 'unconfigured'
    }`,
  ].join(' ');
