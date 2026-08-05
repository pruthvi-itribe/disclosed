import { nextPollDelayMs, isInFilingWindow } from './cadence';

const HOT = 2000;
const IDLE = 30000;
const opts = { hotIntervalMs: HOT, idleIntervalMs: IDLE, burstThreshold: 8 };

// 2026-08-05T04:58:18Z === 10:28:18 IST
const midMorningIst = new Date('2026-08-05T04:58:18.000Z');
// 2026-08-05T20:00:00Z === 01:30 IST next day
const deadOfNightIst = new Date('2026-08-05T20:00:00.000Z');
// 2026-08-05T13:00:00Z === 18:30 IST — results window, still hot
const eveningIst = new Date('2026-08-05T13:00:00.000Z');

describe('isInFilingWindow', () => {
  it('is open mid-morning IST', () => {
    expect(isInFilingWindow(midMorningIst)).toBe(true);
  });

  it('is open in the evening results window', () => {
    expect(isInFilingWindow(eveningIst)).toBe(true);
  });

  it('is closed in the small hours IST', () => {
    expect(isInFilingWindow(deadOfNightIst)).toBe(false);
  });
});

describe('nextPollDelayMs', () => {
  it('returns the hot interval inside the filing window', () => {
    expect(nextPollDelayMs({ newCount: 1, now: midMorningIst, ...opts })).toBe(
      HOT,
    );
  });

  it('returns the idle interval outside the filing window', () => {
    expect(nextPollDelayMs({ newCount: 0, now: deadOfNightIst, ...opts })).toBe(
      IDLE,
    );
  });

  it('re-polls immediately when a burst fills the page', () => {
    expect(nextPollDelayMs({ newCount: 8, now: midMorningIst, ...opts })).toBe(
      0,
    );
  });

  it('re-polls immediately on a burst even outside the filing window', () => {
    // Filings do land off-window; a burst there matters more, not less.
    expect(
      nextPollDelayMs({ newCount: 12, now: deadOfNightIst, ...opts }),
    ).toBe(0);
  });

  it('does not treat a count just below the threshold as a burst', () => {
    expect(nextPollDelayMs({ newCount: 7, now: midMorningIst, ...opts })).toBe(
      HOT,
    );
  });
});

/**
 * The window is 07:00–23:00 IST, deliberately wider than the 09:15–15:30
 * trading session: Indian results routinely land 17:00–21:00 IST, hours after
 * the close. An off-by-one here silently changes polling behaviour for a whole
 * hour, so both edges are pinned to the millisecond.
 */
describe('isInFilingWindow: window edges', () => {
  const WINDOW_EDGE_CASES: ReadonlyArray<readonly [string, string, boolean]> = [
    ['06:59:59.999 IST, one ms before open', '2026-08-05T01:29:59.999Z', false],
    ['07:00:00.000 IST, exactly open', '2026-08-05T01:30:00.000Z', true],
    ['07:00:00.001 IST, just inside', '2026-08-05T01:30:00.001Z', true],
    ['22:59:59.999 IST, last ms open', '2026-08-05T17:29:59.999Z', true],
    ['23:00:00.000 IST, exactly closed', '2026-08-05T17:30:00.000Z', false],
    ['23:00:00.001 IST, just outside', '2026-08-05T17:30:00.001Z', false],
    ['00:00:00.000 IST, midnight', '2026-08-05T18:30:00.000Z', false],
    ['21:00 IST, peak results hour', '2026-08-05T15:30:00.000Z', true],
  ];

  it.each(WINDOW_EDGE_CASES)('%s', (_label, iso, expected) => {
    expect(isInFilingWindow(new Date(iso))).toBe(expected);
  });

  it('opens at 07:00 IST, not at the 09:15 market open', () => {
    // 08:00 IST — before trading, but filings already land.
    expect(isInFilingWindow(new Date('2026-08-05T02:30:00.000Z'))).toBe(true);
  });

  it('stays open long past the 15:30 IST close', () => {
    // 20:00 IST — the heart of the results window.
    expect(isInFilingWindow(new Date('2026-08-05T14:30:00.000Z'))).toBe(true);
  });
});

describe('isInFilingWindow: reads IST, not UTC or local time', () => {
  it('is closed at 23:30 IST even though the UTC hour is inside the window', () => {
    // 18:00Z. A UTC-based implementation would wrongly call this open.
    expect(isInFilingWindow(new Date('2026-08-05T18:00:00.000Z'))).toBe(false);
  });

  it('is open at 07:30 IST even though the UTC hour is outside the window', () => {
    // 02:00Z. A UTC-based implementation would wrongly call this closed.
    expect(isInFilingWindow(new Date('2026-08-05T02:00:00.000Z'))).toBe(true);
  });

  it('does not mutate the Date it is handed', () => {
    // Shifting to IST by mutating the caller's Date would corrupt the
    // timestamp the poller uses for everything else.
    const now = new Date('2026-08-05T04:58:18.000Z');

    isInFilingWindow(now);

    expect(now.toISOString()).toBe('2026-08-05T04:58:18.000Z');
  });

  it('depends only on the instant supplied, never on the real clock', () => {
    // Same IST hour, decades apart: the answer must not drift with wall time.
    expect(isInFilingWindow(new Date('1999-01-15T05:00:00.000Z'))).toBe(true);
    expect(isInFilingWindow(new Date('2099-01-15T05:00:00.000Z'))).toBe(true);
    expect(isInFilingWindow(new Date('1999-01-15T19:00:00.000Z'))).toBe(false);
    expect(isInFilingWindow(new Date('2099-01-15T19:00:00.000Z'))).toBe(false);
  });
});

describe('nextPollDelayMs: burst threshold edge', () => {
  const BELOW_THRESHOLD: readonly number[] = [0, 1, 5, 6, 7];
  const AT_OR_ABOVE_THRESHOLD: readonly number[] = [8, 9, 12, 20, 100];

  it.each(BELOW_THRESHOLD)(
    'newCount %i is below the threshold of 8, so the interval applies',
    (newCount) => {
      expect(nextPollDelayMs({ newCount, now: midMorningIst, ...opts })).toBe(
        HOT,
      );
    },
  );

  it.each(AT_OR_ABOVE_THRESHOLD)(
    'newCount %i is at or above the threshold of 8, so it re-polls immediately',
    (newCount) => {
      expect(nextPollDelayMs({ newCount, now: midMorningIst, ...opts })).toBe(
        0,
      );
    },
  );

  it('treats exactly the threshold as a burst, not one above it', () => {
    // The pair that pins the comparison as >= rather than >.
    expect(nextPollDelayMs({ newCount: 7, now: eveningIst, ...opts })).toBe(
      HOT,
    );
    expect(nextPollDelayMs({ newCount: 8, now: eveningIst, ...opts })).toBe(0);
  });

  it('honours a caller-supplied threshold rather than a hardcoded 8', () => {
    const strict = { ...opts, burstThreshold: 2 };
    const lax = { ...opts, burstThreshold: 20 };

    expect(
      nextPollDelayMs({ newCount: 2, now: midMorningIst, ...strict }),
    ).toBe(0);
    expect(nextPollDelayMs({ newCount: 8, now: midMorningIst, ...lax })).toBe(
      HOT,
    );
  });

  it('makes every poll a burst when the threshold is zero', () => {
    // Pins the consequence of a degenerate config rather than endorsing it:
    // `newCount >= 0` is always true, so a zero threshold returns a zero delay
    // forever and busy-loops the poller. This function is pure and takes its
    // config on trust — TASK 12 MUST REJECT burstThreshold < 1 at config load.
    const degenerate = { ...opts, burstThreshold: 0 };

    expect(
      nextPollDelayMs({ newCount: 0, now: midMorningIst, ...degenerate }),
    ).toBe(0);
    expect(
      nextPollDelayMs({ newCount: 0, now: deadOfNightIst, ...degenerate }),
    ).toBe(0);
  });

  it('a burst overrides the closed window in both directions', () => {
    expect(nextPollDelayMs({ newCount: 8, now: deadOfNightIst, ...opts })).toBe(
      0,
    );
    expect(nextPollDelayMs({ newCount: 7, now: deadOfNightIst, ...opts })).toBe(
      IDLE,
    );
  });
});

describe('nextPollDelayMs: quiet polls', () => {
  it('keeps the hot interval in-window when nothing new arrived', () => {
    // A quiet poll inside the window must not fall back to idle — the next
    // filing can land at any moment.
    expect(nextPollDelayMs({ newCount: 0, now: midMorningIst, ...opts })).toBe(
      HOT,
    );
  });

  it('uses the hot interval through the evening results window', () => {
    expect(nextPollDelayMs({ newCount: 0, now: eveningIst, ...opts })).toBe(
      HOT,
    );
  });

  it('does not mutate the Date it is handed', () => {
    const now = new Date('2026-08-05T13:00:00.000Z');

    nextPollDelayMs({ newCount: 3, now, ...opts });

    expect(now.toISOString()).toBe('2026-08-05T13:00:00.000Z');
  });

  it('returns the configured intervals verbatim, not rounded or scaled', () => {
    const odd = {
      hotIntervalMs: 1337,
      idleIntervalMs: 91011,
      burstThreshold: 8,
    };

    expect(nextPollDelayMs({ newCount: 0, now: midMorningIst, ...odd })).toBe(
      1337,
    );
    expect(nextPollDelayMs({ newCount: 0, now: deadOfNightIst, ...odd })).toBe(
      91011,
    );
  });
});
