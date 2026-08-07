import { createHash, randomBytes } from 'crypto';

/**
 * The session handle: an opaque token, the hash that stands in for it in the
 * database, and the exact cookie that carries it.
 *
 * ================================================================
 * WHY AN OPAQUE TOKEN AND NOT A JWT
 * ================================================================
 *
 * A JWT saves one indexed read per authenticated request and cannot do
 * revocation — and every operation this product needs IS a revocation: "log me
 * out", "log me out everywhere", "I changed my password", "delete my account".
 * The standard answers are a short expiry plus a refresh token, which is a
 * stored session with extra moving parts, or a denylist, which is a session
 * store built inside out and growing without bound.
 *
 * ================================================================
 * THE RAW TOKEN IS NEVER STORED
 * ================================================================
 *
 * What the database holds is `sha256(token)`. A dump of the sessions collection
 * is then a list of hashes rather than a set of working credentials, and the
 * lookup is still a single `findOne({tokenHash})` on a unique index. No
 * stretching: the token is 256 bits of `randomBytes`, so there is no guessable
 * input for a slow hash to protect.
 */

/** The cookie's name. One name, in one place, or the reader and writer drift. */
export const SESSION_COOKIE = 'turret_sid';

/** 256 bits. The token is a bearer credential whose only defence is its size. */
export const SESSION_TOKEN_BYTES = 32;

/** How long a session lives without being renewed. */
export const DEFAULT_SESSION_TTL_DAYS = 30;

/**
 * How stale `lastSeenAt` must be before a request writes a new one.
 *
 * AN HOUR, and the number is about writes rather than about security. The
 * Watching tab polls every four seconds; renewing on every request would be one
 * write per four seconds per open tab against the database the poller is
 * writing filings to. An hour makes an active reader cost at most 24 writes a
 * day and still slides a 30-day expiry forward for anyone who keeps using the
 * product.
 */
export const RENEW_AFTER_MS = 3_600_000;

const MS_PER_DAY = 86_400_000;

/** A minted session: the value that goes to the browser, and the one that is stored. */
export interface MintedSession {
  /** Sent once, in a `Set-Cookie`, and never written down. */
  readonly token: string;
  /** `sha256(token)`, hex. This is what the session document holds. */
  readonly tokenHash: string;
}

/** `sha256`, hex. */
export const hashSessionToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

/**
 * A fresh session token.
 *
 * `base64url`, so the value needs no escaping in a cookie, a header or a URL —
 * and so the cookie parser below can insist on that alphabet and refuse
 * anything else without a round trip to the database.
 */
export const mintSessionToken = (): MintedSession => {
  const token = randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
  return { token, tokenHash: hashSessionToken(token) };
};

/** The TTL, ahead of the clock it was handed. Never mutates that clock. */
export const sessionExpiry = (now: Date, ttlDays: number): Date =>
  new Date(now.getTime() + ttlDays * MS_PER_DAY);

/**
 * Whether this request should write a new `lastSeenAt`.
 *
 * True when nothing was ever recorded, and true when the clock appears to have
 * gone backwards — both are "we do not know", and the safe answer to that is
 * one extra write rather than a session that never slides again.
 */
export const needsRenewal = (lastSeenAt: Date | null, now: Date): boolean => {
  if (lastSeenAt === null) return true;
  const elapsed = now.getTime() - lastSeenAt.getTime();
  if (!Number.isFinite(elapsed)) return true;
  return elapsed >= RENEW_AFTER_MS || elapsed < 0;
};

/** What the cookie's attributes depend on. */
export interface CookieOptions {
  /**
   * Whether the connection is https.
   *
   * NOT ALWAYS TRUE, and that is not a weakening. A `Secure` cookie set over
   * plain http is discarded by the browser SILENTLY, which presents as a login
   * that succeeds and is then immediately forgotten — on a loopback deployment
   * with no TLS, which is day one. Behind the reverse proxy this is true and
   * the flag is set.
   */
  readonly secure: boolean;
}

/**
 * Refuses a value that could break out of the header.
 *
 * The token is ours and is base64url, so this can only fire on a bug — but a
 * cookie value carrying CR or LF is a response-splitting shape, and assembling
 * one quietly is how that ships.
 */
const assertHeaderSafe = (value: string): void => {
  if (/[\s;,"\\]/.test(value)) {
    throw new Error('Refusing to set a session cookie with an unsafe value.');
  }
};

const attributes = (secure: boolean): readonly string[] => [
  // The whole origin, so a session set on `/api/auth/login` is presented on
  // `/api/watchlist` and on the page itself.
  'Path=/',
  // No script may read it. This is the control that survives an XSS elsewhere.
  'HttpOnly',
  // LAX RATHER THAN STRICT. Strict withholds the cookie on ANY inbound
  // top-level navigation, which breaks a link from an email into a signed-in
  // page — and the email lane is the next thing to land. Lax still withholds it
  // on cross-site POST, which is the CSRF case that matters; the Origin guard
  // is the second layer.
  'SameSite=Lax',
  ...(secure ? ['Secure'] : []),
];

/** The `Set-Cookie` value that signs a browser in. */
export const sessionCookie = (
  token: string,
  options: CookieOptions & { readonly ttlDays: number },
): string => {
  assertHeaderSafe(token);
  const maxAge = Math.round(options.ttlDays * MS_PER_DAY) / 1000;
  return [
    `${SESSION_COOKIE}=${token}`,
    ...attributes(options.secure),
    `Max-Age=${maxAge}`,
  ].join('; ');
};

/**
 * The `Set-Cookie` value that signs a browser out.
 *
 * REPEATS EVERY ATTRIBUTE of the cookie it replaces. A browser matches a
 * replacement on name, path and domain, so a clear that omits `Path=/` leaves
 * the original cookie in place — and the user stays signed in after clicking
 * sign out, which is the worst possible way for this to fail.
 */
export const clearedSessionCookie = (options: CookieOptions): string =>
  [`${SESSION_COOKIE}=`, ...attributes(options.secure), 'Max-Age=0'].join('; ');

/** The alphabet `mintSessionToken` emits, and nothing else is looked up. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]+$/;

/**
 * Reads the session token out of a `Cookie` header, or null.
 *
 * Parsed here rather than with `cookie-parser` because this is the only cookie
 * this application reads, and the shape check is the point: a value that is not
 * token-shaped cannot be one we minted, so refusing it costs an indexed read
 * per junk request rather than performing one.
 */
export const readSessionCookie = (
  header: string | undefined,
): string | null => {
  if (typeof header !== 'string' || header === '') return null;

  for (const pair of header.split(';')) {
    const at = pair.indexOf('=');
    if (at < 0) continue;
    if (pair.slice(0, at).trim() !== SESSION_COOKIE) continue;

    const value = pair.slice(at + 1).trim();
    // An empty value is exactly what `clearedSessionCookie` leaves behind, and
    // reading it as a token would be one `sha256('')` lookup per signed-out
    // request.
    return value !== '' && TOKEN_SHAPE.test(value) ? value : null;
  }

  return null;
};
