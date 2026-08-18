import { readFileSync } from 'fs';
import { join } from 'path';
import { feedBucket } from './feed-bucket';

describe('feedBucket', () => {
  const NOW = Date.parse('2026-08-18T12:00:00.000Z');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const TODAY = '2026-08-18';
  const PREVIOUS = '2026-08-17';

  // "What landed while I was reading" is a different question from "what day
  // was this" — 30 minutes is the line between them.
  it('a filing on the IST day inside 30 minutes is Just now', () => {
    const iso = new Date(NOW - 29 * 60_000).toISOString();
    expect(feedBucket(TODAY, iso, TODAY, PREVIOUS)).toBe('Just now');
  });

  it('a filing on the IST day past 30 minutes is Earlier today', () => {
    const iso = new Date(NOW - 31 * 60_000).toISOString();
    expect(feedBucket(TODAY, iso, TODAY, PREVIOUS)).toBe('Earlier today');
  });

  // The guard that rejects a future-stamped filing: a slow browser clock must
  // not put the whole day under "Just now".
  it('a future-stamped filing on the IST day is Earlier today', () => {
    const iso = new Date(NOW + 5 * 60_000).toISOString();
    expect(feedBucket(TODAY, iso, TODAY, PREVIOUS)).toBe('Earlier today');
  });

  it('the previous IST day is Yesterday', () => {
    expect(
      feedBucket(PREVIOUS, '2026-08-17T10:00:00.000Z', TODAY, PREVIOUS),
    ).toBe('Yesterday');
  });

  // The server's own day string, printed verbatim — naming the day is never
  // WRONG, only plainer.
  it('any other day is named by its date', () => {
    expect(
      feedBucket('2026-08-14', '2026-08-14T10:00:00.000Z', TODAY, PREVIOUS),
    ).toBe('2026-08-14');
  });

  // Before the first summary lands both anchors are null and every filing is
  // named by its day.
  it('with no anchors every filing is named by its day', () => {
    expect(feedBucket(TODAY, '2026-08-18T10:00:00.000Z', null, null)).toBe(
      TODAY,
    );
  });

  // IST rolls at 18:30 UTC and the server owns that fact. Pure subtraction
  // once put Saturday 17:00 under "Today" at Sunday 09:00 — this module must
  // compare the server's strings and nothing else.
  it('does no date arithmetic', () => {
    const source = readFileSync(join(__dirname, 'feed-bucket.ts'), 'utf8');
    expect(source).not.toMatch(
      /getDate|getTimezoneOffset|toISOString|86400000/,
    );
  });
});
