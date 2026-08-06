import type { UnparseableReason } from './enrichment.types';
import {
  decideParseFailure,
  MAX_PARSE_ATTEMPTS,
  PARSE_RETRY_BASE_MS,
  PARSE_RETRY_WINDOW_MS,
  RACEABLE_PARSE_FAILURES,
  describeParseRetry,
  type ParseRetryInput,
} from './parse-retry';

const NOW = new Date('2026-08-06T10:00:00.000Z');

/** A filing published one minute ago, whose bytes would not parse. */
const input = (overrides: Partial<ParseRetryInput> = {}): ParseRetryInput => ({
  reason: 'truncated-at-origin',
  disseminatedAt: new Date(NOW.getTime() - 60_000),
  now: NOW,
  parseAttempts: 1,
  maxParseAttempts: MAX_PARSE_ATTEMPTS,
  windowMs: PARSE_RETRY_WINDOW_MS,
  baseMs: PARSE_RETRY_BASE_MS,
  ...overrides,
});

describe('decideParseFailure', () => {
  describe('the states a re-fetch could plausibly move', () => {
    it.each([
      ['bytes cut off mid-transfer', 'truncated-at-origin'],
      [
        'bytes that end where a PDF should and still will not parse',
        'unreadable-pdf',
      ],
    ] as const)('retries %s on a young filing', (_label, reason) => {
      expect(decideParseFailure(input({ reason })).kind).toBe('retry');
    });

    it.each([
      ['a ZIP', 'not-a-pdf'],
      ['a missing url', 'no-attachment'],
      ['a url off the archive host', 'untrusted-host'],
      ['a document over the download cap', 'oversized'],
      ['a raster scan', 'no-text-layer'],
      ['a document the exchange does not hold', 'not-found'],
      ['a request the exchange refused', 'rejected'],
    ] as const)(
      'never retries %s, however young the filing',
      (_label, reason: UnparseableReason) => {
        expect(
          decideParseFailure(
            input({ reason, disseminatedAt: NOW, parseAttempts: 1 }),
          ),
        ).toEqual({ kind: 'terminal', reason });
      },
    );

    it('keeps the raceable set to the two states about bytes in flight', () => {
      // Pinned against literals rather than against the set itself, so widening
      // the set is a decision this test reports rather than one it follows.
      expect([...RACEABLE_PARSE_FAILURES].sort()).toEqual([
        'truncated-at-origin',
        'unreadable-pdf',
      ]);
    });
  });

  describe('the age window', () => {
    it.each([
      ['seconds old', 5_000, 'retry'],
      ['a minute old', 60_000, 'retry'],
      ['half an hour old', 1_800_000, 'retry'],
      ['fifty-six minutes old', 3_360_000, 'terminal'],
      ['exactly one hour old', PARSE_RETRY_WINDOW_MS, 'terminal'],
      ['a day old', 86_400_000, 'terminal'],
    ] as const)('is %s: %s', (_label, ageMs, kind) => {
      expect(
        decideParseFailure(
          input({ disseminatedAt: new Date(NOW.getTime() - ageMs) }),
        ).kind,
      ).toBe(kind);
    });

    it('measures the window from the exchange clock, not from the attempt', () => {
      // A worker that was down for a day and then started must not treat a
      // day-old filing as fresh merely because this is its first look at it.
      const dayOld = new Date(NOW.getTime() - 86_400_000);
      expect(
        decideParseFailure(input({ disseminatedAt: dayOld, parseAttempts: 1 }))
          .kind,
      ).toBe('terminal');
    });

    it('is terminal when the clock cannot be read at all', () => {
      // An unreadable timestamp yields NaN, and `NaN >= windowMs` is false — so
      // a bare window comparison would call every such filing young and retry it
      // forever. Non-finite is checked explicitly.
      expect(
        decideParseFailure(input({ disseminatedAt: new Date('not a date') })),
      ).toEqual({ kind: 'terminal', reason: 'truncated-at-origin' });
    });

    it('retries a filing stamped in the future rather than losing it', () => {
      // Exchange clock skew makes the age negative, which is inside the window.
      // Retrying costs a request; the alternative discards a filing for a
      // timestamp the exchange got wrong.
      expect(
        decideParseFailure(
          input({ disseminatedAt: new Date(NOW.getTime() + 30_000) }),
        ).kind,
      ).toBe('retry');
    });
  });

  describe('the attempt budget', () => {
    it.each([
      [1, 'retry'],
      [2, 'retry'],
      [3, 'terminal'],
      [4, 'terminal'],
    ] as const)('parse attempt %d is %s', (parseAttempts, kind) => {
      expect(decideParseFailure(input({ parseAttempts })).kind).toBe(kind);
    });

    it('is three attempts', () => {
      expect(MAX_PARSE_ATTEMPTS).toBe(3);
    });

    it('gives up on the budget even inside the window', () => {
      expect(
        decideParseFailure(
          input({ parseAttempts: MAX_PARSE_ATTEMPTS, disseminatedAt: NOW }),
        ),
      ).toEqual({ kind: 'terminal', reason: 'truncated-at-origin' });
    });
  });

  describe('the backoff', () => {
    it.each([
      [1, PARSE_RETRY_BASE_MS],
      [2, PARSE_RETRY_BASE_MS * 2],
    ])('waits %dx base before parse attempt %d', (parseAttempts, expected) => {
      const decision = decideParseFailure(input({ parseAttempts }));
      expect(decision.kind).toBe('retry');
      if (decision.kind !== 'retry') throw new Error('expected a retry');
      expect(decision.nextAttemptAt.getTime()).toBe(NOW.getTime() + expected);
    });

    it('is five minutes, doubling', () => {
      expect(PARSE_RETRY_BASE_MS).toBe(300_000);
    });

    it('never schedules a retry the window would refuse on arrival', () => {
      // 58 minutes old with a 5-minute wait lands at 63 minutes, past the hour.
      // Scheduling it would spend an archive request to reach a verdict already
      // known here.
      const decision = decideParseFailure(
        input({ disseminatedAt: new Date(NOW.getTime() - 3_480_000) }),
      );
      expect(decision).toEqual({
        kind: 'terminal',
        reason: 'truncated-at-origin',
      });
    });

    it('schedules a retry that lands inside the window', () => {
      const decision = decideParseFailure(
        input({ disseminatedAt: new Date(NOW.getTime() - 3_000_000) }),
      );
      expect(decision.kind).toBe('retry');
      if (decision.kind !== 'retry') throw new Error('expected a retry');
      const landsAtAge =
        decision.nextAttemptAt.getTime() - (NOW.getTime() - 3_000_000);
      expect(landsAtAge).toBeLessThan(PARSE_RETRY_WINDOW_MS);
    });

    it('does not shift the delay through 32-bit bitwise arithmetic', () => {
      // `1 << 32` is 1 in JavaScript, not 4,294,967,296 — the shift count wraps
      // at 32. A shifted backoff would therefore COLLAPSE back to the base delay
      // at exactly the attempt counts a long outage produces.
      const decision = decideParseFailure(
        input({
          parseAttempts: 33,
          maxParseAttempts: 100,
          windowMs: Number.MAX_SAFE_INTEGER,
        }),
      );
      expect(decision.kind).toBe('retry');
      if (decision.kind !== 'retry') throw new Error('expected a retry');
      expect(decision.nextAttemptAt.getTime() - NOW.getTime()).toBe(
        PARSE_RETRY_BASE_MS * Math.pow(2, 32),
      );
      expect(PARSE_RETRY_BASE_MS * Math.pow(2, 32)).not.toBe(
        PARSE_RETRY_BASE_MS * (1 << 32),
      );
    });
  });

  describe('the constants', () => {
    it('is a one-hour window', () => {
      expect(PARSE_RETRY_WINDOW_MS).toBe(3_600_000);
    });

    it('leaves the backfill case untouched', () => {
      // The terminal state exists for documents NSE genuinely stores truncated,
      // which the backfill tool fetches days after publication. Every one of
      // them is outside the window on its FIRST attempt and retries zero times.
      for (const reason of RACEABLE_PARSE_FAILURES) {
        expect(
          decideParseFailure(
            input({
              reason,
              parseAttempts: 1,
              disseminatedAt: new Date(NOW.getTime() - 3 * 86_400_000),
            }),
          ),
        ).toEqual({ kind: 'terminal', reason });
      }
    });

    it('carries the observed reason on a retry, so the operator sees it', () => {
      const decision = decideParseFailure(input({ reason: 'unreadable-pdf' }));
      expect(decision.kind).toBe('retry');
      if (decision.kind !== 'retry') throw new Error('expected a retry');
      expect(decision.reason).toBe('unreadable-pdf');
    });
  });
});

describe('describeParseRetry', () => {
  it('names the reason and quotes what the parser said', () => {
    expect(describeParseRetry('truncated-at-origin', 'Invalid PDF structure')).toBe(
      'truncated-at-origin: Invalid PDF structure',
    );
  });

  it('states the reason alone when there is no detail to quote', () => {
    expect(describeParseRetry('unreadable-pdf', null)).toBe('unreadable-pdf');
  });

  it('bounds and de-fangs the parser message', () => {
    const forged = 'x'.repeat(400) + '\nINFO fake log line';
    const described = describeParseRetry('truncated-at-origin', forged);
    expect(described).not.toContain('\n');
    expect(described.length).toBeLessThan(80);
  });
});
