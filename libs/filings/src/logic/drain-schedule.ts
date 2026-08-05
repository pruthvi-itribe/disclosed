/**
 * When the day must be re-pulled for a reason other than a detected rollover.
 *
 * The design spec asked for two scheduled drains — "Scheduled drain every 5
 * minutes regardless. Final drain at 23:30 closes the day" — and both were
 * dropped when the implementation plan was written. Nothing noticed, because
 * the rollover drain looks like it covers the same ground. It does not:
 * measured over the recorded 32-day corpus, NO 2-second window holds more than
 * 6 filings and no 30-second window more than 9, against a 20-record page. So
 * `holeDetected` is true only at a cold start or after long downtime, and
 * replaying the corpus through the poller fires it FOUR times in 32 days. The
 * reconciliation the no-loss guarantee rests on was running roughly once per
 * process lifetime.
 *
 * Pure, clock-injected, and deliberately free of any framework: the poller owns
 * the state, this owns the arithmetic.
 */

/** IST is UTC+05:30 year-round; India observes no daylight saving. */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

const MINUTES_PER_HOUR = 60;

/**
 * The wall-clock IST minute at which the closing drain reconciles the day.
 * 23:30, from the spec: half an hour after the 23:00 IST end of the filing
 * window, so the day's tail has landed before the day is closed.
 */
export const CLOSING_DRAIN_HOUR_IST = 23;
export const CLOSING_DRAIN_MINUTE_IST = 30;

const CLOSING_DRAIN_MINUTE_OF_DAY =
  CLOSING_DRAIN_HOUR_IST * MINUTES_PER_HOUR + CLOSING_DRAIN_MINUTE_IST;

/**
 * The IST calendar day as `YYYY-MM-DD`.
 *
 * Shifting into a fresh Date and reading UTC fields is independent of the host
 * timezone and leaves the caller's Date untouched. Bucketing by the raw UTC day
 * instead would split the IST day at 18:30 UTC and attribute everything filed
 * between 00:00 and 05:30 IST to the day before.
 */
export const istDayKey = (date: Date): string =>
  new Date(date.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

/** Minutes elapsed in the IST day. */
const istMinuteOfDay = (date: Date): number => {
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  return ist.getUTCHours() * MINUTES_PER_HOUR + ist.getUTCMinutes();
};

/**
 * True once the IST clock has reached the closing minute.
 *
 * At-or-after rather than equality on purpose: the poll cadence is 2s inside
 * the window and 30s outside it, and an equality test on a wall-clock minute
 * would be missed by any tick that straddles it. Paired with a caller that
 * records which day it last closed, this fires exactly once per day.
 */
export const isAtOrAfterClosingMinute = (now: Date): boolean =>
  istMinuteOfDay(now) >= CLOSING_DRAIN_MINUTE_OF_DAY;

export interface ScheduledDrainInput {
  now: Date;
  /** Epoch ms of the last drain of any kind, or null if none has run. */
  lastDrainAtMs: number | null;
  /** IST day key the closing drain last ran for, or null if it never has. */
  lastClosingDay: string | null;
  drainIntervalMs: number;
}

/** Why the day is being re-pulled. Reported so a caller can log and test it. */
export type DrainReason = 'rollover' | 'periodic' | 'closing';

/**
 * The scheduled reason a drain is owed right now, or null.
 *
 * `closing` outranks `periodic` because it is the stronger claim: the periodic
 * drain is a repeating sweep, while the closing drain is the one that marks a
 * day reconciled, and reporting a closing drain as periodic would leave the day
 * unmarked and re-run it on the next tick.
 *
 * A null `lastDrainAtMs` is DUE, not "start the clock". Startup is when the gap
 * is widest — a restart may have missed hours — so the first tick reconciles
 * rather than waiting out an interval.
 */
export function scheduledDrainReason({
  now,
  lastDrainAtMs,
  lastClosingDay,
  drainIntervalMs,
}: ScheduledDrainInput): DrainReason | null {
  if (isAtOrAfterClosingMinute(now) && istDayKey(now) !== lastClosingDay) {
    return 'closing';
  }

  // A null last-drain means nothing has reconciled yet, which is due.
  if (lastDrainAtMs === null) return 'periodic';

  return now.getTime() - lastDrainAtMs >= drainIntervalMs ? 'periodic' : null;
}
