import type { UnparseableReason } from './enrichment.types';

/**
 * When to give up, when to try again, and how long to wait.
 *
 * Pure decisions, kept out of the worker so they can be exhaustively tested
 * without a network, a clock or a database. The worker's job is to do what this
 * module says; this module's job is to never say "retry" about something that
 * cannot change.
 */

/**
 * Non-whitespace characters below which a PDF is treated as having no text
 * layer at all.
 *
 * Measured, and the measurement is unusually kind: across 58 parseable sampled
 * PDFs the characters-per-page distribution is starkly bimodal — one document
 * at 0.5 chars/page, then NOTHING until 559 chars/page. There is no "scanned
 * page with a header" middle ground, so this threshold sits inside a gap two
 * orders of magnitude wide rather than on a slope.
 */
export const MIN_TEXT_LAYER_CHARS = 100;

/** Attempts a filing gets before a retryable failure becomes terminal. */
export const DEFAULT_MAX_ATTEMPTS = 5;

/** First backoff step. Doubles per attempt. */
export const DEFAULT_RETRY_BASE_MS = 60_000;

/** Ceiling on the backoff, so a long outage does not push a filing past a day. */
export const DEFAULT_RETRY_MAX_MS = 3_600_000;

/**
 * HTTP statuses that mean "not now" rather than "not ever".
 *
 * 403 and 429 are in here because NSE's archive host answers both when it is
 * unhappy about request rate, and both clear on their own. 408 is a server-side
 * timeout. Everything else in the 4xx range is a statement about the request,
 * which will not improve by being repeated.
 */
export const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([
  401, 403, 408, 425, 429,
]);

/** Statuses that mean the exchange does not hold the document. */
export const NOT_FOUND_STATUSES: ReadonlySet<number> = new Set([404, 410]);

export type FailureVerdict =
  /** Try again later. */
  | { readonly kind: 'retry' }
  /** Never again, for this reason. */
  | { readonly kind: 'terminal'; readonly reason: UnparseableReason };

/**
 * Classifies a failed fetch.
 *
 * @param status the HTTP status, or null when the request never got one — a
 * timeout, a DNS failure, a reset socket. Those are network events and are
 * always retryable.
 *
 * DEFAULTS TO RETRY, deliberately, and that is the safe direction here: an
 * over-eager terminal state discards a filing's amount permanently and
 * silently, while an over-eager retry costs a bounded number of requests and
 * then lands in `failed` anyway. The attempt budget is what makes that safe.
 */
export function classifyFetchFailure(status: number | null): FailureVerdict {
  if (status === null) return { kind: 'retry' };
  if (NOT_FOUND_STATUSES.has(status)) {
    return { kind: 'terminal', reason: 'not-found' };
  }
  if (RETRYABLE_STATUSES.has(status)) return { kind: 'retry' };
  if (status >= 500) return { kind: 'retry' };
  if (status >= 400) return { kind: 'terminal', reason: 'rejected' };
  // A 2xx or 3xx reaching a failure path means the response was unusable for
  // some other reason — an HTML block page served as 200, for instance. That
  // is transient in practice.
  return { kind: 'retry' };
}

/**
 * How far from the end of a PDF the `%%EOF` marker may sit.
 *
 * ISO 32000 requires it in the last 1,024 bytes and every reader scans exactly
 * that window; 2,048 tolerates a writer that appended a newline or two without
 * reaching far enough back to find the marker of an EARLIER incremental save,
 * which would make a genuinely truncated file look complete.
 */
export const EOF_SCAN_BYTES = 2_048;

const EOF_MARKER = Buffer.from('%%EOF', 'latin1');

/**
 * Why a PDF that failed to parse failed, MEASURED rather than assumed.
 *
 * Both reasons are terminal — the same bytes will fail the same way forever —
 * so this changes no behaviour. It changes what the record SAYS, and that is
 * worth the twenty lines: `truncated-at-origin` is a claim about NSE's storage
 * tier, and filing every parse failure under it would turn an operational
 * measurement into a guess. The tell is unambiguous and cheap: a PDF that was
 * cut off mid-transfer has no `%%EOF` at its end, because the bytes carrying it
 * were never sent.
 *
 * Measured on the live collection: six documents failed to parse and all six
 * end in binary body data with no terminator anywhere near the end — a 2.5 MB
 * GODREJAGRO board outcome whose last `%%EOF` is at byte 502, from its
 * linearisation stub. NSE's own `content-length` matches each short body and
 * re-fetching returns identical bytes.
 */
export function parseFailureReason(body: Uint8Array): UnparseableReason {
  const tail = Buffer.from(
    body.subarray(Math.max(0, body.length - EOF_SCAN_BYTES)),
  );
  return tail.includes(EOF_MARKER) ? 'unreadable-pdf' : 'truncated-at-origin';
}

/** True when extracted text is substantial enough to be a text layer. */
export const hasUsableTextLayer = (text: string): boolean =>
  text.replace(/\s+/g, '').length >= MIN_TEXT_LAYER_CHARS;

export interface BackoffInput {
  /** Attempts already made, including the one that just failed. 1-based. */
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly baseMs: number;
  readonly maxMs: number;
}

/**
 * The delay before the next attempt, or null when the budget is spent.
 *
 * Null is the caller's signal to move the filing to `failed`. Returning a delay
 * and letting the caller count would put the attempt budget in two places.
 */
export function nextAttemptDelayMs(input: BackoffInput): number | null {
  const { attempts, maxAttempts, baseMs, maxMs } = input;
  if (attempts >= maxAttempts) return null;

  // `attempts` is 1-based, so the first retry waits exactly `baseMs`.
  const exponent = Math.max(0, attempts - 1);
  // Computed in floating point and clamped, never by shifting: `1 << 40` is 256
  // in JavaScript's 32-bit bitwise arithmetic, which would silently SHORTEN the
  // backoff at exactly the attempt counts a long outage produces.
  const delay = baseMs * Math.pow(2, exponent);
  return Math.min(delay, maxMs);
}
