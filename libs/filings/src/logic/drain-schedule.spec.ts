import {
  CLOSING_DRAIN_HOUR_IST,
  CLOSING_DRAIN_MINUTE_IST,
  isAtOrAfterClosingMinute,
  istDayKey,
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
