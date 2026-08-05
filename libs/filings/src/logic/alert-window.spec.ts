import {
  isWithinAlertWindow,
  partitionForAlerting,
  AlertPartition,
} from './alert-window';
import type { Filing } from '../filing.types';

const WINDOW = 10 * 60 * 1000;
const now = new Date('2026-08-05T05:00:00.000Z');

const at = (iso: string): Filing => ({
  seqId: 1,
  symbol: 'TEST',
  isin: 'INE000000001',
  companyName: 'Test Ltd',
  industry: null,
  category: 'Bagging/Receiving of orders/contracts',
  summary: 'Order received',
  attachmentUrl: null,
  announcedAt: new Date(iso),
  disseminatedAt: new Date(iso),
  ingestedAt: now,
});

describe('isWithinAlertWindow', () => {
  it('allows a filing disseminated seconds ago', () => {
    expect(
      isWithinAlertWindow(at('2026-08-05T04:59:50.000Z'), now, WINDOW),
    ).toBe(true);
  });

  it('rejects a filing disseminated an hour ago', () => {
    expect(
      isWithinAlertWindow(at('2026-08-05T04:00:00.000Z'), now, WINDOW),
    ).toBe(false);
  });

  it('rejects a filing exactly at the window edge', () => {
    expect(
      isWithinAlertWindow(at('2026-08-05T04:50:00.000Z'), now, WINDOW),
    ).toBe(false);
  });

  it('allows a filing just inside the window edge', () => {
    expect(
      isWithinAlertWindow(at('2026-08-05T04:50:01.000Z'), now, WINDOW),
    ).toBe(true);
  });

  it('allows a filing with a slightly future timestamp (clock skew)', () => {
    expect(
      isWithinAlertWindow(at('2026-08-05T05:00:05.000Z'), now, WINDOW),
    ).toBe(true);
  });
});

/**
 * The window boundary decides whether a restart alerts or stays quiet, so it is
 * pinned to the millisecond on both sides. The rule is EXCLUSIVE: a filing
 * exactly `windowMs` old is stale. `windowMs - 1`, `windowMs` and `windowMs + 1`
 * are all present so that flipping `<` to `<=` cannot pass.
 */
describe('isWithinAlertWindow: the boundary is exclusive, to the millisecond', () => {
  // now is 2026-08-05T05:00:00.000Z; WINDOW is 600000 ms.
  const BOUNDARY_CASES: ReadonlyArray<readonly [string, string, boolean]> = [
    ['age 600001 ms, one past the edge', '2026-08-05T04:49:59.999Z', false],
    ['age 600000 ms, exactly the edge', '2026-08-05T04:50:00.000Z', false],
    ['age 599999 ms, one inside the edge', '2026-08-05T04:50:00.001Z', true],
    ['age 1 ms', '2026-08-05T04:59:59.999Z', true],
    ['age 0 ms, disseminated this instant', '2026-08-05T05:00:00.000Z', true],
    ['age -1 ms, one ms into the future', '2026-08-05T05:00:00.001Z', true],
  ];

  it.each(BOUNDARY_CASES)('%s (%s) -> %s', (_label, iso, expected) => {
    expect(isWithinAlertWindow(at(iso), now, WINDOW)).toBe(expected);
  });

  it('pins the exclusive edge as an adjacent pair', () => {
    // The pair that kills `<=`: one millisecond apart, opposite answers.
    expect(
      isWithinAlertWindow(at('2026-08-05T04:50:00.000Z'), now, WINDOW),
    ).toBe(false);
    expect(
      isWithinAlertWindow(at('2026-08-05T04:50:00.001Z'), now, WINDOW),
    ).toBe(true);
  });

  it('honours a caller-supplied window rather than a hardcoded ten minutes', () => {
    const oneMinute = 60 * 1000;
    const oneHour = 60 * 60 * 1000;
    const fiveMinutesOld = at('2026-08-05T04:55:00.000Z');

    expect(isWithinAlertWindow(fiveMinutesOld, now, oneMinute)).toBe(false);
    expect(isWithinAlertWindow(fiveMinutesOld, now, oneHour)).toBe(true);
  });
});

/**
 * Clock skew: NSE's dissemination clock is not ours. If theirs runs marginally
 * ahead, `now - disseminatedAt` is NEGATIVE. A negative age is the freshest
 * possible filing and MUST alert. Treating it as out-of-window — which any
 * `Math.abs(age)` or `age >= 0 && age < windowMs` form would do — would silently
 * suppress exactly the filings this pipeline exists to deliver.
 */
describe('isWithinAlertWindow: negative age is fresh, never stale', () => {
  const SKEW_CASES: ReadonlyArray<readonly [string, string]> = [
    ['1 ms ahead', '2026-08-05T05:00:00.001Z'],
    ['5 s ahead', '2026-08-05T05:00:05.000Z'],
    ['exactly one window ahead', '2026-08-05T05:10:00.000Z'],
    ['one ms beyond one window ahead', '2026-08-05T05:10:00.001Z'],
    ['a full hour ahead', '2026-08-05T06:00:00.000Z'],
  ];

  it.each(SKEW_CASES)('a filing dated %s is alertable', (_label, iso) => {
    expect(isWithinAlertWindow(at(iso), now, WINDOW)).toBe(true);
  });

  it('does not fold a future timestamp back through zero', () => {
    // `Math.abs(age) < windowMs` passes the small-skew cases above but fails
    // here: an hour-ahead filing would be called stale and never alert.
    const hourAhead = at('2026-08-05T06:00:00.000Z');
    const hourBehind = at('2026-08-05T04:00:00.000Z');

    expect(isWithinAlertWindow(hourAhead, now, WINDOW)).toBe(true);
    expect(isWithinAlertWindow(hourBehind, now, WINDOW)).toBe(false);
  });

  it('errs toward alerting on an implausibly future timestamp', () => {
    // A far-future disseminatedAt is bad data rather than skew, but the gate
    // still lets it through: suppressing a real filing is far worse than one
    // spurious alert, and this function cannot tell the two cases apart.
    // Sanity-checking absurd timestamps belongs upstream, in the mapper.
    expect(
      isWithinAlertWindow(at('2027-01-01T00:00:00.000Z'), now, WINDOW),
    ).toBe(true);
  });
});

/**
 * `disseminatedAt` is the exchange clock and the only clock this decision may
 * read. `ingestedAt` is our own wall time and is fresh for every record on a
 * cold-start drain — reading it would defeat the gate entirely. `announcedAt`
 * is the company's stated time and can lag dissemination by minutes.
 */
describe('isWithinAlertWindow: reads disseminatedAt, never ingest or announce time', () => {
  const staleDissemination = new Date('2026-08-04T10:00:00.000Z');
  const freshDissemination = new Date('2026-08-05T04:59:50.000Z');

  it('rejects a day-old filing that was ingested this instant', () => {
    // Exactly the cold-start shape: ingestedAt is now for all 1000 records.
    const backfilled: Filing = {
      ...at('2026-08-04T10:00:00.000Z'),
      disseminatedAt: staleDissemination,
      ingestedAt: now,
    };

    expect(isWithinAlertWindow(backfilled, now, WINDOW)).toBe(false);
  });

  it('allows a fresh filing that was ingested long ago', () => {
    const oddlyIngested: Filing = {
      ...at('2026-08-05T04:59:50.000Z'),
      disseminatedAt: freshDissemination,
      ingestedAt: new Date('2026-08-01T00:00:00.000Z'),
    };

    expect(isWithinAlertWindow(oddlyIngested, now, WINDOW)).toBe(true);
  });

  it('ignores a stale announcedAt when dissemination is fresh', () => {
    const lateDisseminated: Filing = {
      ...at('2026-08-05T04:59:50.000Z'),
      announcedAt: new Date('2026-08-05T03:00:00.000Z'),
      disseminatedAt: freshDissemination,
    };

    expect(isWithinAlertWindow(lateDisseminated, now, WINDOW)).toBe(true);
  });

  it('ignores a fresh announcedAt when dissemination is stale', () => {
    const earlyAnnounced: Filing = {
      ...at('2026-08-04T10:00:00.000Z'),
      announcedAt: new Date('2026-08-05T04:59:50.000Z'),
      disseminatedAt: staleDissemination,
    };

    expect(isWithinAlertWindow(earlyAnnounced, now, WINDOW)).toBe(false);
  });

  it('depends only on the instant supplied, never on the real clock', () => {
    // Same relative age, decades apart. A Date.now() read would fail both.
    const past = new Date('1999-01-15T05:00:00.000Z');
    const future = new Date('2099-01-15T05:00:00.000Z');

    expect(
      isWithinAlertWindow(at('1999-01-15T04:59:50.000Z'), past, WINDOW),
    ).toBe(true);
    expect(
      isWithinAlertWindow(at('2099-01-15T04:59:50.000Z'), future, WINDOW),
    ).toBe(true);
    expect(
      isWithinAlertWindow(at('1999-01-15T04:00:00.000Z'), past, WINDOW),
    ).toBe(false);
    expect(
      isWithinAlertWindow(at('2099-01-15T04:00:00.000Z'), future, WINDOW),
    ).toBe(false);
  });
});

/**
 * Filings read back from Mongo, or replayed from a JSONL corpus, carry
 * `disseminatedAt` as an ISO STRING even though the type says Date. Task 3 hit
 * exactly this and it silently broke day-bucketing. A bare `filing.disseminatedAt
 * .getTime()` would throw here; subtracting a string would yield NaN and silence
 * the alert. The implementation's `new Date(...)` wrap is what makes the two
 * shapes behave identically.
 */
describe('isWithinAlertWindow: tolerates a string disseminatedAt from storage', () => {
  // The cast is the point of the test: it reproduces the runtime shape the
  // Filing type does not describe. `as unknown as` rather than `any`.
  const asStored = (iso: string): Filing =>
    ({ ...at(iso), disseminatedAt: iso }) as unknown as Filing;

  const STORED_CASES: ReadonlyArray<readonly [string, string, boolean]> = [
    ['seconds ago', '2026-08-05T04:59:50.000Z', true],
    ['an hour ago', '2026-08-05T04:00:00.000Z', false],
    ['exactly at the edge', '2026-08-05T04:50:00.000Z', false],
    ['one ms inside the edge', '2026-08-05T04:50:00.001Z', true],
    ['five seconds ahead (skew)', '2026-08-05T05:00:05.000Z', true],
  ];

  it.each(STORED_CASES)(
    'a stored string dated %s is handled identically to a Date',
    (_label, iso, expected) => {
      expect(isWithinAlertWindow(asStored(iso), now, WINDOW)).toBe(expected);
      // The point of the suite: same answer, both shapes.
      expect(isWithinAlertWindow(asStored(iso), now, WINDOW)).toBe(
        isWithinAlertWindow(at(iso), now, WINDOW),
      );
    },
  );

  it('does not throw when handed a string instead of a Date', () => {
    expect(() =>
      isWithinAlertWindow(asStored('2026-08-05T04:59:50.000Z'), now, WINDOW),
    ).not.toThrow();
  });

  it('partitions a batch of stored strings exactly as it partitions Dates', () => {
    const stored = [
      asStored('2026-08-05T04:59:00.000Z'),
      asStored('2026-08-04T10:00:00.000Z'),
    ];

    const { alertable, silent } = partitionForAlerting(stored, now, WINDOW);

    expect(alertable).toHaveLength(1);
    expect(silent).toHaveLength(1);
    expect(alertable[0]).toBe(stored[0]);
    expect(silent[0]).toBe(stored[1]);
  });

  // A partial document is likelier than a literal bad string: a projection that
  // omits the field, or a record written before the field existed, yields
  // undefined or null. Every unusable value below is suppressed, but by two
  // different mechanisms, and the distinction is worth knowing:
  //
  //   'not-a-date', '', undefined  ->  getTime() is NaN, and `NaN < windowMs`
  //                                    is false.
  //   null                         ->  `new Date(null)` is NOT NaN; null
  //                                    coerces to 0, i.e. the 1970 epoch, so
  //                                    the age is ~56 years and it is stale by
  //                                    the ordinary rule.
  //
  // Either way a corrupt record is stored silently instead of firing an alert
  // nobody can act on. Pinned because it is a real consequence of accepting
  // unparsed values at this boundary.
  const UNUSABLE_TIMESTAMPS: ReadonlyArray<readonly [string, unknown]> = [
    ['an unparseable string', 'not-a-date'],
    ['an empty string', ''],
    ['undefined (field absent from the document)', undefined],
    ['null (field present but never written)', null],
  ];

  it.each(UNUSABLE_TIMESTAMPS)(
    'stays silent on %s rather than alerting',
    (_label, value) => {
      const corrupt = {
        ...at('2026-08-05T04:59:50.000Z'),
        disseminatedAt: value,
      } as unknown as Filing;

      expect(isWithinAlertWindow(corrupt, now, WINDOW)).toBe(false);
    },
  );

  it('routes an unusable timestamp to silent, not to alertable', () => {
    const batch = UNUSABLE_TIMESTAMPS.map(
      ([, value]) =>
        ({
          ...at('2026-08-05T04:59:50.000Z'),
          disseminatedAt: value,
        }) as unknown as Filing,
    );

    const { alertable, silent } = partitionForAlerting(batch, now, WINDOW);

    expect(alertable).toEqual([]);
    expect(silent).toHaveLength(UNUSABLE_TIMESTAMPS.length);
  });
});

describe('partitionForAlerting', () => {
  it('suppresses a historical backfill entirely', () => {
    // The cold-start storm case: a drain returns a full day of old filings.
    const backfill = Array.from({ length: 1000 }, () =>
      at('2026-08-04T10:00:00.000Z'),
    );

    const { alertable, silent } = partitionForAlerting(backfill, now, WINDOW);

    expect(alertable).toHaveLength(0);
    expect(silent).toHaveLength(1000);
  });

  it('splits a mixed batch correctly', () => {
    const batch = [
      at('2026-08-05T04:59:00.000Z'),
      at('2026-08-04T10:00:00.000Z'),
    ];

    const { alertable, silent } = partitionForAlerting(batch, now, WINDOW);

    expect(alertable).toHaveLength(1);
    expect(silent).toHaveLength(1);
  });

  it('handles an empty batch', () => {
    expect(partitionForAlerting([], now, WINDOW)).toEqual({
      alertable: [],
      silent: [],
    });
  });
});

/**
 * The storm case at realistic scale. Task 6 made cold start drain on EVERY
 * process start, so a restart hands this function ~1000 filings that all look
 * new to the repository. Asserting only `alertable` is empty is not enough: an
 * implementation that returned two empty arrays would pass that. Every record
 * must be accounted for on the silent side.
 */
describe('partitionForAlerting: the cold-start storm at scale', () => {
  const STORM_SIZE = 1000;

  const dayOldDrain = (): Filing[] =>
    Array.from({ length: STORM_SIZE }, (_unused, index) => ({
      ...at('2026-08-04T10:00:00.000Z'),
      seqId: 106725000 + index,
    }));

  it('stores all 1000 drained filings and alerts on none of them', () => {
    const { alertable, silent } = partitionForAlerting(
      dayOldDrain(),
      now,
      WINDOW,
    );

    expect(alertable).toEqual([]);
    expect(silent).toHaveLength(STORM_SIZE);
    // Nothing is dropped: the pipeline still persists every record.
    expect(alertable.length + silent.length).toBe(STORM_SIZE);
  });

  it('keeps every drained filing, identified by seq id, on the silent side', () => {
    const drain = dayOldDrain();

    const { silent } = partitionForAlerting(drain, now, WINDOW);

    expect(silent.map((filing) => filing.seqId)).toEqual(
      drain.map((filing) => filing.seqId),
    );
  });

  it('still surfaces the genuinely fresh records buried in a drain', () => {
    // A restart mid-session: most of the page is history, the top few are live.
    const drain = [
      ...dayOldDrain(),
      { ...at('2026-08-05T04:59:58.000Z'), seqId: 106726001 },
      { ...at('2026-08-05T04:59:59.000Z'), seqId: 106726002 },
      { ...at('2026-08-05T04:52:00.000Z'), seqId: 106726003 },
    ];

    const { alertable, silent } = partitionForAlerting(drain, now, WINDOW);

    expect(alertable.map((filing) => filing.seqId)).toEqual([
      106726001, 106726002, 106726003,
    ]);
    expect(silent).toHaveLength(STORM_SIZE);
    expect(alertable.length + silent.length).toBe(drain.length);
  });

  it('accounts for every input filing exactly once', () => {
    const mixed = Array.from({ length: 500 }, (_unused, index) => ({
      ...at(
        index % 3 === 0
          ? '2026-08-05T04:59:00.000Z'
          : '2026-08-04T10:00:00.000Z',
      ),
      seqId: index,
    }));

    const { alertable, silent } = partitionForAlerting(mixed, now, WINDOW);

    const returned = [...alertable, ...silent].map((filing) => filing.seqId);
    expect(returned.slice().sort((a, b) => a - b)).toEqual(
      mixed.map((filing) => filing.seqId),
    );
    expect(alertable).toHaveLength(167);
    expect(silent).toHaveLength(333);
  });
});

/**
 * Task 11 sends `alertable` to Telegram in the order it receives it, and NSE
 * pages are ordered newest-first. Reordering here would reorder the user's
 * messages. The input array and the Filing objects on it are the poller's, and
 * must come back untouched.
 */
describe('partitionForAlerting: order and immutability', () => {
  const ordered = (): Filing[] => [
    { ...at('2026-08-05T04:59:59.000Z'), seqId: 1 },
    { ...at('2026-08-04T10:00:00.000Z'), seqId: 2 },
    { ...at('2026-08-05T04:59:00.000Z'), seqId: 3 },
    { ...at('2026-08-04T11:00:00.000Z'), seqId: 4 },
    { ...at('2026-08-05T04:50:01.000Z'), seqId: 5 },
    { ...at('2026-08-03T09:00:00.000Z'), seqId: 6 },
  ];

  it('preserves input order within alertable', () => {
    const { alertable } = partitionForAlerting(ordered(), now, WINDOW);

    expect(alertable.map((filing) => filing.seqId)).toEqual([1, 3, 5]);
  });

  it('preserves input order within silent', () => {
    const { silent } = partitionForAlerting(ordered(), now, WINDOW);

    expect(silent.map((filing) => filing.seqId)).toEqual([2, 4, 6]);
  });

  it('returns the caller filings by reference, not copies', () => {
    // Task 11 formats these objects; re-wrapping them here would strip the
    // Date instances and reintroduce the string-timestamp bug.
    const batch = ordered();

    const { alertable, silent } = partitionForAlerting(batch, now, WINDOW);

    expect(alertable[0]).toBe(batch[0]);
    expect(silent[0]).toBe(batch[1]);
  });

  it('does not reorder the caller batch', () => {
    const batch = ordered();

    partitionForAlerting(batch, now, WINDOW);

    expect(batch.map((filing) => filing.seqId)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('does not shrink or grow the caller batch', () => {
    const batch = ordered();

    partitionForAlerting(batch, now, WINDOW);

    expect(batch).toHaveLength(6);
  });

  it('does not mutate the filings it is handed', () => {
    const batch = ordered();
    const before = batch.map((filing) => filing.disseminatedAt.toISOString());

    partitionForAlerting(batch, now, WINDOW);

    expect(batch.map((filing) => filing.disseminatedAt.toISOString())).toEqual(
      before,
    );
  });

  it('does not mutate the now Date', () => {
    const clock = new Date('2026-08-05T05:00:00.000Z');

    partitionForAlerting(ordered(), clock, WINDOW);

    expect(clock.toISOString()).toBe('2026-08-05T05:00:00.000Z');
  });

  it('tolerates a frozen input array', () => {
    const batch = Object.freeze(ordered());

    expect(() => partitionForAlerting(batch, now, WINDOW)).not.toThrow();
  });

  it('returns arrays that do not alias the caller batch', () => {
    const batch = ordered();

    const { alertable, silent } = partitionForAlerting(batch, now, WINDOW);
    alertable.push(at('2026-08-05T04:59:00.000Z'));
    silent.push(at('2026-08-04T10:00:00.000Z'));

    expect(batch).toHaveLength(6);
  });

  it('accepts a readonly array without widening', () => {
    // Compile-time guard: the poller's batch is readonly.
    const batch: readonly Filing[] = Object.freeze(ordered());
    const result: AlertPartition = partitionForAlerting(batch, now, WINDOW);

    expect(result.alertable.map((filing) => filing.seqId)).toEqual([1, 3, 5]);
  });
});

describe('partitionForAlerting: degenerate windows', () => {
  it('silences everything already disseminated when the window is zero', () => {
    // Pins the consequence rather than endorsing it: with windowMs = 0 only a
    // future-dated filing satisfies `age < 0`, so a misconfigured window mutes
    // the bot completely. See the NaN case below for the exact shape the Task
    // 12 config guard has to reject.
    const batch = [
      at('2026-08-05T05:00:00.000Z'),
      at('2026-08-05T04:59:59.999Z'),
    ];

    const { alertable, silent } = partitionForAlerting(batch, now, 0);

    expect(alertable).toEqual([]);
    expect(silent).toHaveLength(2);
  });

  it('silences a fresh filing when the window is NaN', () => {
    // The whole-bot mute, arriving through the one input this function takes on
    // trust. `parseInt(process.env.ALERT_WINDOW_MS)` yields NaN whenever the
    // variable is missing or malformed, and every comparison against NaN is
    // false — so `age < NaN` is false for EVERY filing and nothing ever alerts,
    // with no error raised anywhere.
    //
    // Note why the obvious guard does not catch this: `NaN < 1` is also false,
    // so a `windowMs < 1` rejection ACCEPTS NaN and lets it straight through.
    //
    // TASK 12 MUST REQUIRE `Number.isFinite(windowMs) && windowMs >= 1` at
    // config load. A bare lower-bound comparison is not sufficient.
    const fresh = at('2026-08-05T04:59:50.000Z');

    expect(isWithinAlertWindow(fresh, now, Number.NaN)).toBe(false);
  });

  it('proves a bare lower-bound config check would admit NaN', () => {
    // Executable form of the note above, so the hazard cannot be quietly
    // reintroduced by someone writing the intuitive guard.
    const badGuard = (windowMs: number): boolean => windowMs < 1;
    const goodGuard = (windowMs: number): boolean =>
      !(Number.isFinite(windowMs) && windowMs >= 1);

    expect(badGuard(Number.NaN)).toBe(false); // does not reject NaN
    expect(goodGuard(Number.NaN)).toBe(true); // rejects NaN

    // Both agree on the ordinary bad values, so the fix costs nothing.
    expect(badGuard(0)).toBe(true);
    expect(goodGuard(0)).toBe(true);
    expect(badGuard(600000)).toBe(false);
    expect(goodGuard(600000)).toBe(false);
  });

  it('silences everything when the window is NaN, across a whole batch', () => {
    const batch = [
      at('2026-08-05T04:59:59.000Z'),
      at('2026-08-05T05:00:00.000Z'),
      at('2026-08-05T05:00:05.000Z'),
      at('2026-08-04T10:00:00.000Z'),
    ];

    const { alertable, silent } = partitionForAlerting(batch, now, Number.NaN);

    expect(alertable).toEqual([]);
    expect(silent).toHaveLength(4);
  });

  it('alerts on everything when the window is enormous', () => {
    const oneYear = 365 * 24 * 60 * 60 * 1000;
    const batch = [
      at('2026-08-05T04:59:00.000Z'),
      at('2026-08-04T10:00:00.000Z'),
      at('2026-01-01T00:00:00.000Z'),
    ];

    const { alertable, silent } = partitionForAlerting(batch, now, oneYear);

    expect(alertable).toHaveLength(3);
    expect(silent).toEqual([]);
  });
});
