import {
  classifyFetchFailure,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_RETRY_BASE_MS,
  DEFAULT_RETRY_MAX_MS,
  hasUsableTextLayer,
  MIN_TEXT_LAYER_CHARS,
  nextAttemptDelayMs,
  NOT_FOUND_STATUSES,
  parseFailureReason,
  RETRYABLE_STATUSES,
} from './enrichment-policy';
import {
  isTerminal,
  PENDING_ENRICHMENT,
  TERMINAL_STATES,
} from './enrichment.types';

describe('classifyFetchFailure', () => {
  it.each([
    ['a timeout or reset socket', null],
    ['a rate limit', 429],
    ['an Akamai refusal', 403],
    ['an expired session', 401],
    ['a server-side timeout', 408],
    ['a gateway error', 502],
    ['a service outage', 503],
    ['an origin timeout', 504],
    ['a bare 500', 500],
  ])('retries %s', (_label, status) => {
    expect(classifyFetchFailure(status)).toEqual({ kind: 'retry' });
  });

  it.each([
    ['a missing document', 404],
    ['a removed document', 410],
  ])('gives up on %s as not-found', (_label, status) => {
    expect(classifyFetchFailure(status)).toEqual({
      kind: 'terminal',
      reason: 'not-found',
    });
  });

  it.each([
    ['a bad request', 400],
    ['a forbidden method', 405],
    ['an unsupported media type', 415],
    ['a teapot', 418],
    ['a legal takedown', 451],
  ])('gives up on %s as rejected', (_label, status) => {
    expect(classifyFetchFailure(status)).toEqual({
      kind: 'terminal',
      reason: 'rejected',
    });
  });

  it.each([[200], [204], [301], [302]])(
    'retries an unusable %d response',
    (status) => {
      // A block page served as 200 is transient in practice.
      expect(classifyFetchFailure(status)).toEqual({ kind: 'retry' });
    },
  );

  it('never classifies a retryable status as terminal', () => {
    for (const status of RETRYABLE_STATUSES) {
      expect(classifyFetchFailure(status).kind).toBe('retry');
    }
  });

  it('never classifies a not-found status as retryable', () => {
    for (const status of NOT_FOUND_STATUSES) {
      expect(classifyFetchFailure(status).kind).toBe('terminal');
    }
  });

  it('has no status in both sets', () => {
    for (const status of NOT_FOUND_STATUSES) {
      expect(RETRYABLE_STATUSES.has(status)).toBe(false);
    }
  });
});

describe('parseFailureReason', () => {
  it('is always terminal, because the missing bytes were never sent', () => {
    expect(parseFailureReason()).toBe('truncated-at-origin');
  });
});

describe('hasUsableTextLayer', () => {
  it.each([
    ['an empty document', '', false],
    ['whitespace only', '   \n\n\t  ', false],
    ['one extracted character', 'x', false],
    ['a page of real text', 'a'.repeat(MIN_TEXT_LAYER_CHARS), true],
    ['one character short', 'a'.repeat(MIN_TEXT_LAYER_CHARS - 1), false],
  ])('reads %s as %s', (_label, text, expected) => {
    expect(hasUsableTextLayer(text)).toBe(expected);
  });

  it('does not count whitespace towards the threshold', () => {
    // A raster scan whose extractor emitted only form-feeds and newlines has no
    // text layer, however many bytes it produced.
    const padded = ' \n'.repeat(MIN_TEXT_LAYER_CHARS * 5);
    expect(hasUsableTextLayer(padded)).toBe(false);
    expect(padded.length).toBeGreaterThan(MIN_TEXT_LAYER_CHARS);
  });
});

describe('nextAttemptDelayMs', () => {
  const budget = {
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
    baseMs: DEFAULT_RETRY_BASE_MS,
    maxMs: DEFAULT_RETRY_MAX_MS,
  };

  it.each([
    [1, DEFAULT_RETRY_BASE_MS],
    [2, DEFAULT_RETRY_BASE_MS * 2],
    [3, DEFAULT_RETRY_BASE_MS * 4],
    [4, DEFAULT_RETRY_BASE_MS * 8],
  ])('waits %d attempts in: %d ms', (attempts, expected) => {
    expect(nextAttemptDelayMs({ ...budget, attempts })).toBe(expected);
  });

  it('returns null once the attempt budget is spent', () => {
    expect(
      nextAttemptDelayMs({ ...budget, attempts: DEFAULT_MAX_ATTEMPTS }),
    ).toBeNull();
    expect(
      nextAttemptDelayMs({ ...budget, attempts: DEFAULT_MAX_ATTEMPTS + 7 }),
    ).toBeNull();
  });

  it('caps the delay rather than growing without bound', () => {
    const delay = nextAttemptDelayMs({
      attempts: 20,
      maxAttempts: 100,
      baseMs: 1000,
      maxMs: 60_000,
    });
    expect(delay).toBe(60_000);
  });

  it('does not shorten the backoff at large attempt counts', () => {
    // Computed with Math.pow and clamped, never with `<<`: `1 << 40` is 256 in
    // JavaScript's 32-bit bitwise arithmetic, which would make the fortieth
    // attempt wait less than the tenth.
    const tenth = nextAttemptDelayMs({
      attempts: 10,
      maxAttempts: 100,
      baseMs: 1,
      maxMs: Number.MAX_SAFE_INTEGER,
    });
    const fortieth = nextAttemptDelayMs({
      attempts: 40,
      maxAttempts: 100,
      baseMs: 1,
      maxMs: Number.MAX_SAFE_INTEGER,
    });
    expect(fortieth as number).toBeGreaterThan(tenth as number);
  });

  it('is monotonically non-decreasing across the whole budget', () => {
    let previous = 0;
    for (let attempts = 1; attempts < DEFAULT_MAX_ATTEMPTS; attempts += 1) {
      const delay = nextAttemptDelayMs({ ...budget, attempts }) as number;
      expect(delay).toBeGreaterThanOrEqual(previous);
      previous = delay;
    }
  });
});

describe('the enrichment state machine', () => {
  it.each([
    ['enriched', true],
    ['unparseable', true],
    ['failed', true],
    ['pending', false],
  ] as const)('treats %s as terminal: %s', (state, expected) => {
    expect(isTerminal(state)).toBe(expected);
  });

  it('never treats pending as terminal', () => {
    expect(TERMINAL_STATES.has('pending')).toBe(false);
  });

  it('starts every filing pending with nothing claimed', () => {
    expect(PENDING_ENRICHMENT.state).toBe('pending');
    expect(PENDING_ENRICHMENT.attempts).toBe(0);
    for (const [key, value] of Object.entries(PENDING_ENRICHMENT)) {
      if (key === 'state' || key === 'attempts') continue;
      expect(value).toBeNull();
    }
  });
});
