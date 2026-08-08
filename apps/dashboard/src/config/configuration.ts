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

import {
  describeAuthConfig,
  loadAuthConfig,
  type AuthConfig,
} from './auth-config';

export interface DashboardConfig {
  readonly mongoUri: string;
  /** TCP port to listen on. */
  readonly port: number;
  /**
   * Interface to bind. Loopback, and not configurable, on purpose — see
   * `dashboard.module.ts` for why this server must not be reachable off-host.
   */
  readonly host: string;
  /**
   * How long a session lives without being used. Thirty days.
   *
   * Configurable because it is a product decision an operator may reasonably
   * disagree with, unlike the bind. Bounded on both sides: a zero would make
   * every login expire instantly and a value in the thousands would make
   * revocation the only expiry there is.
   */
  readonly sessionTtlDays: number;
  /**
   * The one origin allowed to POST to this application.
   *
   * The second CSRF layer after `SameSite=Lax` — see `origin-guard.ts`. It
   * defaults to this process's own loopback URL, so day one needs no
   * configuration; behind the reverse proxy it must be set to the public
   * https origin, or every mutation from the real page is refused.
   *
   * In production that value is `https://disclosed.live`, and it is CONFIGURED
   * rather than compiled in. Hard-coding the brand's domain into the origin
   * check would break every loopback run and every e2e port, which is precisely
   * the failure this default exists to avoid. `ui/brand.ts` carries the domain
   * as copy for the landing page; nothing in the request path reads it.
   */
  readonly publicOrigin: string;
  /**
   * Which identity provider signs people in, and its keys.
   *
   * Read by `auth-config.ts`, which owns the whole decision table and its spec.
   * It is a nested object rather than four more flat fields because the invalid
   * combinations — a mode with half a project configured — have to be
   * representable and named, and a flat `firebaseProjectId?: string` cannot say
   * "asked for, not supplied".
   */
  readonly auth: AuthConfig;
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
  MONGO_URI: 'mongodb://localhost:27117/turret',
  DASHBOARD_PORT: 7717,
  /**
   * Thirty days. Long enough that a reader who opens this weekly is not signed
   * out between visits, short enough that a device nobody has touched in a
   * month stops being a way in. It slides forward on use, at most hourly.
   */
  SESSION_TTL_DAYS: 30,
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
/** Bounds on the session TTL. A day is the floor; a year is the ceiling. */
export const MIN_SESSION_TTL_DAYS = 1;
export const MAX_SESSION_TTL_DAYS = 365;

/**
 * Reads the session lifetime, or stops the process naming the key and the bound.
 *
 * The same four checks `readPort` makes, and for the same reason:
 * `SESSION_TTL_DAYS=abc` is `NaN`, `NaN < 1` is FALSE, and a bare lower bound
 * would accept it — after which every session's `expiresAt` is an Invalid Date,
 * the TTL index cannot act on it, and sessions never expire at all.
 */
export const readSessionTtlDays = (env: NodeJS.ProcessEnv): number => {
  const raw = env.SESSION_TTL_DAYS;
  if (raw === undefined || raw.trim() === '') {
    return DASHBOARD_DEFAULTS.SESSION_TTL_DAYS;
  }

  const value = Number(raw);

  if (!Number.isFinite(value)) {
    throw new Error(
      `SESSION_TTL_DAYS must be a finite number, but was "${raw}". A ` +
        'non-finite value produces an Invalid Date on every session, which ' +
        'the TTL index cannot expire — so sessions would never end.',
    );
  }

  if (!Number.isInteger(value)) {
    throw new Error(
      `SESSION_TTL_DAYS must be a whole number of days, but was "${raw}".`,
    );
  }

  if (value < MIN_SESSION_TTL_DAYS || value > MAX_SESSION_TTL_DAYS) {
    throw new Error(
      `SESSION_TTL_DAYS must be between ${MIN_SESSION_TTL_DAYS} and ` +
        `${MAX_SESSION_TTL_DAYS}, but was "${raw}".`,
    );
  }

  return value;
};

export const loadDashboardConfig = (
  env: NodeJS.ProcessEnv = process.env,
): DashboardConfig => {
  const port = readPort(env);

  return {
    mongoUri: readString('MONGO_URI', env, DASHBOARD_DEFAULTS.MONGO_URI),
    port,
    host: DASHBOARD_HOST,
    sessionTtlDays: readSessionTtlDays(env),
    // Defaulted to this process's own URL rather than left blank, because a
    // blank one fails CLOSED in `isAllowedOrigin` — which is right for a
    // misconfiguration and wrong for the shipped loopback deployment, where
    // every mutation would be refused before anyone had configured anything.
    publicOrigin: readString(
      'PUBLIC_ORIGIN',
      env,
      `http://${DASHBOARD_HOST}:${port}`,
    ),
    auth: loadAuthConfig(env),
  };
};

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
    // NO LONGER `mode=read-only` UNQUALIFIED. This process now writes `users`,
    // `sessions` and `watchlists`, and it still never writes a filing — which
    // is the claim the narrowed `FilingReadModel` actually enforces. A startup
    // line that kept saying "read-only" would be the one place an operator
    // looks to find out what this process can do to their database, and it
    // would be wrong.
    'filings=read-only',
    `accounts=read-write ttl=${config.sessionTtlDays}d`,
    `origin=${config.publicOrigin}`,
    // WHICH WAY IN IS OPEN, and whether it actually works. A host running
    // `AUTH_MODE=firebase` with no project keys serves a sign-in page nobody
    // can sign in through, and this line is where an operator looks first.
    describeAuthConfig(config.auth),
  ].join(' ');
