import {
  IST_DAY_MS,
  IST_OFFSET_MS,
  istClock,
  istDayKey,
  istDayKeysEndingAt,
  istHumanTimestamp,
  istTimestamp,
  pad2,
  startOfIstDay,
} from './ist';

describe('IST_OFFSET_MS', () => {
  it('is exactly five and a half hours', () => {
    // The half hour is the part that gets lost. A 5-hour offset renders every
    // alert 30 minutes wrong and moves the IST day boundary, and both failures
    // look entirely plausible in a log.
    expect(IST_OFFSET_MS).toBe(19_800_000);
    expect(IST_OFFSET_MS).toBe(5.5 * 60 * 60 * 1000);
  });

  it('places the IST day boundary at 18:30 UTC', () => {
    const boundary = new Date('2026-08-05T18:30:00.000Z');

    expect(new Date(boundary.getTime() + IST_OFFSET_MS).toISOString()).toBe(
      '2026-08-06T00:00:00.000Z',
    );
  });
});

describe('pad2', () => {
  const CASES: ReadonlyArray<readonly [number, string]> = [
    [0, '00'],
    [3, '03'],
    [9, '09'],
    [10, '10'],
    [59, '59'],
    [2026, '2026'],
  ];

  it.each(CASES)('pads %s to %s', (value, expected) => {
    expect(pad2(value)).toBe(expected);
  });

  it('never truncates a value wider than two digits', () => {
    // A truncating pad would turn a year into a two-digit fragment and produce
    // a date NSE would accept as a different year.
    expect(pad2(123)).toBe('123');
  });
});

describe('IST_DAY_MS', () => {
  it('is exactly twenty-four hours', () => {
    expect(IST_DAY_MS).toBe(86_400_000);
  });
});

describe('istDayKey', () => {
  it('renders the IST calendar day, not the UTC one', () => {
    // 19:00 UTC is already the NEXT day in IST. A UTC-day key would file this
    // filing under the 5th and lose it from the 6th's count.
    expect(istDayKey(new Date('2026-08-05T19:00:00.000Z'))).toBe('2026-08-06');
  });

  it('places the day boundary at 18:30 UTC exactly', () => {
    expect(istDayKey(new Date('2026-08-05T18:29:59.999Z'))).toBe('2026-08-05');
    expect(istDayKey(new Date('2026-08-05T18:30:00.000Z'))).toBe('2026-08-06');
  });

  it('zero-pads month and day to a fixed width', () => {
    expect(istDayKey(new Date('2026-01-02T00:00:00.000Z'))).toBe('2026-01-02');
  });

  it('accepts a timestamp that arrived as an ISO string despite its type', () => {
    // A lean Mongo read, a JSON round trip and the JSONL corpus all deliver
    // these as strings. Calling getTime() on one directly throws.
    const asString = '2026-08-05T19:00:00.000Z' as unknown as Date;

    expect(istDayKey(asString)).toBe('2026-08-06');
  });

  it('throws rather than rendering NaN for an unusable timestamp', () => {
    // "NaN-NaN-NaN" in a table cell looks like a rendering quirk. A throw is
    // the only version of this failure anyone acts on.
    expect(() => istDayKey(new Date('not a date'))).toThrow(
      /Not a usable timestamp/,
    );
  });
});

describe('istClock', () => {
  it('renders the IST wall clock, offset by five and a half hours', () => {
    expect(istClock(new Date('2026-08-05T04:58:17.000Z'))).toBe('10:28:17');
  });

  it('zero-pads every component', () => {
    expect(istClock(new Date('2026-08-05T18:33:03.000Z'))).toBe('00:03:03');
  });
});

describe('istTimestamp', () => {
  it('joins the IST day and the IST clock', () => {
    expect(istTimestamp(new Date('2026-08-05T18:30:00.000Z'))).toBe(
      '2026-08-06 00:00:00',
    );
  });
});

describe('istHumanTimestamp', () => {
  it('renders the IST wall clock the way a person reads it aloud', () => {
    expect(istHumanTimestamp(new Date('2026-08-12T03:18:10.000Z'))).toBe(
      '12 Aug 2026, 8:48 am',
    );
  });

  it('crosses noon and midnight on a twelve-hour clock', () => {
    // The two hours a twelve-hour clock gets wrong when it is written by hand:
    // 12:xx pm modulo twelve is 0, and midnight is `12 am` of the NEXT day.
    expect(istHumanTimestamp(new Date('2026-08-12T06:35:00.000Z'))).toBe(
      '12 Aug 2026, 12:05 pm',
    );
    expect(istHumanTimestamp(new Date('2026-08-11T18:30:00.000Z'))).toBe(
      '12 Aug 2026, 12:00 am',
    );
  });

  it('pads the minute and does not pad the day', () => {
    // Nothing parses this string, so the fixed width `pad2` buys elsewhere buys
    // nothing here — but `8:5 am` is not a time.
    expect(istHumanTimestamp(new Date('2026-08-05T03:35:00.000Z'))).toBe(
      '5 Aug 2026, 9:05 am',
    );
  });

  it('reads the IST day, not the UTC one', () => {
    // 19:00 UTC is already tomorrow in IST, and this is the one field on the
    // share card a reader would check a date against.
    expect(istHumanTimestamp(new Date('2026-12-31T19:00:00.000Z'))).toBe(
      '1 Jan 2027, 12:30 am',
    );
  });

  it('says the same instant as the machine-readable string', () => {
    // The two are siblings and must never disagree: one is the tooltip and the
    // log line, the other is the picture somebody sends.
    const instant = new Date('2026-08-12T03:18:10.000Z');

    expect(istTimestamp(instant)).toBe('2026-08-12 08:48:10');
    expect(istHumanTimestamp(instant)).toBe('12 Aug 2026, 8:48 am');
  });

  it('throws rather than rendering NaN for an unusable timestamp', () => {
    expect(() => istHumanTimestamp(new Date('not a date'))).toThrow(
      /Not a usable timestamp/,
    );
  });
});

describe('startOfIstDay', () => {
  it('returns 18:30 UTC of the previous day', () => {
    expect(
      startOfIstDay(new Date('2026-08-05T19:00:00.000Z')).toISOString(),
    ).toBe('2026-08-05T18:30:00.000Z');
  });

  it('is idempotent — the start of a day is its own day start', () => {
    const start = startOfIstDay(new Date('2026-08-05T10:00:00.000Z'));

    expect(startOfIstDay(start).toISOString()).toBe(start.toISOString());
  });

  it('does not roll an instant one millisecond before the boundary forward', () => {
    expect(
      startOfIstDay(new Date('2026-08-05T18:29:59.999Z')).toISOString(),
    ).toBe('2026-08-04T18:30:00.000Z');
  });

  it('floors rather than truncates for instants before the epoch', () => {
    // A truncating cast rounds towards zero, which for a negative instant
    // rounds to the day AFTER the one containing it.
    const beforeEpoch = new Date('1969-12-31T12:00:00.000Z');

    expect(startOfIstDay(beforeEpoch).toISOString()).toBe(
      '1969-12-30T18:30:00.000Z',
    );
    expect(startOfIstDay(beforeEpoch).getTime()).toBeLessThan(
      beforeEpoch.getTime(),
    );
  });
});

describe('istDayKeysEndingAt', () => {
  it('returns the requested number of consecutive days, oldest first', () => {
    expect(istDayKeysEndingAt(new Date('2026-08-05T10:00:00.000Z'), 3)).toEqual(
      ['2026-08-03', '2026-08-04', '2026-08-05'],
    );
  });

  it('ends on the IST day, so an evening UTC instant ends on tomorrow', () => {
    expect(istDayKeysEndingAt(new Date('2026-08-05T19:00:00.000Z'), 2)).toEqual(
      ['2026-08-05', '2026-08-06'],
    );
  });

  it('returns a single key for one day', () => {
    expect(istDayKeysEndingAt(new Date('2026-08-05T10:00:00.000Z'), 1)).toEqual(
      ['2026-08-05'],
    );
  });

  it('crosses a month boundary', () => {
    expect(istDayKeysEndingAt(new Date('2026-09-01T10:00:00.000Z'), 2)).toEqual(
      ['2026-08-31', '2026-09-01'],
    );
  });

  it.each([[0], [-1], [1.5], [Number.NaN], [Number.POSITIVE_INFINITY]])(
    'rejects a day count of %s instead of returning an empty series',
    (days) => {
      // Array.from({length: NaN}) is an empty array, not an error, so an
      // unvalidated count would present as "ingestion stopped" rather than as
      // the bad request it is.
      expect(() =>
        istDayKeysEndingAt(new Date('2026-08-05T10:00:00.000Z'), days),
      ).toThrow(/whole number/);
    },
  );
});
