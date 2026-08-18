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

// NOT from the barrel. `libs/common` depends on nothing, but this module is
// read before the container exists and a barrel import is how that stops
// being true later.
import { describeMongoTarget } from '@app/common/mongo-target';

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
  /**
   * Whether the Admin view and the three routes only it reads exist at all.
   *
   * NOT A PERMISSION AND NOT A ROLE. It is whether the instrument panel is
   * BUILT — see `readAdminEnabled` for the rule and why it is two signals.
   */
  readonly adminEnabled: boolean;
  /**
   * What this process's `X-Forwarded-*` headers are worth, handed to express's
   * `trust proxy` verbatim. `false` — express's own default — means they are
   * not read at all.
   *
   * See `readTrustProxy` for the two forms and for why `true` is refused.
   */
  readonly trustProxy: boolean | number | string;
  /**
   * Origins allowed to call this API cross-origin, or empty.
   *
   * NOT the browser path. The React client is served same-origin by the Caddy
   * sidecar, so it never makes a cross-origin request and never needs this.
   * It exists for a local React dev server on another port, a staging build,
   * and non-browser clients.
   *
   * Empty allows nothing, and a wildcard is refused outright: `*` and
   * `credentials` are mutually exclusive per the CORS specification, so
   * honouring one would produce a server that answers every preflight and
   * still drops every session.
   */
  readonly corsAllowedOrigins: readonly string[];
  /**
   * Which client a SIGNED-IN reader is served at `GET /`: the server-rendered
   * page, or the React bundle. The signed-out branch — the landing page — is
   * identical in both modes, and the switch is this variable alone: the dist
   * ships inside the image either way, so rollback is unsetting it, never an
   * image build. See `readWebClient` for why a typo stops the process.
   */
  readonly webClient: 'server' | 'react';
  /**
   * Where the React bundle lives when `webClient` is `react`. The laptop
   * layout by default; the Dockerfile sets `/srv/web`, where the image copies
   * the dist. Never read in server mode.
   */
  readonly webDistDir: string;
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

/**
 * Hostnames that mean "this machine, reached from this machine".
 *
 * Written out rather than pattern-matched. `127.0.0.0/8` is entirely loopback
 * and a range test would accept `127.13.9.2`, which is loopback and is also not
 * anything this application is ever configured with — a gate should recognise
 * the shipped values and refuse the rest.
 */
const LOOPBACK_HOSTS: readonly string[] = ['127.0.0.1', 'localhost', '[::1]'];

/**
 * Whether the Admin view and its routes are built into this process.
 *
 * ================================================================
 * WHAT ADMIN IS, AND WHY IT IS NOT A ROLE
 * ================================================================
 *
 * Admin is the instrument panel: the filings table, the enrichment and refusal
 * breakdowns, the parse routes, the daily bars. Every one of those is a fact
 * about THIS PIPELINE rather than about a company — how much it refused, how
 * much it could not read, how far behind it is. `page.ts` argues the split; this
 * is the consequence of taking it seriously. A reader has no use for it, and a
 * stranger reading how much of the corpus we failed to parse is a description of
 * our own machinery given to somebody who did not ask for it.
 *
 * So it is not hidden behind a role. It is NOT SHIPPED: no tab, no markup, no
 * client fragment, and the three routes only it reads answer 404. A surface that
 * is not built cannot be reached by guessing a URL, and there is no admin flag
 * on a user row to leak, mis-set, or forget to revoke.
 *
 * ================================================================
 * THE RULE
 * ================================================================
 *
 *   ADMIN_ENABLED=true|false    explicit, and it wins in both directions
 *   otherwise                   NODE_ENV is not 'production'
 *                               AND `PUBLIC_ORIGIN` is a loopback origin
 *
 * TWO SIGNALS, BOTH REQUIRED, because either one alone is a single line an
 * operator can forget. `NODE_ENV` is a convention with no enforcement — a host
 * started without it looks exactly like a laptop — and the loopback bind cannot
 * discriminate on its own: `DASHBOARD_HOST` is hard-coded to `127.0.0.1` and is
 * deliberately not configurable, so *every* deployment binds loopback, including
 * the one behind the public reverse proxy. What actually distinguishes them is
 * `PUBLIC_ORIGIN`: it defaults to this process's own loopback URL and MUST be
 * set to the public https origin behind the proxy, or every mutation from the
 * real page is refused. A host serving the internet therefore cannot leave it at
 * the loopback default and still work, which is what makes it a signal rather
 * than a wish.
 *
 * FAILS CLOSED, AND SAYS SO. An origin this cannot parse is not loopback, so
 * Admin is off — and `describeDashboardConfig` prints `admin=off` at boot, which
 * is where an operator who expected it looks first.
 */
export const readAdminEnabled = (
  env: NodeJS.ProcessEnv,
  publicOrigin: string,
): boolean => {
  const raw = env.ADMIN_ENABLED;

  if (raw !== undefined && raw.trim() !== '') {
    const wanted = raw.trim().toLowerCase();
    if (wanted === 'true' || wanted === 'false') return wanted === 'true';

    throw new Error(
      `ADMIN_ENABLED must be "true" or "false", but was "${raw}". It decides ` +
        'whether the operator panel and its routes are built into this ' +
        'process, so an unreadable value is not guessed at.',
    );
  }

  return env.NODE_ENV !== 'production' && isLoopbackOrigin(publicOrigin);
};

/**
 * Which client a signed-in reader is served, or stops the process.
 *
 * `server` (the default, and what an unset or blank variable means) or the
 * exact word `react`. Anything else THROWS rather than guessing: the operator
 * touching this flag is mid-cutover, and a typo silently meaning `server` is
 * a rollback nobody asked for — the same fail-loud rule as `ADMIN_ENABLED`.
 */
export const readWebClient = (env: NodeJS.ProcessEnv): 'server' | 'react' => {
  const raw = env.WEB_CLIENT;
  if (raw === undefined || raw.trim() === '') return 'server';

  const wanted = raw.trim();
  if (wanted === 'server' || wanted === 'react') return wanted;

  throw new Error(
    `WEB_CLIENT must be "server" or "react", but was "${raw}". It decides ` +
      'which client a signed-in reader is served, so an unreadable value is ' +
      'not guessed at.',
  );
};

/**
 * Reads what the `X-Forwarded-*` headers are worth, or stops the process.
 *
 * ================================================================
 * OFF UNLESS SET, AND OFF IS EXPRESS'S OWN DEFAULT
 * ================================================================
 *
 * With `TRUST_PROXY` absent this returns `false`, which is the value express
 * already holds, so the shipped loopback deployment reads no forwarded header
 * at all. That is the correct posture there rather than a limitation: nothing
 * stands between the browser and this process, so `X-Forwarded-Proto: https` is
 * not a fact a proxy established but a sentence whoever connected chose to
 * write.
 *
 * ================================================================
 * THE VALUE IS THE SPECIFICATION, NOT A FLAG
 * ================================================================
 *
 * How many proxies sit in front of this process is a property of the
 * deployment, so the deployment states it. Two forms, both express's:
 *
 *   TRUST_PROXY=2                 hop count, counted back from this process
 *   TRUST_PROXY=10.0.0.0/8,::1    comma-separated addresses, subnets, presets
 *
 * A digit string is CONVERTED rather than passed through, because express parses
 * a string as a list of ADDRESSES: `TRUST_PROXY=2` handed over verbatim throws
 * `invalid IP address: 2` from inside `app.set`, which is loud but names
 * neither the variable nor the form. The address form is left to express to
 * parse — it owns the syntax, and it throws at boot on junk.
 *
 * ================================================================
 * `true` IS REFUSED, AND IT IS THE ONLY VALUE THIS REJECTS
 * ================================================================
 *
 * `trust proxy: true` tells express every hop is trustworthy, and express then
 * walks `X-Forwarded-For` all the way to its LEFTMOST entry — the one furthest
 * from this process and the one the client wrote. The forwarded headers become
 * a request the caller makes rather than a fact the chain established: a rate
 * limiter keyed on an address the attacker picks, and a `Secure` decision made
 * by whoever asked. A precise specification instead stops the walk at the first
 * hop it does not recognise, which is what makes the resolved address
 * unforgeable. Refused here rather than documented, because it is one word and
 * it silently undoes the reason this setting exists.
 */
export const readTrustProxy = (
  env: NodeJS.ProcessEnv,
): boolean | number | string => {
  const raw = env.TRUST_PROXY;

  // `TRUST_PROXY=` is how a .env file spells "not set", and unset is off.
  if (raw === undefined || raw.trim() === '') return false;

  const value = raw.trim();

  // Explicitly off, so a host can say so out loud rather than by omission.
  if (value.toLowerCase() === 'false') return false;

  if (value.toLowerCase() === 'true') {
    throw new Error(
      'TRUST_PROXY must not be "true". It trusts every hop, so the address ' +
        'this process resolves is the leftmost X-Forwarded-For entry — which ' +
        'the client writes, making the rate-limit identity and the Secure ' +
        "cookie decision the caller's to choose. Give the number of proxies " +
        'in front of this process (TRUST_PROXY=2), or the addresses they ' +
        'connect from.',
    );
  }

  // A hop count. `Number` rather than `parseInt` for the same reason `readPort`
  // uses it, and the pattern has already excluded everything `Number` would
  // misread — no sign, no decimal point, no trailing junk.
  if (/^\d+$/.test(value)) return Number(value);

  return value;
};

/**
 * Reads the cross-origin allowlist, or stops the process on a wildcard.
 *
 * Unset and blank both mean the empty list, which allows nothing — the same
 * fail-closed rule every other key here follows, and the correct production
 * value: the React client is served same-origin by the Caddy sidecar, so CORS
 * never engages at all. A `CORS_ALLOWED_ORIGINS=` line parsed to `['']` would
 * be worse than useless, because an empty entry matches a request that sent no
 * `Origin` header.
 */
const readCorsAllowedOrigins = (env: NodeJS.ProcessEnv): readonly string[] => {
  const raw = env.CORS_ALLOWED_ORIGINS;
  if (raw === undefined || raw.trim() === '') return [];

  const origins = raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin !== '');

  if (origins.includes('*')) {
    throw new Error(
      'CORS_ALLOWED_ORIGINS may not be `*`: a wildcard cannot carry ' +
        'credentials, so every session cookie and Bearer header would be ' +
        'dropped. Name the origins.',
    );
  }

  return origins;
};

/** Whether an origin names this machine. Unparseable is not loopback. */
const isLoopbackOrigin = (origin: string): boolean => {
  try {
    return LOOPBACK_HOSTS.includes(new URL(origin).hostname);
  } catch {
    return false;
  }
};

export const loadDashboardConfig = (
  env: NodeJS.ProcessEnv = process.env,
): DashboardConfig => {
  const port = readPort(env);
  const publicOrigin = readString(
    'PUBLIC_ORIGIN',
    env,
    `http://${DASHBOARD_HOST}:${port}`,
  );

  return {
    mongoUri: readString('MONGO_URI', env, DASHBOARD_DEFAULTS.MONGO_URI),
    port,
    host: DASHBOARD_HOST,
    sessionTtlDays: readSessionTtlDays(env),
    // Defaulted to this process's own URL rather than left blank, because a
    // blank one fails CLOSED in `isAllowedOrigin` — which is right for a
    // misconfiguration and wrong for the shipped loopback deployment, where
    // every mutation would be refused before anyone had configured anything.
    publicOrigin,
    auth: loadAuthConfig(env),
    adminEnabled: readAdminEnabled(env, publicOrigin),
    trustProxy: readTrustProxy(env),
    corsAllowedOrigins: readCorsAllowedOrigins(env),
    webClient: readWebClient(env),
    webDistDir: readString('WEB_DIST_DIR', env, 'apps/web/dist'),
  };
};

/** A single startup line describing the configuration actually in force. */
export const describeDashboardConfig = (config: DashboardConfig): string =>
  [
    `mongo=${describeMongoTarget(config.mongoUri)}`,
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
    // WHETHER THE INSTRUMENT PANEL EXISTS ON THIS HOST. Printed because it is a
    // surface that is either built or absent, with no runtime way to tell from
    // the outside: an operator who cannot find the Admin tab reads this line
    // and learns whether it was refused or never made.
    `admin=${config.adminEnabled ? 'on' : 'off'}`,
    // WHICH CLIENT A SIGNED-IN READER IS SERVED. Printed because the cutover
    // and its rollback are this one variable, and mid-cutover this line is
    // where an operator confirms which side of it a restarted process is on.
    `web=${config.webClient}`,
    // WHAT THE FORWARDED HEADERS ARE WORTH ON THIS HOST. Printed because the
    // two things that key off it — which address the rate limiter counts, and
    // whether the session cookie carries `Secure` — are both invisible until
    // somebody is already locked out or already signed out. `proxy=off` beside
    // an `origin=https://...` line is the shape of a misconfigured deployment,
    // and this is where it shows.
    `proxy=${config.trustProxy === false ? 'off' : String(config.trustProxy)}`,
    // HOW MANY ORIGINS MAY CALL THIS API CROSS-ORIGIN, and `cors=0` is the
    // shipped production value rather than a warning: the React client is
    // served same-origin by the Caddy sidecar and never makes a cross-origin
    // request. It is printed because `cors=0` is also the shape of a dev
    // server whose origin was never added, and a blocked preflight says
    // nothing about which of the two happened.
    `cors=${config.corsAllowedOrigins.length}`,
    // WHICH WAY IN IS OPEN, and whether it actually works. A host running
    // `AUTH_MODE=firebase` with no project keys serves a sign-in page nobody
    // can sign in through, and this line is where an operator looks first.
    describeAuthConfig(config.auth),
  ].join(' ');
