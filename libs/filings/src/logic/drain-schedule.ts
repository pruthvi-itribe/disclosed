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

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * How many IST days one drain may span.
 *
 * The date-range endpoint is uncapped — 31 days returned 17,254 records (12MB)
 * in 5.7s — so this bound is not about what the exchange will serve. It is
 * about what an unattended process should decide to pull on its own: seven days
 * covers a long weekend plus a holiday cluster, which is the realistic downtime
 * a restart has to reconcile. A gap wider than that is an operational event and
 * belongs to a deliberate backfill, not to a poll loop, so it is reported
 * rather than silently attempted.
 */
export const MAX_DRAIN_DAYS = 7;

/** The UTC instant at which the IST calendar day containing `date` begins. */
const istDayStartMs = (date: Date): number =>
  Math.floor((date.getTime() + IST_OFFSET_MS) / MS_PER_DAY) * MS_PER_DAY -
  IST_OFFSET_MS;

export interface DrainRange {
  /**
   * One instant per IST day to drain, oldest first, each landing inside its own
   * day. The LAST entry is `through` itself, so a single-day drain is handed
   * back exactly the instant it was given.
   */
  readonly days: readonly Date[];
  /** IST days that fell outside the bound and were NOT drained. */
  readonly skippedDays: number;
}

/**
 * The IST days a drain must cover to close a hole that spans midnight.
 *
 * A drain of `today` alone cannot reconcile a restart whose downtime crossed
 * 18:30 UTC: yesterday's filings beyond the newest twenty are never fetched,
 * and the cursor steps past them. So the range starts at the IST day of the
 * newest record already stored — the last day we have any evidence for — and
 * runs forward to now.
 *
 * When the span exceeds `maxDays` the NEWEST days are kept. Dropping the recent
 * end instead would leave today unreconciled, which is the day that still has
 * alerting value; the older end is reported through `skippedDays` so the loss
 * is visible rather than assumed.
 *
 * `from` after `through` (a clock skew, or a stored record stamped in the
 * future by the `an_dt` fallback) collapses to `through` alone rather than
 * producing a negative range.
 */
export function drainRange(
  from: Date | null,
  through: Date,
  maxDays: number = MAX_DRAIN_DAYS,
): DrainRange {
  const end = istDayStartMs(through);
  // Nothing stored yet: there is no earlier day we have evidence for, and
  // pulling a week of history on a cold start would be a decision nobody made.
  const start = from === null ? end : Math.min(istDayStartMs(from), end);

  const total = Math.round((end - start) / MS_PER_DAY) + 1;
  const kept = Math.min(total, Math.max(maxDays, 1));

  const days: Date[] = [];
  for (let i = kept - 1; i >= 1; i -= 1) {
    // Midday IST, so the instant is unambiguously inside its own IST day
    // whatever rounding a downstream formatter applies.
    days.push(new Date(end - i * MS_PER_DAY + MS_PER_DAY / 2));
  }
  days.push(through);

  return { days, skippedDays: total - kept };
}

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
