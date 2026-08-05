/**
 * The dashboard's typed configuration, and the only place it reads an
 * environment variable.
 *
 * A deliberate sibling of `apps/ingest/src/config/configuration.ts` rather than
 * a shared import, for two reasons that are about correctness rather than
 * taste:
 *
 *   - the ingest reader is keyed to ingest's own `NUMERIC_KEYS` union and
 *     `CONFIG_DEFAULTS` table, so importing it here would mean one app's key
 *     list growing every time the other gained a setting; and
 *   - a port is not "a number >= 1". It has a real upper bound, and the ingest
 *     reader has no concept of one, so `DASHBOARD_PORT=99999` would pass its
 *     validation and then fail inside `listen()` with an error that names
 *     neither the variable nor the limit.
 *
 * What is NOT re-derived is the discipline. `Number.isFinite` is the
 * load-bearing clause and is not interchangeable with a bare lower bound: the
 * realistic bad value is `NaN`, which is what `Number('')` and
 * `parseInt('abc')` produce, and `NaN < 1` is FALSE — so `if (value < 1) throw`
 * ACCEPTS it. `app.listen(NaN, '127.0.0.1')` then binds a random ephemeral
 * port, the process logs that it started, and the URL in the README answers
 * nothing. That class of bug has been fixed repeatedly in this project; it is
 * not being reintroduced for the sake of one shared function.
 */

export interface DashboardConfig {
  readonly mongoUri: string;
  /** TCP port to listen on. */
  readonly port: number;
  /**
   * Interface to bind. Loopback, and not configurable, on purpose — see
   * `dashboard.module.ts` for why this server must not be reachable off-host.
   */
  readonly host: string;
}

/**
 * Loopback, hard-coded. This is a read-only view over an unauthenticated
 * database and it has no login of its own; the only thing standing between it
 * and anyone on the network is the interface it binds. Making that an
 * environment variable would make `0.0.0.0` a one-line mistake.
 */
export const DASHBOARD_HOST = '127.0.0.1';

/**
 * Defaults applied when a key is absent. Absent is not an operator error —
 * these are the documented, shipped values — so it is the only case that does
 * not throw.
 *
 * 7717 rather than 3000: 3000, 4000, 5000 and 8081 were all already listening
 * on this machine when the port was chosen, and a dashboard that silently
 * collides with another project's dev server is worse than one on an odd port.
 * It also rhymes with the 27117 Mongo is on, which is itself off its default
 * for the same reason.
 */
export const DASHBOARD_DEFAULTS = {
  MONGO_URI: 'mongodb://localhost:27117/redbox',
  DASHBOARD_PORT: 7717,
} as const;

/** Lowest port this will bind. Ports below 1024 need privileges this app must never have. */
export const MIN_PORT = 1024;

/** Highest port there is. */
export const MAX_PORT = 65_535;

/**
 * Reads the listen port, or stops the process saying which key and why.
 *
 * `Number` rather than `parseInt` on purpose: `parseInt('7717abc')` is 7717 and
 * `parseInt('1e4')` is 1, both of which quietly accept a value the operator did
 * not write. `Number` rejects trailing junk outright.
 *
 * The four checks are ordered so the message names the fix. "Not finite", "not
 * whole" and "out of range" are three different operator mistakes, and
 * collapsing them would leave `DASHBOARD_PORT=abc` and `DASHBOARD_PORT=0.5`
 * indistinguishable in the log that stops the process.
 */
export const readPort = (env: NodeJS.ProcessEnv): number => {
  const raw = env.DASHBOARD_PORT;

  // `KEY=` is how a .env file spells "not set"; reading it as 0 would bind a
  // random ephemeral port, which is the least useful possible reading of an
  // operator's blank line.
  if (raw === undefined || raw.trim() === '') {
    return DASHBOARD_DEFAULTS.DASHBOARD_PORT;
  }

  const value = Number(raw);

  if (!Number.isFinite(value)) {
    throw new Error(
      `DASHBOARD_PORT must be a finite number, but was "${raw}". A non-finite ` +
        'value is accepted by a bare lower-bound check and then binds a random ' +
        'ephemeral port, so it is rejected at load.',
    );
  }

  if (!Number.isInteger(value)) {
    throw new Error(`DASHBOARD_PORT must be a whole number, but was "${raw}".`);
  }

  if (value < MIN_PORT || value > MAX_PORT) {
    throw new Error(
      `DASHBOARD_PORT must be between ${MIN_PORT} and ${MAX_PORT}, but was "${raw}". ` +
        'Ports below 1024 require privileges a read-only viewer must never hold.',
    );
  }

  return value;
};

/**
 * Reads one string setting, treating a blank assignment as unset — the same
 * rule as `readPort`, and that consistency is the point. A `MONGO_URI=` line
 * read as `''` produces a connection attempt against an empty string, which
 * fails with a message about the driver rather than about the config.
 */
export const readString = (
  key: string,
  env: NodeJS.ProcessEnv,
  fallback: string,
): string => {
  const raw = env[key];
  return raw === undefined || raw.trim() === '' ? fallback : raw;
};

/**
 * Builds the configuration, or throws naming the offending key.
 *
 * Takes the environment as an argument so it can be tested without mutating a
 * global. Nest's `ConfigModule` calls it with no arguments, after it has merged
 * any `.env` file into `process.env`.
 */
export const loadDashboardConfig = (
  env: NodeJS.ProcessEnv = process.env,
): DashboardConfig => ({
  mongoUri: readString('MONGO_URI', env, DASHBOARD_DEFAULTS.MONGO_URI),
  port: readPort(env),
  host: DASHBOARD_HOST,
});

/**
 * Strips the `user:password@` section of a connection string.
 *
 * A mongo URI routinely carries credentials, and the startup line below is the
 * one place the configuration is printed. Redacting is not optional: a password
 * in a log file outlives the process that wrote it.
 */
const redactCredentials = (uri: string): string =>
  uri.replace(/\/\/[^@/]*@/, '//***@');

/** A single startup line describing the configuration actually in force. */
export const describeDashboardConfig = (config: DashboardConfig): string =>
  [
    `mongo=${redactCredentials(config.mongoUri)}`,
    `bind=${config.host}:${config.port}`,
    'mode=read-only',
  ].join(' ');
