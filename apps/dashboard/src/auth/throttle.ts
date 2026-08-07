import { SkipThrottle } from '@nestjs/throttler';

/**
 * The rate-limit buckets, named once.
 *
 * THE NAMES ARE THE CONTRACT AND THEY ARE EASY TO GET WRONG. Every configured
 * throttler applies to every route the guard covers, and a route opts out by
 * naming the bucket in `@SkipThrottle`. A bare `@SkipThrottle()` skips a bucket
 * called `default` — which does not exist here, because all three are named —
 * so it silently skips NOTHING and the route stays limited. That shipped once:
 * `api/me` is one read per page load and was being refused with a 429 after ten
 * page loads from one address, which the browser suite caught and a unit test
 * could not have.
 *
 * So the names live here, the module builds its configuration from this table,
 * and the two decorators below are the only way a route opts out.
 */
export const THROTTLE_BUCKETS = [
  /**
   * The burst limit on the routes an attacker attacks without an account.
   * Ten a minute is far above a person mistyping their password and far below
   * anything worth calling an attempt.
   */
  { name: 'auth-minute', ttl: 60_000, limit: 10 },
  /**
   * The sustained limit, and it is not redundant: 10/min alone permits 600 an
   * hour, which is a real credential-stuffing budget.
   */
  { name: 'auth-hour', ttl: 3_600_000, limit: 60 },
  /** Watchlist mutations. A person adding companies does not exceed this. */
  { name: 'watchlist-minute', ttl: 60_000, limit: 60 },
] as const;

const record = (
  names: ReadonlyArray<(typeof THROTTLE_BUCKETS)[number]['name']>,
): Record<string, boolean> =>
  Object.fromEntries(names.map((name) => [name, true]));

/**
 * Opts a route out of every bucket.
 *
 * For READS. The public-reads limit is a reverse-proxy concern and belongs to
 * the exposure gate; on loopback the only client is the page itself, and the
 * page polls `api/watchlist/feed` every four seconds while its tab is open.
 */
export const SkipEveryLimit = (): MethodDecorator & ClassDecorator =>
  SkipThrottle(record(THROTTLE_BUCKETS.map((bucket) => bucket.name)));

/** Opts a route out of the auth buckets, leaving the watchlist one in force. */
export const SkipAuthLimits = (): MethodDecorator & ClassDecorator =>
  SkipThrottle(record(['auth-minute', 'auth-hour']));

/** Opts a route out of the watchlist bucket, leaving the auth ones in force. */
export const SkipWatchlistLimit = (): MethodDecorator & ClassDecorator =>
  SkipThrottle(record(['watchlist-minute']));
