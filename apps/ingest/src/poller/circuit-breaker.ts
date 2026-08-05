/**
 * Counts consecutive poll failures so a blind poller becomes louder than a
 * healthy one.
 *
 * The failure this exists to prevent: NSE sits behind Akamai bot protection. If
 * it starts challenging us, every poll 403s and the pipeline goes completely
 * silent — which looks exactly like a quiet market. The operator must be told
 * they are blind rather than left to assume nothing is being filed.
 *
 * `recordFailure` returns true ONLY on the transition into the degraded state,
 * so the operator is notified once per outage rather than every 2 seconds. That
 * edge is the whole design. A breaker that re-signalled on each failure would
 * send ~1800 messages an hour, the operator would mute the channel, and a muted
 * channel is indistinguishable from no alerting at all.
 *
 * Deliberately NOT here:
 *
 *   - No clock, no timers, no half-open state that expires. The poller owns the
 *     schedule; a timer in here would be a second scheduler racing that loop.
 *     Only a real success clears the breaker.
 *   - No open/closed gating. This does not stop the poller from polling — it
 *     must keep trying, because a retry is the only thing that can recover. It
 *     only decides when to speak up.
 *
 * `consecutiveFailures()` is UNBOUNDED and keeps counting while degraded. Its
 * only consumer is the operator-facing message, where the useful question is
 * "how long have I been blind?" — a count clamped at the threshold answers that
 * with strictly less information than `isDegraded()` already carries, while an
 * unbounded count is a duration in polls the caller can multiply by its cadence.
 * The overflow this trades against is unreachable: `Number.MAX_SAFE_INTEGER` is
 * ~9.0e15, i.e. ~5.7e8 years of continuous failure at a 2-second cadence, and
 * past that limit `+= 1` on a double stalls rather than wrapping, going negative
 * or throwing. Bounding it would cost the only diagnostic this class produces
 * and buy nothing.
 */
export class CircuitBreaker {
  private failures = 0;
  private degraded = false;

  /**
   * @param threshold Consecutive failures required before signalling. Must be
   * an integer >= 1.
   *
   * `Number.isInteger` is load-bearing and not interchangeable with a bare
   * `threshold < 1`. The threshold comes from config, so the realistic bad
   * values are `NaN` (`parseInt` of a missing or malformed env var) and
   * `Infinity` — and `NaN < 1` and `Infinity < 1` are both FALSE, so a bare
   * lower-bound check would accept them. Either would then make `failures >=
   * threshold` false forever, leaving a breaker that reports healthy through an
   * unlimited outage: the exact silence this class exists to break, arriving
   * through the validation meant to prevent it. `Number.isInteger` is false for
   * NaN, for both infinities and for any fraction, so the two clauses together
   * are exact — neither is redundant, since `Number.isInteger` alone would admit
   * 0 and -1.
   */
  constructor(private readonly threshold: number) {
    if (!Number.isInteger(threshold) || threshold < 1) {
      throw new Error('CircuitBreaker threshold must be an integer >= 1');
    }
  }

  /** Clears the streak and the degraded state. Idempotent. */
  recordSuccess(): void {
    this.failures = 0;
    this.degraded = false;
  }

  /** @returns true exactly on the transition healthy -> degraded. */
  recordFailure(): boolean {
    this.failures += 1;
    if (this.failures >= this.threshold && !this.degraded) {
      this.degraded = true;
      return true;
    }
    return false;
  }

  isDegraded(): boolean {
    return this.degraded;
  }

  /** Consecutive failures so far. Unbounded — see the class note. */
  consecutiveFailures(): number {
    return this.failures;
  }
}
