import { CircuitBreaker } from './circuit-breaker';

describe('CircuitBreaker', () => {
  it('starts healthy', () => {
    const breaker = new CircuitBreaker(3);

    expect(breaker.isDegraded()).toBe(false);
    expect(breaker.consecutiveFailures()).toBe(0);
  });

  it('does not trip below the threshold', () => {
    const breaker = new CircuitBreaker(3);

    expect(breaker.recordFailure()).toBe(false);
    expect(breaker.recordFailure()).toBe(false);
    expect(breaker.isDegraded()).toBe(false);
  });

  it('signals exactly once on the transition into degraded', () => {
    const breaker = new CircuitBreaker(3);
    breaker.recordFailure();
    breaker.recordFailure();

    expect(breaker.recordFailure()).toBe(true);
    // Already degraded — must not re-notify on every subsequent failure.
    expect(breaker.recordFailure()).toBe(false);
    expect(breaker.isDegraded()).toBe(true);
  });

  it('resets on success', () => {
    const breaker = new CircuitBreaker(3);
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordSuccess();

    expect(breaker.consecutiveFailures()).toBe(0);
    expect(breaker.recordFailure()).toBe(false);
  });

  it('recovers from degraded on success and can trip again', () => {
    const breaker = new CircuitBreaker(2);
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.isDegraded()).toBe(true);

    breaker.recordSuccess();
    expect(breaker.isDegraded()).toBe(false);

    breaker.recordFailure();
    expect(breaker.recordFailure()).toBe(true);
  });

  it('rejects a threshold below 1', () => {
    expect(() => new CircuitBreaker(0)).toThrow(/threshold/i);
  });
});

/**
 * The threshold arrives from config, i.e. from `process.env`. The guard must be
 * `!Number.isInteger(threshold) || threshold < 1` and NOT a bare `threshold < 1`,
 * because a bare lower-bound comparison ACCEPTS the three values most likely to
 * actually show up:
 *
 *   NaN       `parseInt(process.env.CIRCUIT_BREAKER_THRESHOLD)` on a missing or
 *             malformed variable. `NaN < 1` is false, so it passes the bare
 *             guard — and then `failures >= NaN` is false forever, so the
 *             breaker NEVER trips and a blind poller stays silent. That is the
 *             precise failure this class exists to prevent, arriving through the
 *             validation meant to stop it.
 *   Infinity  `Infinity < 1` is false. Same outcome: never trips.
 *   1.5       `1.5 < 1` is false. Trips at 2, not 1.5 — surprising, not fatal,
 *             but it means the operator's configured number is not the number in
 *             force.
 *
 * `Number.isInteger` rejects all three on its own (it is false for NaN, for both
 * infinities and for any fraction), so the two clauses together are exactly
 * right and neither is redundant: `Number.isInteger` alone would admit 0 and -1,
 * and `< 1` alone would admit NaN, Infinity and 1.5.
 *
 * Sibling modules got this wrong; see the identical note at
 * libs/filings/src/logic/alert-window.spec.ts on ALERT_WINDOW_MS.
 */
describe('CircuitBreaker: threshold validation', () => {
  const REJECTED: ReadonlyArray<readonly [string, number]> = [
    ['zero', 0],
    ['minus one', -1],
    ['a large negative integer', -7],
    ['NaN, i.e. parseInt of a missing env var', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['1.5, a fraction above one', 1.5],
    ['0.5, a fraction below one', 0.5],
    ['-0.5, a negative fraction', -0.5],
    ['0.9999999, a fraction just under one', 0.9999999],
  ];

  it.each(REJECTED)('rejects %s', (_label, threshold) => {
    expect(() => new CircuitBreaker(threshold)).toThrow(/threshold/i);
  });

  it('names the integer requirement, not just "invalid"', () => {
    // The operator reads this message out of a crash log with no other context,
    // so it has to say what was wanted, not just that something was wrong.
    expect(() => new CircuitBreaker(0)).toThrow(/integer/i);
    expect(() => new CircuitBreaker(Number.NaN)).toThrow(/integer/i);
  });

  const ACCEPTED: ReadonlyArray<readonly [string, number]> = [
    ['one, the minimum, tripping on the first failure', 1],
    ['two', 2],
    ['three, the expected production value', 3],
    ['a large integer', 100],
  ];

  it.each(ACCEPTED)('accepts %s', (_label, threshold) => {
    expect(() => new CircuitBreaker(threshold)).not.toThrow();
    expect(new CircuitBreaker(threshold).isDegraded()).toBe(false);
  });

  it('accepts a whole number written as a float', () => {
    // `Number.isInteger(3.0)` is true — 3.0 and 3 are the same double. A guard
    // written with a string or modulo check could get this wrong.
    expect(() => new CircuitBreaker(3.0)).not.toThrow();
  });

  it('proves a bare lower-bound guard would admit NaN, Infinity and 1.5', () => {
    // Executable form of the note above, so the hazard cannot be quietly
    // reintroduced by someone writing the intuitive guard.
    const bareGuard = (threshold: number): boolean => threshold < 1;
    const realGuard = (threshold: number): boolean =>
      !Number.isInteger(threshold) || threshold < 1;

    expect(bareGuard(Number.NaN)).toBe(false); // does not reject
    expect(bareGuard(Number.POSITIVE_INFINITY)).toBe(false); // does not reject
    expect(bareGuard(1.5)).toBe(false); // does not reject
    expect(realGuard(Number.NaN)).toBe(true);
    expect(realGuard(Number.POSITIVE_INFINITY)).toBe(true);
    expect(realGuard(1.5)).toBe(true);

    // Both agree on the ordinary values, so the stricter guard costs nothing.
    expect(bareGuard(0)).toBe(true);
    expect(realGuard(0)).toBe(true);
    expect(bareGuard(3)).toBe(false);
    expect(realGuard(3)).toBe(false);
  });

  it('shows what a NaN threshold would do if it were let through', () => {
    // Why the guard is worth having at all: every comparison against NaN is
    // false, so `failures >= NaN` never holds and the breaker is a no-op that
    // reports healthy through an unlimited outage.
    expect(1 >= Number.NaN).toBe(false);
    expect(1000000 >= Number.NaN).toBe(false);
  });

  it('throws an Error, not a bare string or a rejected promise', () => {
    expect(() => new CircuitBreaker(0)).toThrow(Error);
  });

  it('rejects before any state exists, so a bad instance cannot be used', () => {
    // The throw is in the constructor: there is no half-built breaker to hold.
    let breaker: CircuitBreaker | undefined;
    expect(() => {
      breaker = new CircuitBreaker(Number.NaN);
    }).toThrow();
    expect(breaker).toBeUndefined();
  });
});

/**
 * The alert-fatigue guarantee. A breaker that re-signals on every failure at a
 * 2-second cadence sends 1800 messages an hour; the operator mutes the channel,
 * and a muted channel is indistinguishable from no alerting at all. So the
 * transition edge — not the degraded state — is what `recordFailure` reports.
 */
describe('CircuitBreaker: signals exactly once per outage', () => {
  /** Every value `recordFailure` returns over `count` consecutive failures. */
  const failStreak = (threshold: number, count: number): boolean[] => {
    const breaker = new CircuitBreaker(threshold);
    return Array.from({ length: count }, () => breaker.recordFailure());
  };

  const THRESHOLDS: ReadonlyArray<readonly [number]> = [
    [1],
    [2],
    [3],
    [5],
    [10],
  ];

  it.each(THRESHOLDS)(
    'with threshold %i, signals on exactly one failure out of 40',
    (threshold) => {
      const signals = failStreak(threshold, 40);

      expect(signals.filter(Boolean)).toHaveLength(1);
    },
  );

  it.each(THRESHOLDS)(
    'with threshold %i, the signal lands on the Nth failure, not before',
    (threshold) => {
      const signals = failStreak(threshold, 40);

      expect(signals.indexOf(true)).toBe(threshold - 1);
    },
  );

  it.each(THRESHOLDS)(
    'with threshold %i, every failure before the Nth returns false',
    (threshold) => {
      const signals = failStreak(threshold, 40);

      expect(signals.slice(0, threshold - 1).some(Boolean)).toBe(false);
    },
  );

  it.each(THRESHOLDS)(
    'with threshold %i, every failure after the Nth returns false',
    (threshold) => {
      const signals = failStreak(threshold, 40);

      expect(signals.slice(threshold).some(Boolean)).toBe(false);
    },
  );

  it.each(THRESHOLDS)(
    'with threshold %i, isDegraded flips exactly when the signal fires',
    (threshold) => {
      const breaker = new CircuitBreaker(threshold);

      for (let poll = 1; poll <= 20; poll += 1) {
        const signalled = breaker.recordFailure();
        expect(breaker.isDegraded()).toBe(poll >= threshold);
        expect(signalled).toBe(poll === threshold);
      }
    },
  );

  it('trips on the very first failure when the threshold is 1', () => {
    const breaker = new CircuitBreaker(1);

    expect(breaker.recordFailure()).toBe(true);
    expect(breaker.isDegraded()).toBe(true);
    expect(breaker.recordFailure()).toBe(false);
  });

  it('stays silent through a two-day outage after the one signal', () => {
    // ~86400 polls at the 2s cadence. The operator is told once, then left
    // alone; the poller can still read consecutiveFailures() whenever it wants.
    const breaker = new CircuitBreaker(3);
    let signals = 0;

    for (let poll = 0; poll < 86400; poll += 1) {
      if (breaker.recordFailure()) signals += 1;
    }

    expect(signals).toBe(1);
    expect(breaker.isDegraded()).toBe(true);
  });

  it('does not signal on a success, only ever on a failure', () => {
    const breaker = new CircuitBreaker(2);

    // recordSuccess returns void; the poller has no recovery edge to read here.
    expect(breaker.recordSuccess()).toBeUndefined();
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.recordSuccess()).toBeUndefined();
  });
});

/**
 * Recovery must fully re-arm the breaker. A breaker that signals once and is
 * then spent for the process lifetime is silent through the SECOND outage,
 * which is the one nobody is watching for.
 */
describe('CircuitBreaker: recovery re-arms the signal', () => {
  it('signals again on a second outage', () => {
    const breaker = new CircuitBreaker(2);

    breaker.recordFailure();
    expect(breaker.recordFailure()).toBe(true);
    breaker.recordSuccess();
    breaker.recordFailure();

    expect(breaker.recordFailure()).toBe(true);
  });

  it('signals on every one of five successive outages', () => {
    const breaker = new CircuitBreaker(3);
    const signals: boolean[] = [];

    for (let outage = 0; outage < 5; outage += 1) {
      signals.push(breaker.recordFailure());
      signals.push(breaker.recordFailure());
      signals.push(breaker.recordFailure());
      signals.push(breaker.recordFailure());
      breaker.recordSuccess();
    }

    // One signal per outage, always the third failure of the four.
    expect(signals.filter(Boolean)).toHaveLength(5);
    expect(
      signals
        .map((s, index) => (s ? index % 4 : null))
        .filter((i) => i !== null),
    ).toEqual([2, 2, 2, 2, 2]);
  });

  it('requires the full threshold again after a partial streak is reset', () => {
    // Two failures, a success, then two more must NOT trip a threshold-3
    // breaker: the count restarts at zero rather than resuming at two.
    const breaker = new CircuitBreaker(3);

    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordSuccess();

    expect(breaker.recordFailure()).toBe(false);
    expect(breaker.recordFailure()).toBe(false);
    expect(breaker.isDegraded()).toBe(false);
    expect(breaker.recordFailure()).toBe(true);
  });

  it('clears the counter as well as the state on recovery', () => {
    const breaker = new CircuitBreaker(3);
    for (let poll = 0; poll < 50; poll += 1) breaker.recordFailure();

    breaker.recordSuccess();

    expect(breaker.consecutiveFailures()).toBe(0);
    expect(breaker.isDegraded()).toBe(false);
  });

  it('recovers on the success immediately following the signalling failure', () => {
    const breaker = new CircuitBreaker(2);
    breaker.recordFailure();
    expect(breaker.recordFailure()).toBe(true);

    breaker.recordSuccess();

    expect(breaker.isDegraded()).toBe(false);
    expect(breaker.consecutiveFailures()).toBe(0);
  });

  it('treats a success while healthy as a no-op', () => {
    const breaker = new CircuitBreaker(3);

    breaker.recordSuccess();
    breaker.recordSuccess();

    expect(breaker.isDegraded()).toBe(false);
    expect(breaker.consecutiveFailures()).toBe(0);
    expect(breaker.recordFailure()).toBe(false);
  });

  it('treats repeated successes while degraded as idempotent', () => {
    const breaker = new CircuitBreaker(2);
    breaker.recordFailure();
    breaker.recordFailure();

    breaker.recordSuccess();
    breaker.recordSuccess();
    breaker.recordSuccess();

    expect(breaker.isDegraded()).toBe(false);
    expect(breaker.consecutiveFailures()).toBe(0);
  });

  it('never trips when every failure is separated by a success', () => {
    // The flapping case: NSE 403s intermittently but recovers each time. This
    // is NOT an outage and must not page anyone.
    const breaker = new CircuitBreaker(3);

    for (let poll = 0; poll < 100; poll += 1) {
      expect(breaker.recordFailure()).toBe(false);
      breaker.recordSuccess();
    }

    expect(breaker.isDegraded()).toBe(false);
    expect(breaker.consecutiveFailures()).toBe(0);
  });

  it('trips only when failures are genuinely consecutive', () => {
    // threshold 3: two failures, recover, two failures, recover, three fails.
    const breaker = new CircuitBreaker(3);

    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordSuccess();
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordSuccess();

    expect(breaker.recordFailure()).toBe(false);
    expect(breaker.recordFailure()).toBe(false);
    expect(breaker.recordFailure()).toBe(true);
  });
});

/**
 * DECISION: `consecutiveFailures()` is UNBOUNDED. It keeps counting while
 * degraded rather than clamping at the threshold.
 *
 * The counter's only consumer is the operator-facing message, and its whole
 * value there is answering "how long have I been blind?". Clamped at the
 * threshold it reads "3 consecutive failures" whether the outage is six seconds
 * or six hours old, which is strictly less information than `isDegraded()`
 * already carries. Unbounded it is a duration in polls, and the poller knows the
 * cadence, so 5400 failures is "three hours dark".
 *
 * The overflow it trades against is not reachable. `Number.MAX_SAFE_INTEGER` is
 * 9007199254740991; at the 2-second cadence that is ~5.7e8 years of continuous
 * failure. Past it, `failures += 1` on a double simply stops advancing — it does
 * not wrap, does not go negative, and does not throw — so even the unreachable
 * case degrades to a stuck large number rather than to a breaker that reports
 * healthy. Bounding the counter would buy nothing and cost the only diagnostic
 * this class produces.
 *
 * Pinned here so the "optimisation" of clamping cannot land unnoticed.
 */
describe('CircuitBreaker: the failure counter is unbounded by decision', () => {
  it('keeps counting past the threshold', () => {
    const breaker = new CircuitBreaker(3);

    for (let poll = 0; poll < 10; poll += 1) breaker.recordFailure();

    expect(breaker.consecutiveFailures()).toBe(10);
  });

  it('does not clamp at the threshold', () => {
    const breaker = new CircuitBreaker(3);
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();

    // The exact assertion a clamped implementation fails.
    expect(breaker.consecutiveFailures()).not.toBe(3);
    expect(breaker.consecutiveFailures()).toBe(4);
  });

  it('counts every failure one for one, before and after the trip', () => {
    const breaker = new CircuitBreaker(4);

    for (let poll = 1; poll <= 200; poll += 1) {
      breaker.recordFailure();
      expect(breaker.consecutiveFailures()).toBe(poll);
    }
  });

  it('reports a multi-day outage as a usable duration in polls', () => {
    // 130000 polls at 2s is ~3 days — the brief's worst realistic case.
    const OUTAGE_POLLS = 130000;
    const breaker = new CircuitBreaker(3);
    let signals = 0;

    for (let poll = 0; poll < OUTAGE_POLLS; poll += 1) {
      if (breaker.recordFailure()) signals += 1;
    }

    expect(signals).toBe(1);
    expect(breaker.consecutiveFailures()).toBe(OUTAGE_POLLS);
    expect(breaker.isDegraded()).toBe(true);
    // Nowhere near the precision limit, and never negative.
    expect(Number.isSafeInteger(breaker.consecutiveFailures())).toBe(true);
    expect(breaker.consecutiveFailures()).toBeGreaterThan(0);
  });

  it('reports zero while healthy, not the threshold', () => {
    expect(new CircuitBreaker(3).consecutiveFailures()).toBe(0);
  });

  it('is a plain read that does not itself advance the counter', () => {
    const breaker = new CircuitBreaker(3);
    breaker.recordFailure();

    breaker.consecutiveFailures();
    breaker.consecutiveFailures();
    breaker.isDegraded();
    breaker.isDegraded();

    expect(breaker.consecutiveFailures()).toBe(1);
    expect(breaker.isDegraded()).toBe(false);
  });
});

/**
 * The poller drives this class; the class never reads a clock. No timers, no
 * `Date.now()`, no half-open state that expires. Anything time-based here would
 * be a second scheduler racing the poller's own loop.
 */
describe('CircuitBreaker: no time-based behaviour', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('schedules no timers', () => {
    jest.useFakeTimers();
    const breaker = new CircuitBreaker(2);

    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordSuccess();

    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not self-heal as time passes', () => {
    // No half-open state: only a real success clears the breaker.
    jest.useFakeTimers();
    const breaker = new CircuitBreaker(2);
    breaker.recordFailure();
    breaker.recordFailure();

    jest.advanceTimersByTime(24 * 60 * 60 * 1000);

    expect(breaker.isDegraded()).toBe(true);
    expect(breaker.recordFailure()).toBe(false);
  });

  it('does not re-arm the signal as time passes', () => {
    // The inverse hazard: a breaker that "expires" its notification would start
    // paging again after an interval, which is the alert storm by another route.
    jest.useFakeTimers();
    const breaker = new CircuitBreaker(2);
    breaker.recordFailure();
    expect(breaker.recordFailure()).toBe(true);

    jest.advanceTimersByTime(7 * 24 * 60 * 60 * 1000);

    expect(breaker.recordFailure()).toBe(false);
  });

  it('gives identical results regardless of the system clock', () => {
    jest.useFakeTimers().setSystemTime(new Date('1999-01-15T05:00:00.000Z'));
    const past = new CircuitBreaker(2);
    past.recordFailure();
    const pastSignal = past.recordFailure();

    jest.setSystemTime(new Date('2099-01-15T05:00:00.000Z'));
    const future = new CircuitBreaker(2);
    future.recordFailure();
    const futureSignal = future.recordFailure();

    expect(pastSignal).toBe(true);
    expect(futureSignal).toBe(true);
  });
});

describe('CircuitBreaker: instances are independent', () => {
  it('does not share state between two breakers', () => {
    // Guards against module-level or static state, which would make a second
    // poller (or a second test) silently reuse the first one's counter.
    const first = new CircuitBreaker(2);
    const second = new CircuitBreaker(2);

    first.recordFailure();
    first.recordFailure();

    expect(first.isDegraded()).toBe(true);
    expect(second.isDegraded()).toBe(false);
    expect(second.consecutiveFailures()).toBe(0);
    expect(second.recordFailure()).toBe(false);
  });

  it('honours the threshold each breaker was built with', () => {
    const strict = new CircuitBreaker(1);
    const lax = new CircuitBreaker(5);

    expect(strict.recordFailure()).toBe(true);
    expect(lax.recordFailure()).toBe(false);
  });

  it('does not let a recovery on one breaker clear another', () => {
    const first = new CircuitBreaker(2);
    const second = new CircuitBreaker(2);
    first.recordFailure();
    first.recordFailure();
    second.recordFailure();
    second.recordFailure();

    first.recordSuccess();

    expect(first.isDegraded()).toBe(false);
    expect(second.isDegraded()).toBe(true);
  });
});
