import type { Filing } from '@app/filings';
import { RECENT_SEQ_ID_CAPACITY, RecentSeqIds } from './recent-seq-ids';

const makeFiling = (seqId: number): Filing => ({
  seqId,
  symbol: 'TEST',
  isin: 'INE000000001',
  companyName: 'Test Ltd',
  industry: null,
  category: 'Bagging/Receiving of orders/contracts',
  summary: `Order ${seqId}`,
  attachmentUrl: null,
  announcedAt: new Date('2026-08-05T04:58:18.000Z'),
  disseminatedAt: new Date('2026-08-05T04:58:18.000Z'),
  ingestedAt: new Date('2026-08-05T04:58:20.000Z'),
});

const ids = (filings: readonly Filing[]): number[] =>
  filings.map((filing) => filing.seqId);

const batch = (...seqIds: number[]): Filing[] => seqIds.map(makeFiling);

describe('RecentSeqIds', () => {
  it('passes everything through before anything is remembered', () => {
    const recent = new RecentSeqIds(10);

    expect(ids(recent.unseen(batch(3, 2, 1)))).toEqual([3, 2, 1]);
  });

  it('suppresses ids it was told are stored', () => {
    const recent = new RecentSeqIds(10);
    recent.remember(batch(2, 1));

    expect(ids(recent.unseen(batch(3, 2, 1)))).toEqual([3]);
  });

  it('returns a new array and never mutates the input', () => {
    const recent = new RecentSeqIds(10);
    recent.remember(batch(1));
    const input = batch(2, 1);

    const result = recent.unseen(input);

    expect(result).not.toBe(input);
    expect(ids(input)).toEqual([2, 1]);
  });

  it('is idempotent: remembering the same id twice holds one entry', () => {
    const recent = new RecentSeqIds(10);
    recent.remember(batch(1));
    recent.remember(batch(1));

    expect(recent.size()).toBe(1);
  });

  it('evicts oldest-first once capacity is exceeded', () => {
    const recent = new RecentSeqIds(3);
    recent.remember(batch(1, 2, 3));

    recent.remember(batch(4));

    expect(recent.size()).toBe(3);
    // 1 was the oldest, so it is the one that aged out and falls through.
    expect(ids(recent.unseen(batch(1, 2, 3, 4)))).toEqual([1]);
  });

  it('evicts by insertion age, not by recency of use', () => {
    // Refreshing an entry on every hit would pin the twenty ids the hot page
    // re-offers 28,800 times a day in memory forever, and starve the drain's
    // entries out — the opposite of what the bound is for.
    const recent = new RecentSeqIds(2);
    recent.remember(batch(1, 2));
    recent.unseen(batch(1));

    recent.remember(batch(3));

    expect(ids(recent.unseen(batch(1, 2, 3)))).toEqual([1]);
  });

  it('evicts down to capacity when a single batch overshoots it', () => {
    const recent = new RecentSeqIds(3);

    recent.remember(batch(1, 2, 3, 4, 5, 6, 7));

    expect(recent.size()).toBe(3);
    expect(ids(recent.unseen(batch(1, 4, 5, 6, 7)))).toEqual([1, 4]);
  });

  it('is a pre-filter, never an authority: an evicted id falls through', () => {
    // The load-bearing property. A miss must always reach `insertNew`, because
    // the unique index is the only thing that decides newness.
    const recent = new RecentSeqIds(1);
    recent.remember(batch(106689007));
    recent.remember(batch(106689006));

    expect(ids(recent.unseen(batch(106689007)))).toEqual([106689007]);
  });

  it('handles an empty batch on both sides', () => {
    const recent = new RecentSeqIds(4);
    recent.remember([]);

    expect(recent.unseen([])).toEqual([]);
    expect(recent.size()).toBe(0);
  });

  it('defaults to the documented capacity', () => {
    const recent = new RecentSeqIds();
    recent.remember(
      Array.from({ length: RECENT_SEQ_ID_CAPACITY + 5 }, (_, i) =>
        makeFiling(i),
      ),
    );

    expect(recent.size()).toBe(RECENT_SEQ_ID_CAPACITY);
  });

  it('holds a whole busy IST day without evicting any of it', () => {
    // The corpus's busiest IST day carried 1,023 filings, and the five-minute
    // drain re-offers a whole day at a time. A capacity below that would make
    // each drain evict the entries the next drain needs.
    const recent = new RecentSeqIds();
    const day = Array.from({ length: 1023 }, (_, i) => makeFiling(200000 + i));
    recent.remember(day);

    expect(recent.unseen(day)).toEqual([]);
  });

  const BAD_CAPACITIES: ReadonlyArray<readonly [string, number]> = [
    ['zero, which makes remembering a no-op', 0],
    ['negative', -1],
    ['fractional', 2.5],
    ['NaN, what Number() yields from a typo', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ];

  it.each(BAD_CAPACITIES)('refuses a capacity that is %s', (_label, value) => {
    expect(() => new RecentSeqIds(value)).toThrow(/whole number >= 1/);
  });
});
