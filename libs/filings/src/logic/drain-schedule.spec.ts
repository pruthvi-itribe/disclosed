import {
  CLOSING_DRAIN_HOUR_IST,
  CLOSING_DRAIN_MINUTE_IST,
  drainRange,
  isAtOrAfterClosingMinute,
  istDayKey,
  MAX_DRAIN_DAYS,
  scheduledDrainReason,
} from './drain-schedule';

const FIVE_MINUTES = 300_000;

/** Builds a UTC instant from an IST wall clock, so the tests read in IST. */
const ist = (
  y: number,
  m: number,
  d: number,
  hh: number,
  mm: number,
  ss = 0,
): Date => new Date(Date.UTC(y, m - 1, d, hh, mm, ss) - 5.5 * 60 * 60 * 1000);

describe('istDayKey', () => {
  it('reports the IST calendar day, not the UTC one', () => {
    // 2026-08-05T19:00:00Z is 00:30 IST on the 6th.
    expect(istDayKey(new Date('2026-08-05T19:00:00.000Z'))).toBe('2026-08-06');
  });

  it('rolls at 18:30 UTC exactly', () => {
    expect(istDayKey(new Date('2026-08-05T18:29:59.999Z'))).toBe('2026-08-05');
    expect(istDayKey(new Date('2026-08-05T18:30:00.000Z'))).toBe('2026-08-06');
  });

  it('does not mutate the Date it was handed', () => {
    const now = new Date('2026-08-05T04:58:20.000Z');
    const before = now.getTime();

    istDayKey(now);

    expect(now.getTime()).toBe(before);
  });

  it('crosses a year boundary correctly', () => {
    expect(istDayKey(new Date('2026-12-31T18:30:00.000Z'))).toBe('2027-01-01');
  });
});

describe('isAtOrAfterClosingMinute', () => {
  const CASES: ReadonlyArray<readonly [string, Date, boolean]> = [
    ['midday', ist(2026, 8, 5, 12, 0), false],
    ['one minute before the close', ist(2026, 8, 5, 23, 29, 59), false],
    ['exactly the closing minute', ist(2026, 8, 5, 23, 30), true],
    ['a second after it', ist(2026, 8, 5, 23, 30, 1), true],
    ['the last second of the IST day', ist(2026, 8, 5, 23, 59, 59), true],
    ['just after IST midnight, the next day', ist(2026, 8, 6, 0, 0), false],
    ['end of the filing window at 23:00', ist(2026, 8, 5, 23, 0), false],
  ];

  it.each(CASES)('%s', (_label, now, expected) => {
    expect(isAtOrAfterClosingMinute(now)).toBe(expected);
  });

  it('is pinned to 23:30 IST, as the design spec states', () => {
    expect(CLOSING_DRAIN_HOUR_IST).toBe(23);
    expect(CLOSING_DRAIN_MINUTE_IST).toBe(30);
  });
});

describe('scheduledDrainReason', () => {
  const base = {
    lastClosingDay: null as string | null,
    drainIntervalMs: FIVE_MINUTES,
  };

  it('is due immediately when nothing has ever drained', () => {
    // Startup is when the gap is widest. Treating a null as "start the clock"
    // would make a restart wait five minutes before reconciling anything.
    expect(
      scheduledDrainReason({
        ...base,
        now: ist(2026, 8, 5, 10, 0),
        lastDrainAtMs: null,
        lastClosingDay: '2026-08-05',
      }),
    ).toBe('periodic');
  });

  it('is not due before the interval has elapsed', () => {
    const now = ist(2026, 8, 5, 10, 0);

    expect(
      scheduledDrainReason({
        ...base,
        now,
        lastDrainAtMs: now.getTime() - (FIVE_MINUTES - 1),
      }),
    ).toBeNull();
  });

  it('is due exactly at the interval, not one tick later', () => {
    const now = ist(2026, 8, 5, 10, 0);

    expect(
      scheduledDrainReason({
        ...base,
        now,
        lastDrainAtMs: now.getTime() - FIVE_MINUTES,
      }),
    ).toBe('periodic');
  });

  it('honours a configured interval other than the default', () => {
    const now = ist(2026, 8, 5, 10, 0);
    const input = { ...base, now, drainIntervalMs: 60_000 };

    expect(
      scheduledDrainReason({ ...input, lastDrainAtMs: now.getTime() - 59_999 }),
    ).toBeNull();
    expect(
      scheduledDrainReason({ ...input, lastDrainAtMs: now.getTime() - 60_000 }),
    ).toBe('periodic');
  });

  it('reports the closing drain once the IST clock passes 23:30', () => {
    const now = ist(2026, 8, 5, 23, 30);

    expect(
      scheduledDrainReason({ ...base, now, lastDrainAtMs: now.getTime() }),
    ).toBe('closing');
  });

  it('outranks a periodic drain that is also due', () => {
    // The closing drain is the stronger claim: it is what marks the day
    // reconciled. Reporting it as periodic would leave the day unmarked and
    // re-run it on the very next tick.
    const now = ist(2026, 8, 5, 23, 45);

    expect(scheduledDrainReason({ ...base, now, lastDrainAtMs: null })).toBe(
      'closing',
    );
  });

  it('does not repeat the closing drain for a day already closed', () => {
    const now = ist(2026, 8, 5, 23, 45);

    expect(
      scheduledDrainReason({
        ...base,
        now,
        lastDrainAtMs: now.getTime(),
        lastClosingDay: '2026-08-05',
      }),
    ).toBeNull();
  });

  it('closes the next day even though the previous one is recorded', () => {
    const now = ist(2026, 8, 6, 23, 30);

    expect(
      scheduledDrainReason({
        ...base,
        now,
        lastDrainAtMs: now.getTime(),
        lastClosingDay: '2026-08-05',
      }),
    ).toBe('closing');
  });

  it('still runs periodic drains after the day has been closed', () => {
    // 23:45, day already closed. The sweep must not stop for the rest of the
    // IST day, or a filing landing at 23:50 waits until the next morning.
    const now = ist(2026, 8, 5, 23, 45);

    expect(
      scheduledDrainReason({
        ...base,
        now,
        lastDrainAtMs: now.getTime() - FIVE_MINUTES,
        lastClosingDay: '2026-08-05',
      }),
    ).toBe('periodic');
  });

  it('does not report a closing drain before 23:30 for a day never closed', () => {
    const now = ist(2026, 8, 5, 22, 0);

    expect(
      scheduledDrainReason({ ...base, now, lastDrainAtMs: now.getTime() }),
    ).toBeNull();
  });
});

/**
 * `fetchDay(now)` alone cannot close a hole that spans IST midnight. A restart
 * whose downtime crossed 18:30 UTC drains today while yesterday's filings
 * beyond the newest twenty are never fetched, and the cursor steps past them.
 */
describe('drainRange', () => {
  const keys = (dates: readonly Date[]): string[] => dates.map(istDayKey);

  it('drains today alone when the newest stored record is from today', () => {
    const now = ist(2026, 8, 5, 14, 0);
    const stored = ist(2026, 8, 5, 9, 30);

    const range = drainRange(stored, now);

    expect(keys(range.days)).toEqual(['2026-08-05']);
    expect(range.skippedDays).toBe(0);
  });

  it('hands back the exact instant it was given for the final day', () => {
    // The single-day case must be byte-identical to the old behaviour, so the
    // drain still targets the instant the poll was made rather than a rounded
    // stand-in for it.
    const now = ist(2026, 8, 5, 14, 0);

    expect(drainRange(now, now).days[0]).toBe(now);
  });

  it('spans IST midnight when the newest stored record is from yesterday', () => {
    // 10:00 IST today, last stored filing at 21:00 IST yesterday: the restart
    // slept through the day boundary.
    const now = ist(2026, 8, 5, 10, 0);
    const stored = ist(2026, 8, 4, 21, 0);

    const range = drainRange(stored, now);

    expect(keys(range.days)).toEqual(['2026-08-04', '2026-08-05']);
    expect(range.skippedDays).toBe(0);
  });

  it('drains only today when nothing at all is stored', () => {
    // A cold start has no earlier day it has evidence for, and pulling a week
    // of history is a decision nobody made.
    const now = ist(2026, 8, 5, 10, 0);

    const range = drainRange(null, now);

    expect(keys(range.days)).toEqual(['2026-08-05']);
    expect(range.skippedDays).toBe(0);
  });

  it('covers a long weekend without hitting the bound', () => {
    const now = ist(2026, 8, 5, 10, 0);
    const stored = ist(2026, 8, 1, 18, 0);

    expect(keys(drainRange(stored, now).days)).toEqual([
      '2026-08-01',
      '2026-08-02',
      '2026-08-03',
      '2026-08-04',
      '2026-08-05',
    ]);
  });

  it('keeps the newest days and reports the ones it dropped', () => {
    // Dropping the recent end instead would leave today unreconciled, and
    // today is the day that still has alerting value.
    const now = ist(2026, 8, 20, 10, 0);
    const stored = ist(2026, 8, 1, 10, 0);

    const range = drainRange(stored, now);

    expect(range.days).toHaveLength(MAX_DRAIN_DAYS);
    expect(keys(range.days)[0]).toBe('2026-08-14');
    expect(keys(range.days)[MAX_DRAIN_DAYS - 1]).toBe('2026-08-20');
    expect(range.skippedDays).toBe(13);
  });

  it('honours a caller-supplied bound', () => {
    const now = ist(2026, 8, 5, 10, 0);
    const stored = ist(2026, 8, 1, 10, 0);

    const range = drainRange(stored, now, 2);

    expect(keys(range.days)).toEqual(['2026-08-04', '2026-08-05']);
    expect(range.skippedDays).toBe(3);
  });

  it('never yields an empty range, whatever bound it is handed', () => {
    // A drain that fetches nothing would report success having reconciled
    // nothing, which is the one outcome worse than a failure. The dropped-day
    // count has to stay honest through the degenerate bounds too: a bound that
    // is allowed to reach zero claims one more skipped day than it skipped.
    const now = ist(2026, 8, 5, 10, 0);
    const from = ist(2026, 8, 3, 0, 0);

    for (const bound of [1, 0, -3]) {
      const range = drainRange(from, now, bound);

      expect(range.days).toHaveLength(1);
      expect(istDayKey(range.days[0])).toBe('2026-08-05');
      expect(range.skippedDays).toBe(2);
    }
  });

  it('keeps every intermediate instant clear of the IST day boundary', () => {
    // An instant sitting exactly on IST midnight is one millisecond away from
    // the previous day, so any off-by-one in a downstream formatter moves the
    // whole request onto a day nobody meant to fetch.
    const range = drainRange(ist(2026, 8, 2, 0, 0, 1), ist(2026, 8, 5, 12, 0));

    for (const day of range.days.slice(0, -1)) {
      expect(istDayKey(new Date(day.getTime() - 1))).toBe(istDayKey(day));
      expect(istDayKey(new Date(day.getTime() + 1))).toBe(istDayKey(day));
    }
  });

  it('collapses a stored record stamped in the future to today alone', () => {
    // The mapper falls back to an_dt when exchdisstime is absent, so a stored
    // timestamp ahead of the clock is reachable. A negative range must not be.
    const now = ist(2026, 8, 5, 10, 0);
    const stored = ist(2026, 8, 9, 10, 0);

    expect(keys(drainRange(stored, now).days)).toEqual(['2026-08-05']);
  });

  it('crosses a month boundary', () => {
    const now = ist(2026, 9, 1, 10, 0);
    const stored = ist(2026, 8, 30, 22, 0);

    expect(keys(drainRange(stored, now).days)).toEqual([
      '2026-08-30',
      '2026-08-31',
      '2026-09-01',
    ]);
  });

  it('puts every intermediate instant inside its own IST day', () => {
    // The days are fed to `toNseDateParam`, which buckets on the IST calendar
    // day. An instant near either edge would be formatted onto a neighbour.
    const now = ist(2026, 8, 5, 23, 59, 59);
    const range = drainRange(ist(2026, 8, 2, 0, 0, 1), now);

    expect(keys(range.days)).toEqual([
      '2026-08-02',
      '2026-08-03',
      '2026-08-04',
      '2026-08-05',
    ]);
  });
});
