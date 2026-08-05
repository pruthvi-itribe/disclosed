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
}

/** The environment keys carrying a number, in the order they are validated. */
export const NUMERIC_KEYS = [
  'NSE_HOT_INTERVAL_MS',
  'NSE_IDLE_INTERVAL_MS',
  'NSE_DRAIN_INTERVAL_MS',
  'TELEGRAM_MIN_SEND_INTERVAL_MS',
  'ALERT_WINDOW_MS',
  'BURST_THRESHOLD',
  'FAILURE_THRESHOLD',
] as const;

export type NumericKey = (typeof NUMERIC_KEYS)[number];

/**
 * Used when a key is absent. Absent is not an operator error — these are the
 * documented, shipped defaults — so it is the only case that does not throw.
 */
export const CONFIG_DEFAULTS = {
  MONGO_URI: 'mongodb://localhost:27017/redbox',
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
} as const;

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
    // Both halves are required to send anything, so a half-set pair is reported
    // as unconfigured rather than as a channel that will never deliver.
    `telegram=${
      config.telegramBotToken && config.telegramChatId
        ? 'configured'
        : 'unconfigured'
    }`,
  ].join(' ');
