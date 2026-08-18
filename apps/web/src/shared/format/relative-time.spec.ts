import { relativeTime } from './relative-time';

/**
 * The one deliberate exception to "the server owns every time calculation":
 * "how long ago" is a difference between two instants, identical in every
 * timezone, and must move as the reader watches without a refetch. The
 * absolute IST string stays in the element's title.
 */
describe('relativeTime', () => {
  const NOW = Date.parse('2026-08-18T12:00:00.000Z');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const at = (msAgo: number): string => new Date(NOW - msAgo).toISOString();

  it.each([
    [-5_000, 'just now'], // future-stamped: never a negative age
    [0, 'just now'],
    [44_000, 'just now'],
    [60_000, 'a minute ago'],
    [10 * 60_000, '10 min ago'],
    [59 * 60_000, '59 min ago'],
    [2 * 3_600_000 + 30 * 60_000, '2h 30m ago'],
    [3 * 3_600_000, '3h ago'],
    [30 * 3_600_000, 'yesterday'],
    [3 * 86_400_000, '3 days ago'],
    [15 * 86_400_000, '2w ago'],
  ])('%d ms ago reads "%s"', (msAgo, expected) => {
    expect(relativeTime(at(msAgo))).toBe(expected);
  });

  // Falls back to the raw value rather than inventing one: an unparseable
  // date shows as itself, which is debuggable, instead of "just now", which
  // is a lie.
  it('returns an unparseable value as itself', () => {
    expect(relativeTime('not-a-date')).toBe('not-a-date');
  });

  it('returns an em dash for nothing', () => {
    expect(relativeTime('')).toBe('—');
    expect(relativeTime(undefined)).toBe('—');
    expect(relativeTime(null)).toBe('—');
  });
});
