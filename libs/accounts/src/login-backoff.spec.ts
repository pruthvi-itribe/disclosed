import {
  BACKOFF_AFTER_FAILURES,
  backoffMsFor,
  isLockedOut,
  lockedUntilFor,
  MAX_BACKOFF_MS,
} from './login-backoff';

/**
 * The per-account half of the brute-force defence.
 *
 * BACKOFF, NOT LOCKOUT, and the difference is the whole design. A hard lockout
 * hands an attacker a denial of service against any user whose address they
 * know: five wrong guesses and the real owner is out. A backoff that caps at
 * fifteen minutes makes online guessing hopeless — 4 attempts an hour — without
 * letting anyone lock anyone out.
 */

const now = new Date('2026-08-08T04:00:00.000Z');

describe('backoffMsFor', () => {
  it('is free for the first four failures', () => {
    // Typing a password wrong four times is a Tuesday, not an attack.
    for (let failures = 0; failures < BACKOFF_AFTER_FAILURES; failures += 1) {
      expect([failures, backoffMsFor(failures)]).toEqual([failures, 0]);
    }
  });

  it.each<[number, number]>([
    [5, 1_000],
    [6, 4_000],
    [7, 16_000],
    [8, 64_000],
    [9, 256_000],
  ])('backs off %s failures by %sms', (failures, expected) => {
    expect(backoffMsFor(failures)).toBe(expected);
  });

  it('caps at fifteen minutes', () => {
    expect(backoffMsFor(10)).toBe(MAX_BACKOFF_MS);
    expect(backoffMsFor(50)).toBe(MAX_BACKOFF_MS);
    expect(MAX_BACKOFF_MS).toBe(900_000);
  });

  it('caps rather than overflowing, however absurd the count', () => {
    // `4 ** 1000` is Infinity, and an Infinity reaching `new Date()` is an
    // Invalid Date that compares false against everything — which silently
    // removes the backoff entirely at exactly the count where it matters most.
    expect(backoffMsFor(1_000)).toBe(MAX_BACKOFF_MS);
    expect(Number.isFinite(backoffMsFor(1_000))).toBe(true);
  });

  it('treats a negative or non-integer count as no backoff rather than throwing', () => {
    expect(backoffMsFor(-1)).toBe(0);
    expect(backoffMsFor(Number.NaN)).toBe(0);
  });
});

describe('lockedUntilFor', () => {
  it('is null while the count is under the threshold, so nothing is stored', () => {
    expect(lockedUntilFor(4, now)).toBeNull();
  });

  it('is the backoff ahead of now once the threshold is crossed', () => {
    expect(lockedUntilFor(5, now)?.toISOString()).toBe(
      '2026-08-08T04:00:01.000Z',
    );
  });

  it('does not mutate the clock it was handed', () => {
    lockedUntilFor(9, now);
    expect(now.toISOString()).toBe('2026-08-08T04:00:00.000Z');
  });
});

describe('isLockedOut', () => {
  it('is false when nothing was ever recorded', () => {
    expect(isLockedOut(null, now)).toBe(false);
  });

  it('is true while the moment is in the future', () => {
    expect(isLockedOut(new Date(now.getTime() + 1), now)).toBe(true);
  });

  it('is false at the exact instant it expires', () => {
    expect(isLockedOut(new Date(now.getTime()), now)).toBe(false);
  });

  it('is false once the moment has passed', () => {
    expect(isLockedOut(new Date(now.getTime() - 1), now)).toBe(false);
  });

  it('is false for a stored value that is not a usable date', () => {
    // A pre-migration document or a hand-edited record. Failing OPEN here is
    // the right direction: the per-IP throttle is still in front of this, and
    // failing closed would lock a real user out with no way back.
    expect(isLockedOut(new Date('nonsense'), now)).toBe(false);
  });
});
