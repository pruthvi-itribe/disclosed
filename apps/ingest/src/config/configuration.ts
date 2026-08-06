/**
 * The typed configuration, and the only place an environment variable is read.
 *
 * Every numeric setting here is a silent failure waiting to happen: none of the
 * components that consume them validate their own inputs at runtime, because
 * they are pure functions taking config on trust. So the validation is here,
 * once, and it stops the process rather than logging a warning nobody reads.
 */

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
  /** Empty means no extractor is configured, which is a supported state. */
  readonly anthropicApiKey: string;
  readonly claimModel: string;
  /** Thinking depth and token spend. See `claude-claim-extractor.ts`. */
  readonly claimEffort: ClaimEffort;
  readonly claimMaxClaims: number;
}

/** The effort levels the Messages API accepts. */
export const CLAIM_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

export type ClaimEffort = (typeof CLAIM_EFFORTS)[number];

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
  // Clears the largest attachment observed in the recorded month (22.2 MB).
  ENRICH_MAX_BYTES: 26_214_400,
  CONTEXT_WINDOW_DAYS: 30,
  // Three claims is what the wire format carries before a line stops being
  // readable at a glance, and each extra one is another chance to be wrong.
  CLAIM_MAX_CLAIMS: 3,
} as const;

/**
 * The model asked for notable claims.
 *
 * A CONFIGURED VALUE rather than a constant, because the cost/quality trade is
 * the operator's and can be made without a deploy. The default is the current
 * Opus: the failure being defended against is a fluent invention, and while
 * `claim-verify.ts` catches one whatever produced it, a model that proposes more
 * inventions yields a stream of discards rather than a stream of claims.
 */
export const DEFAULT_CLAIM_MODEL_ID = 'claude-opus-5';

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
 * Reads the effort level, or stops the process naming the valid ones.
 *
 * Checked against the allowlist rather than passed through, because an
 * unrecognised value is a 400 from the API on every single call — which
 * presents as an extractor that has silently stopped working rather than as a
 * typo in one environment variable.
 */
const readEffort = (key: string, env: NodeJS.ProcessEnv): ClaimEffort => {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return DEFAULT_CLAIM_EFFORT;
  const value = raw.trim().toLowerCase();
  if (!(CLAIM_EFFORTS as readonly string[]).includes(value)) {
    throw new Error(
      `${key} must be one of ${CLAIM_EFFORTS.join(', ')}, but was "${raw}".`,
    );
  }
  return value as ClaimEffort;
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
): IngestConfig => ({
  mongoUri: readString('MONGO_URI', env, CONFIG_DEFAULTS.MONGO_URI),
  telegramBotToken: readString('TELEGRAM_BOT_TOKEN', env, ''),
  telegramChatId: readString('TELEGRAM_CHAT_ID', env, ''),
  telegramMinSendIntervalMs: readNumeric('TELEGRAM_MIN_SEND_INTERVAL_MS', env),
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
  anthropicApiKey: readString('ANTHROPIC_API_KEY', env, ''),
  claimModel: readString('CLAIM_MODEL', env, DEFAULT_CLAIM_MODEL_ID),
  claimEffort: readEffort('CLAIM_EFFORT', env),
  claimMaxClaims: readNumeric('CLAIM_MAX_CLAIMS', env),
});

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
    `claims=${
      !config.claimsEnabled
        ? 'off'
        : config.anthropicApiKey
          ? `${config.claimModel}/${config.claimEffort}`
          : 'unconfigured'
    }`,
    // Both halves are required to send anything, so a half-set pair is reported
    // as unconfigured rather than as a channel that will never deliver.
    `telegram=${
      config.telegramBotToken && config.telegramChatId
        ? 'configured'
        : 'unconfigured'
    }`,
  ].join(' ');
