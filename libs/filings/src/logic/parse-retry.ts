import type { UnparseableReason } from './enrichment.types';
import { safeEcho } from './safe-echo';

/**
 * Whether a PDF that would not parse deserves one more look.
 *
 * ================================================================
 * THE FILING THIS MODULE EXISTS FOR
 * ================================================================
 *
 * `LICHSGFIN` seqId 106727908 was fetched minutes after NSE published it,
 * arrived without a `%%EOF`, was recorded `truncated-at-origin`, and — because
 * that state was terminal — was never looked at again. A later re-fetch of the
 * SAME url parsed cleanly and yielded 75,528 characters. The document had not
 * been truncated at all; this pipeline had raced NSE's own upload and then
 * written the loss down as a permanent property of the document.
 *
 * That is a data-loss path in a project whose first principle is that no filing
 * is lost, and it cannot be fixed by relabelling: the bytes really did lack a
 * terminator, so `parseFailureReason` was right about what it saw. What was
 * wrong was the *finality*. The same bytes are permanent evidence about a
 * document that finished uploading days ago and merely a snapshot of one that
 * is still being written.
 *
 * ================================================================
 * WHAT SEPARATES THE TWO
 * ================================================================
 *
 * Age, and nothing else available at this layer. A parse failure on a filing
 * published four minutes ago might be an upload in progress; the identical
 * failure on a filing published last Tuesday cannot be. So a parse failure is
 * retryable while the filing is YOUNG and terminal thereafter, and the states
 * that are properties of the URL or the container rather than of the bytes in
 * flight stay terminal at every age (see `RACEABLE_PARSE_FAILURES`).
 *
 * ================================================================
 * THE THREE NUMBERS, AND WHY THEY ARE THESE NUMBERS
 * ================================================================
 *
 * **A one-hour window** (`PARSE_RETRY_WINDOW_MS`). The one observed race
 * resolved within minutes. An hour is an order of magnitude beyond that, and —
 * more importantly — it is short enough that the case the terminal state was
 * built for is untouched: NSE's genuinely truncated archive documents are
 * fetched by the backfill tool days after publication, fall outside the window
 * on their first attempt, and retry zero times. The window is measured from
 * `disseminatedAt`, the exchange's own clock, not from when this pipeline first
 * saw the filing — a worker that was down for a day must not treat a day-old
 * filing as fresh the moment it starts.
 *
 * **Three parse attempts** (`MAX_PARSE_ATTEMPTS`). When the race resolves it
 * resolves on the first retry; the third exists only so that one unlucky retry
 * landing mid-rewrite does not lose the filing anyway. The budget is separate
 * from the transient-failure budget on purpose: a timeout and a half-written
 * PDF are different failures with different remedies, and sharing one counter
 * would let three timeouts silently spend the race allowance.
 *
 * **A five-minute base, doubling** (`PARSE_RETRY_BASE_MS`). An immediate retry
 * would re-read the same partial upload and burn an archive request to reach
 * the same verdict. Five minutes is longer than any NSE write observed in the
 * spike. Doubling keeps the third attempt inside the window without a third
 * constant.
 *
 * Cost, measured rather than assumed: 6 parse failures in 1,050 live filings is
 * 0.6%, so ~4 a day at 700 filings/day, and at most 2 extra archive requests
 * each — under 10 requests a day against a host measured comfortable at 2.5 per
 * second. The pipeline pays that to stop losing filings permanently.
 */

/**
 * The parse failures a re-fetch could plausibly resolve.
 *
 * Both are statements about the BYTES THAT ARRIVED, which is exactly what a
 * partially-written upload changes. Everything else in `UnparseableReason` is a
 * property that a second fetch cannot move:
 *
 *   - `not-a-pdf` / `no-attachment` / `untrusted-host` — decided from the URL
 *     before a single byte is fetched. A retry re-reads the same URL.
 *   - `oversized` — a partial upload is SMALLER, never larger, so a document
 *     over the cap was never a race.
 *   - `no-text-layer` — the document parsed. The characters-per-page
 *     distribution is bimodal with a gap two orders of magnitude wide, so this
 *     is a raster scan and OCR is the only remedy.
 *   - `not-found` / `rejected` — the exchange answered about the request.
 */
export const RACEABLE_PARSE_FAILURES: ReadonlySet<UnparseableReason> = new Set([
  'truncated-at-origin',
  'unreadable-pdf',
]);

/** How long after dissemination a parse failure may still be a race. */
export const PARSE_RETRY_WINDOW_MS = 3_600_000;

/** Parse attempts a filing gets before the failure becomes terminal. */
export const MAX_PARSE_ATTEMPTS = 3;

/** First parse-retry delay. Doubles per attempt. */
export const PARSE_RETRY_BASE_MS = 300_000;

export type ParseDisposition =
  /** Look again at `nextAttemptAt`; the filing stays claimable until then. */
  | {
      readonly kind: 'retry';
      readonly nextAttemptAt: Date;
      /** What the bytes looked like this time, for the operator to read. */
      readonly reason: UnparseableReason;
    }
  /** Never again. The filing is recorded `unparseable` with this reason. */
  | { readonly kind: 'terminal'; readonly reason: UnparseableReason };

export interface ParseRetryInput {
  readonly reason: UnparseableReason;
  /** The exchange's clock. The window is measured from here, not from `now`. */
  readonly disseminatedAt: Date;
  readonly now: Date;
  /** Parse failures so far INCLUDING the one being decided. 1-based. */
  readonly parseAttempts: number;
  readonly maxParseAttempts: number;
  readonly windowMs: number;
  readonly baseMs: number;
}

/**
 * Decides whether a parse failure is terminal.
 *
 * DEFAULTS TO TERMINAL, which is the opposite of `classifyFetchFailure` and
 * deliberately so. A transient fetch failure defaults to retry because the cost
 * of an unnecessary retry is one request; a parse failure defaults to terminal
 * because the population it governs is dominated by documents NSE genuinely
 * stores truncated, and retrying those forever is an unbounded loop aimed at the
 * exchange. Every clause below has to argue its way OUT of terminal.
 *
 * Never throws for a bad clock: a `disseminatedAt` this pipeline could not read
 * produces a non-finite age, which fails the window test and lands terminal —
 * the same answer as an old filing, which is the safe one.
 */
export function decideParseFailure(input: ParseRetryInput): ParseDisposition {
  const {
    reason,
    disseminatedAt,
    now,
    parseAttempts,
    maxParseAttempts,
    windowMs,
    baseMs,
  } = input;

  const terminal: ParseDisposition = { kind: 'terminal', reason };

  if (!RACEABLE_PARSE_FAILURES.has(reason)) return terminal;
  if (parseAttempts >= maxParseAttempts) return terminal;

  // `new Date(...)` re-wraps because a filing read back from Mongo carries
  // `disseminatedAt` as whatever the driver handed over, and calling
  // `.getTime()` on a string throws inside the worker's write path.
  const age = now.getTime() - new Date(disseminatedAt).getTime();
  if (!Number.isFinite(age) || age >= windowMs) return terminal;

  // 1-based, so the first retry waits exactly `baseMs`. Computed in floating
  // point and never by shifting, for the reason `nextAttemptDelayMs` gives:
  // `1 << 40` is 256 in JavaScript's 32-bit bitwise arithmetic.
  const delay = baseMs * Math.pow(2, Math.max(0, parseAttempts - 1));

  // A retry scheduled past the window's end would be claimed, re-fail, and be
  // ruled terminal by the window test — one wasted archive request to reach an
  // answer already known here. So the window closes the case now instead.
  if (age + delay >= windowMs) return terminal;

  return {
    kind: 'retry',
    nextAttemptAt: new Date(now.getTime() + delay),
    reason,
  };
}

/**
 * What a provisional parse failure leaves behind for a human to read.
 *
 * A retried filing goes back to `pending` with `unparseableReason` null — it is
 * not an unreadable document yet, and the dashboard groups by that field — so
 * this string is the only record of what the bytes looked like. It is composed
 * here rather than inline in the worker so that both shapes are exercised: a
 * verdict reached with a parser message, and one reached without.
 *
 * `safeEcho` is not decoration. The detail is a third-party parser's exception
 * message heading for a stored record and a log line, and a newline in it forges
 * a second log line indistinguishable from a real one.
 */
export const describeParseRetry = (
  reason: UnparseableReason,
  detail: string | null,
): string => (detail === null ? reason : `${reason}: ${safeEcho(detail)}`);
