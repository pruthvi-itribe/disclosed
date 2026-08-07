import type { UnparseableReason } from './enrichment.types';
import { readableWindowFraction } from './text-quality';

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
 *
 * 404 IS IN HERE, AND IT IS THE ONE ENTRY THAT LOOKS WRONG. The announcement
 * feed and the archive host are not the same system, and the feed wins the
 * race: NSE publishes the row, and the PDF lands on `nsearchives` seconds to
 * minutes later. A 404 asked in that gap is the archive saying "not yet".
 *
 * This was measured, not reasoned about. BRITANNIA's investor presentation
 * (seqId 106730232) was disseminated at 01:42:54Z, answered 404 on the single
 * attempt the previous policy allowed, and was written off as `unparseable`
 * for good. The same URL answered 200 with 4,439,475 bytes when asked again —
 * a whole investor presentation discarded because we asked once, too early.
 *
 * The cost of being wrong in this direction is bounded and the cost of being
 * wrong in the other is not: an unnecessary retry spends at most the attempt
 * budget and then lands in `failed`, where it is visible and requeueable,
 * while a premature terminal state deletes a filing from the product silently.
 */
export const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([
  401, 403, 404, 408, 425, 429,
]);

/**
 * Statuses that mean the exchange does not hold the document.
 *
 * 410 alone. Gone is the origin stating the document EXISTED and will not come
 * back, which is a different and much stronger claim than 404's "I do not have
 * this" — strong enough to act on without spending the attempt budget to hear
 * it five times.
 */
export const NOT_FOUND_STATUSES: ReadonlySet<number> = new Set([410]);

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

/**
 * Share of a document that must read as text before its layer is trusted.
 *
 * 0.50 — more than half the document must be unreadable before the pixels are
 * re-read — and the number is placed by a measured distribution rather than by
 * taste. Over 849 live filings from every category EXCEPT newspaper
 * publications, `readableWindowFraction` puts 831 at 0.95-1.00 and 12 more at
 * 0.90-0.95. Only THREE sit below this bound, and all three were read by hand:
 *
 *     0.188  ORBTEXP   post-buyback announcement   a newspaper page
 *     0.194  WESTLIFE  general update              a newspaper page
 *     0.375  NUVOCO    general update              CORRUPT, and not a newspaper
 *
 * NUVOCO's AGM notice (seqId 106731971) is the one that matters, and it is the
 * reason this comment no longer claims the band below 0.90 is empty — an
 * earlier measurement over 522 documents did not contain it and said so. Its
 * covering letter is clean English for three windows and then every remaining
 * window reads `6XE1RWLFHRIWKH$QQXDO*HQHUDO0HHWLQJ` — "Sub: Notice of the
 * Annual General Meeting" at the same +3 displacement as MSWIL. It stores zero
 * claims today.
 *
 * So the corrupt-layer class is NOT a newspaper phenomenon that happens to be
 * miscategorised, which is what the first reading of the data suggested. It is
 * a property of the font a filer's software embedded, and an ordinary AGM
 * notice can carry it. That makes the bound load-bearing on its own account
 * rather than a proxy for a category.
 *
 * NEWSPAPER PUBLICATIONS THEMSELVES ARE A CONTINUUM, from 0.05 to 1.00 with no
 * gap anywhere — 26 below 0.20, 44 between 0.20 and 0.50, 111 between 0.50 and
 * 0.90, 227 above — because a newspaper page legitimately carries a Marathi AGM
 * notice and another company's SARFAESI notice beside the results table.
 *
 * SO THE EXACT POSITION OF THIS BOUND IS A COST DECISION, and it is only the
 * newspapers that make it one: they are where moving it up or down changes the
 * count, and 70 of the 73 documents it catches are theirs. Raising it to 0.80
 * would pull in another 111 OCR passes to catch nothing the three ordinary
 * filings above did not already give up. 0.50 is the cheap end.
 *
 * The escalation was verified to pay before the bound was chosen. SUMMITSEC's
 * newspaper publication (seqId 106727130) reads 0.514 through `pdf-parse` and
 * 1.000 once OCR is forced past its legacy-font pages, and the re-read carries
 * MORE of what a results statement needs — 9 basis markers against 7 — not
 * fewer.
 */
export const MIN_READABLE_WINDOW_FRACTION = 0.5;

/**
 * True when a document HAS a text layer and that layer is not text.
 *
 * The half of "is this readable" that a character count cannot answer. MSWIL's
 * newspaper disclosure (seqId 106726228) carries 9,226 non-space characters,
 * clearing `MIN_TEXT_LAYER_CHARS` by 92x, and past the covering letter every
 * one of them is displaced three code points — `3XUVXDQW WR 5HJXODWLRQ` for
 * "Pursuant to Regulation". `hasUsableTextLayer` says yes, the router sends it
 * to `pdf-parse`, and the filing is stored unreadable.
 *
 * GUARDED BY `hasUsableTextLayer`, deliberately, so the two verdicts can never
 * both fire. A raster scan has no layer to call corrupt, and `no-text-layer`
 * and "the layer is garbage" are different facts with different remedies —
 * only the second one needs OCR forced past something.
 */
export const hasCorruptTextLayer = (text: string): boolean =>
  hasUsableTextLayer(text) &&
  readableWindowFraction(text) < MIN_READABLE_WINDOW_FRACTION;

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
