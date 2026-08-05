import { detectRollover, RolloverInput, RolloverResult } from './rollover';

describe('detectRollover', () => {
  it('treats every record as new on first run and demands a drain', () => {
    const result = detectRollover({ pageSeqIds: [30, 20, 10], cursor: null });

    expect(result.newSeqIds).toEqual([30, 20, 10]);
    expect(result.holeDetected).toBe(true);
  });

  it('returns only ids above the cursor when the page overlaps', () => {
    const result = detectRollover({ pageSeqIds: [50, 40, 30, 20], cursor: 30 });

    expect(result.newSeqIds).toEqual([50, 40]);
    expect(result.holeDetected).toBe(false);
  });

  it('reports no new records when the cursor is at the top of the page', () => {
    const result = detectRollover({ pageSeqIds: [50, 40, 30], cursor: 50 });

    expect(result.newSeqIds).toEqual([]);
    expect(result.holeDetected).toBe(false);
  });

  it('detects a hole when the whole page is newer than the cursor', () => {
    // Page turned over between polls: nothing on it overlaps what we have.
    const result = detectRollover({ pageSeqIds: [90, 80, 70], cursor: 60 });

    expect(result.newSeqIds).toEqual([90, 80, 70]);
    expect(result.holeDetected).toBe(true);
  });

  it('does not flag a hole when the oldest id equals the cursor', () => {
    const result = detectRollover({ pageSeqIds: [90, 80, 70], cursor: 70 });

    expect(result.newSeqIds).toEqual([90, 80]);
    expect(result.holeDetected).toBe(false);
  });

  it('tolerates non-contiguous seq ids, which are normal', () => {
    // seq_id is a global counter; gaps belong to other NSE streams.
    const result = detectRollover({
      pageSeqIds: [106725630, 106725580, 106725492],
      cursor: 106725492,
    });

    expect(result.newSeqIds).toEqual([106725630, 106725580]);
    expect(result.holeDetected).toBe(false);
  });

  it('handles an empty page without claiming a hole', () => {
    const result = detectRollover({ pageSeqIds: [], cursor: 100 });

    expect(result.newSeqIds).toEqual([]);
    expect(result.holeDetected).toBe(false);
  });

  it('sorts unordered input descending before deciding', () => {
    const result = detectRollover({ pageSeqIds: [20, 50, 30, 40], cursor: 30 });

    expect(result.newSeqIds).toEqual([50, 40]);
    expect(result.holeDetected).toBe(false);
  });

  it('never returns ids at or below the cursor', () => {
    const result = detectRollover({ pageSeqIds: [10, 20, 30], cursor: 30 });

    expect(result.newSeqIds.every((id) => id > 30)).toBe(true);
  });
});

describe('detectRollover: contiguity is never a completeness signal', () => {
  // Measured on live data: 20 equities records spanned seq_ids
  // 106725492..106725630 — a range of 138 for 20 records. The equities feed is
  // a filtered view of a counter shared with every other NSE announcement
  // stream, so wide gaps between adjacent records are routine. A rule that
  // read a gap as loss would demand a drain on almost every poll.
  const LIVE_PAGE: readonly number[] = [
    106725630, 106725627, 106725619, 106725612, 106725606, 106725599, 106725593,
    106725588, 106725581, 106725576, 106725570, 106725563, 106725557, 106725550,
    106725544, 106725537, 106725529, 106725518, 106725505, 106725492,
  ];

  it('ingests only the ids above the cursor from a realistic 20-record page', () => {
    const result = detectRollover({
      pageSeqIds: LIVE_PAGE,
      cursor: 106725557,
    });

    expect(result.newSeqIds).toEqual([
      106725630, 106725627, 106725619, 106725612, 106725606, 106725599,
      106725593, 106725588, 106725581, 106725576, 106725570, 106725563,
    ]);
    expect(result.holeDetected).toBe(false);
  });

  it('stays quiet when the cursor is a gap-interior id no record ever used', () => {
    // 106725560 belongs to another NSE stream and will never appear on the
    // equities page. Overlap still holds: the oldest id is older than it.
    const result = detectRollover({ pageSeqIds: LIVE_PAGE, cursor: 106725560 });

    expect(result.holeDetected).toBe(false);
    expect(result.newSeqIds).toEqual([
      106725630, 106725627, 106725619, 106725612, 106725606, 106725599,
      106725593, 106725588, 106725581, 106725576, 106725570, 106725563,
    ]);
  });

  it('does not drain merely because a 138-wide span holds only 20 records', () => {
    const span = LIVE_PAGE[0] - LIVE_PAGE[LIVE_PAGE.length - 1];

    expect(span).toBe(138);
    expect(LIVE_PAGE).toHaveLength(20);
    expect(
      detectRollover({ pageSeqIds: LIVE_PAGE, cursor: 106725492 }).holeDetected,
    ).toBe(false);
  });
});

describe('detectRollover: overlap edge cases', () => {
  it('drains when the page is newer by exactly one', () => {
    // The tightest possible miss: cursor 69, oldest 70. No overlap, so we
    // cannot prove the record between them (if any) was seen.
    const result = detectRollover({ pageSeqIds: [90, 80, 70], cursor: 69 });

    expect(result.holeDetected).toBe(true);
    expect(result.newSeqIds).toEqual([90, 80, 70]);
  });

  it('does not drain when the cursor sits above the newest id on the page', () => {
    // A stale or replayed page. There is overlap in abundance, nothing is new.
    const result = detectRollover({ pageSeqIds: [30, 20, 10], cursor: 100 });

    expect(result.newSeqIds).toEqual([]);
    expect(result.holeDetected).toBe(false);
  });

  it('handles a single-record page that overlaps the cursor', () => {
    const result = detectRollover({ pageSeqIds: [50], cursor: 50 });

    expect(result.newSeqIds).toEqual([]);
    expect(result.holeDetected).toBe(false);
  });

  it('handles a single-record page that does not overlap the cursor', () => {
    const result = detectRollover({ pageSeqIds: [50], cursor: 49 });

    expect(result.newSeqIds).toEqual([50]);
    expect(result.holeDetected).toBe(true);
  });

  it('treats a zero cursor as a real cursor, not as absent', () => {
    // 0 is falsy; a truthiness check here would silently drain forever.
    const result = detectRollover({ pageSeqIds: [3, 2, 1, 0], cursor: 0 });

    expect(result.newSeqIds).toEqual([3, 2, 1]);
    expect(result.holeDetected).toBe(false);
  });

  it('passes duplicate ids through rather than collapsing them', () => {
    // NSE has not been observed repeating a seq_id on one page. If it ever
    // does, de-duplication belongs at the repository's unique index, not here
    // — this function must not quietly decide a record was already seen.
    const result = detectRollover({ pageSeqIds: [40, 40, 30], cursor: 30 });

    expect(result.newSeqIds).toEqual([40, 40]);
    expect(result.holeDetected).toBe(false);
  });
});

describe('detectRollover: cold start', () => {
  it('demands a drain even when nothing on the page is worth ingesting', () => {
    // With no cursor there is nothing to overlap against, so the honest answer
    // is "I cannot prove completeness" regardless of what the page holds.
    const result = detectRollover({ pageSeqIds: [10], cursor: null });

    expect(result.holeDetected).toBe(true);
    expect(result.newSeqIds).toEqual([10]);
  });

  it('demands a drain on an empty first page', () => {
    // An empty page cannot advance the cursor, so this drain is the only
    // chance to establish a baseline before records start arriving.
    const result = detectRollover({ pageSeqIds: [], cursor: null });

    expect(result.holeDetected).toBe(true);
    expect(result.newSeqIds).toEqual([]);
  });

  it('sorts the cold-start page descending too', () => {
    const result = detectRollover({ pageSeqIds: [10, 30, 20], cursor: null });

    expect(result.newSeqIds).toEqual([30, 20, 10]);
  });
});

describe('detectRollover: immutability', () => {
  it('does not sort the caller page in place', () => {
    // The poller holds this array alongside the records it came from. Sorting
    // it in place would silently reorder the caller's page.
    const page = [20, 50, 30, 40];

    detectRollover({ pageSeqIds: page, cursor: 30 });

    expect(page).toEqual([20, 50, 30, 40]);
  });

  it('returns an array that does not alias the caller page', () => {
    const page = [30, 20, 10];

    const result = detectRollover({ pageSeqIds: page, cursor: null });
    result.newSeqIds.push(999);

    expect(page).toEqual([30, 20, 10]);
  });

  it('tolerates a frozen input page', () => {
    const page = Object.freeze([20, 50, 30, 40]);

    expect(() =>
      detectRollover({ pageSeqIds: page, cursor: 30 }),
    ).not.toThrow();
  });
});

/**
 * Exhaustive invariant sweep. Deterministic by construction — every subset of a
 * five-element pool, in three orderings, against seven cursors (672 cases). No
 * randomness, so this can never flake.
 */
describe('detectRollover: invariants over an exhaustive input space', () => {
  const POOL: readonly number[] = [10, 20, 30, 40, 50];
  const CURSORS: readonly (number | null)[] = [null, 5, 10, 25, 30, 50, 55];

  interface Case {
    readonly page: readonly number[];
    readonly cursor: number | null;
    readonly label: string;
  }

  const subsetsOf = (pool: readonly number[]): number[][] => {
    const out: number[][] = [];
    for (let mask = 0; mask < 1 << pool.length; mask += 1) {
      out.push(pool.filter((_, index) => (mask & (1 << index)) !== 0));
    }
    return out;
  };

  const rotated = (xs: readonly number[]): number[] =>
    xs.length === 0 ? [] : [...xs.slice(1), xs[0]];

  const CASES: readonly Case[] = subsetsOf(POOL).flatMap((subset) =>
    [subset, rotated(subset), [...subset].reverse()].flatMap((page) =>
      CURSORS.map((cursor) => ({
        page,
        cursor,
        label: `page=[${page.join(',')}] cursor=${cursor}`,
      })),
    ),
  );

  const run = (testCase: Case): RolloverResult =>
    detectRollover({ pageSeqIds: testCase.page, cursor: testCase.cursor });

  const offenders = (
    holds: (c: Case, r: RolloverResult) => boolean,
  ): string[] => CASES.filter((c) => !holds(c, run(c))).map((c) => c.label);

  it('covers the whole space it claims to', () => {
    expect(CASES).toHaveLength(2 ** POOL.length * 3 * CURSORS.length);
    expect(CASES).toHaveLength(672);
  });

  it('never returns a seq id at or below the cursor', () => {
    expect(
      offenders((c, r) => {
        const { cursor } = c;
        return cursor === null || r.newSeqIds.every((id) => id > cursor);
      }),
    ).toEqual([]);
  });

  it('only ever returns ids that were on the page', () => {
    expect(
      offenders((c, r) => r.newSeqIds.every((id) => c.page.includes(id))),
    ).toEqual([]);
  });

  it('never drops an id that is above the cursor', () => {
    expect(
      offenders((c, r) => {
        const owed = c.page
          .filter((id) => c.cursor === null || id > c.cursor)
          .sort((a, b) => b - a);
        return JSON.stringify(r.newSeqIds) === JSON.stringify(owed);
      }),
    ).toEqual([]);
  });

  it('always returns ids in descending order', () => {
    expect(
      offenders((_c, r) =>
        r.newSeqIds.every(
          (id, index) => index === 0 || r.newSeqIds[index - 1] >= id,
        ),
      ),
    ).toEqual([]);
  });

  it('never mutates the caller page', () => {
    const mutated = CASES.filter((c) => {
      const page = [...c.page];
      detectRollover({ pageSeqIds: page, cursor: c.cursor });
      return page.join(',') !== c.page.join(',');
    }).map((c) => c.label);

    expect(mutated).toEqual([]);
  });

  it('flags a hole exactly when overlap cannot be proved', () => {
    expect(
      offenders((c, r) => {
        const expected =
          c.cursor === null
            ? true
            : c.page.length > 0 && Math.min(...c.page) > c.cursor;
        return r.holeDetected === expected;
      }),
    ).toEqual([]);
  });

  it('never reports a hole while also having proved overlap', () => {
    // Restates the guarantee the poller depends on: if any id on the page is
    // at or below the cursor, we have continuity and must not drain.
    expect(
      offenders((c, r) => {
        const { cursor } = c;
        if (cursor === null) return true;
        const hasOverlap = c.page.some((id) => id <= cursor);
        return hasOverlap ? r.holeDetected === false : true;
      }),
    ).toEqual([]);
  });

  it('accepts a readonly input type without widening', () => {
    // Compile-time guard: RolloverInput must accept readonly arrays, since the
    // poller's page is readonly.
    const input: RolloverInput = {
      pageSeqIds: Object.freeze([3, 1, 2]),
      cursor: 1,
    };

    expect(detectRollover(input).newSeqIds).toEqual([3, 2]);
  });
});
