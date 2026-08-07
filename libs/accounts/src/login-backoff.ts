/**
 * The per-account half of the brute-force defence.
 *
 * TWO INDEPENDENT LIMITERS, because either alone is defeatable. The per-IP
 * throttle stops one host hammering one endpoint and is defeated by a botnet;
 * this one is keyed on the account and stops a distributed attack against one
 * address. Neither replaces the other.
 *
 * BACKOFF, NOT LOCKOUT. A hard lockout after N failures hands an attacker a
 * denial of service against any user whose email address they know — five wrong
 * guesses and the owner is out. A backoff that caps at fifteen minutes leaves
 * an attacker four attempts an hour, which is hopeless against any password
 * that clears the policy, and leaves the real owner delayed rather than locked
 * out.
 *
 * IT IS NEVER AN ORACLE. A backed-off account returns the same status and the
 * same body as a wrong password — otherwise the lockout response itself
 * announces that the address is real and that somebody is attacking it.
 */

/** Consecutive failures tolerated before any delay at all. */
export const BACKOFF_AFTER_FAILURES = 5;

/**
 * The ceiling: fifteen minutes.
 *
 * Long enough that online guessing is pointless (four attempts an hour), short
 * enough that a person who mistyped their password five times is not locked out
 * of their evening.
 */
export const MAX_BACKOFF_MS = 900_000;

/** The first rung, quadrupling: 1s, 4s, 16s, 64s, 256s, then the cap. */
const FIRST_STEP_MS = 1_000;
const GROWTH = 4;

/**
 * How long the account waits after this many consecutive failures.
 *
 * The cap is applied with `Math.min` on a term that is computed first, and the
 * exponent is bounded before it is used: `4 ** 1000` is `Infinity`, and an
 * `Infinity` reaching `new Date()` produces an Invalid Date, which compares
 * false against everything — silently removing the backoff at exactly the
 * failure count where it matters most.
 */
export const backoffMsFor = (failedLoginCount: number): number => {
  if (!Number.isFinite(failedLoginCount)) return 0;
  const failures = Math.floor(failedLoginCount);
  if (failures < BACKOFF_AFTER_FAILURES) return 0;

  const steps = Math.min(failures - BACKOFF_AFTER_FAILURES, 20);
  return Math.min(FIRST_STEP_MS * GROWTH ** steps, MAX_BACKOFF_MS);
};

/**
 * The moment this account may try again, or null when it may try now.
 *
 * Null rather than "now" so the caller can `$unset` the field instead of
 * storing a date that means nothing.
 */
export const lockedUntilFor = (
  failedLoginCount: number,
  now: Date,
): Date | null => {
  const wait = backoffMsFor(failedLoginCount);
  return wait === 0 ? null : new Date(now.getTime() + wait);
};

/**
 * Whether the stored moment is still in the future.
 *
 * FAILS OPEN on an unusable stored value. A pre-migration or hand-edited
 * document must not lock a real person out with no way back, and the per-IP
 * throttle is still in front of this route either way.
 */
export const isLockedOut = (lockedUntil: Date | null, now: Date): boolean => {
  if (lockedUntil === null) return false;
  const until = lockedUntil.getTime();
  if (!Number.isFinite(until)) return false;
  return until > now.getTime();
};
