import { IST_OFFSET_MS, pad2 } from '@app/common';
import type { Filing } from '@app/filings';

/**
 * Renders the wall-clock time in IST.
 *
 * The `new Date(date)` re-wrap is not redundant: a Filing read back from Mongo
 * or replayed from the JSONL corpus carries `disseminatedAt` as an ISO string
 * despite the type saying Date. Calling `.getTime()` on that directly throws
 * and would take down the send.
 */
const toIstClock = (date: Date): string => {
  const ist = new Date(new Date(date).getTime() + IST_OFFSET_MS);
  return `${pad2(ist.getUTCHours())}:${pad2(ist.getUTCMinutes())}:${pad2(ist.getUTCSeconds())} IST`;
};

/**
 * Escapes the three characters Telegram's HTML parse mode treats as markup.
 *
 * This is a security control, not cosmetics. Everything interpolated into an
 * alert is exchange-controlled text, and the message is sent with
 * `parse_mode: 'HTML'`. Skipping it costs three separate ways: markup we did
 * not author renders in the user's client; entity-looking text is silently
 * rewritten, changing the exchange's own words; and HTML that does not parse
 * makes Telegram reject the message outright, losing the filing.
 *
 * The ampersand MUST be replaced first. Any other order escapes the escapes,
 * turning `<` into the literal text `&lt;` rather than a rendered `<`.
 */
const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Wire-convention format: symbol and category in caps on line one, then the
 * exchange's own words verbatim. Nothing is paraphrased or interpreted — that
 * is what makes the alert trustworthy and keeps it clear of advisory framing.
 *
 * EVERY interpolated value is escaped, not just the summary. `symbol` and
 * `category` reach us as NSE wrote them (the Task 2 mapper decodes entities in
 * `summary` only), and real symbols contain ampersands — M&M, J&KBANK,
 * IL&FSENGG. `attachmentUrl` is exchange-supplied too. Uppercasing happens
 * before escaping: the other order would emit `&AMP;`, which is not the entity
 * Telegram accepts.
 */
export function formatFilingAlert(
  filing: Filing,
  contextLine: string | null = null,
): string {
  const lines = [
    `${escapeHtml(filing.symbol.toUpperCase())} — ${escapeHtml(
      filing.category.toUpperCase(),
    )}`,
  ];

  // The derived-context line, when one could be computed. It is composed from
  // counts over stored filings and carries no exchange text, but it is escaped
  // like everything else: the symbol is interpolated into it, and real symbols
  // contain ampersands.
  if (contextLine !== null && contextLine.trim().length > 0) {
    lines.push('', escapeHtml(contextLine));
  }

  lines.push(
    '',
    escapeHtml(filing.summary),
    '',
    toIstClock(filing.disseminatedAt),
  );

  if (filing.attachmentUrl) {
    lines.push(`Source: ${escapeHtml(filing.attachmentUrl)}`);
  }

  return lines.join('\n');
}

/** Everything the follow-up may carry. Every field is already verified. */
export interface InsightAlert {
  /** The composed headline, when a verified AMOUNT produced one. */
  readonly headline: string | null;
  /**
   * The wire line of notable claims, when the document yielded any.
   *
   * A SECOND, INDEPENDENT REASON TO SEND. Most of what a filings desk wants to
   * read carries no figure at all — guidance, an expansion, a partnership — so
   * a follow-up gated on the amount alone would stay silent on exactly the
   * filings this pipeline was built to stop missing.
   */
  readonly claimLine: string | null;
  readonly contextLine: string | null;
  /** The document's own words for the figure. */
  readonly evidence: string | null;
}

/**
 * The follow-up a background read of the source PDF earns.
 *
 * A SECOND MESSAGE, NOT A REPLACEMENT, and that is the design rather than a
 * limitation. The first alert has to leave within the poller's two-second
 * budget, which rules out fetching a document whose p99 is 3.6 seconds and
 * which fails outright for one filing in thirty. So the wire says what it knows
 * immediately, and says more when it knows more — which is exactly how a squawk
 * desk works.
 *
 * IT IS ONLY EVER SENT WHEN THERE IS SOMETHING VERIFIED TO ADD — a figure the
 * extractor traced to a substring of the source, or a claim whose sentence was
 * found verbatim in it. A filing that yields neither produces no second message
 * at all, because there is nothing to add: the first alert already carried the
 * exchange's own words. That gate is what keeps the volume honest.
 *
 * EVERY FIELD IS ESCAPED. The headline is composed from a symbol and a
 * counterparty name that both originate outside this process; the claim line is
 * composed from sentences lifted out of a PDF; and `evidence` is raw text from
 * the same place — the least trustworthy strings in the system, since they are
 * whatever a filer's template happened to contain.
 */
export function formatInsightAlert(
  filing: Filing,
  insight: InsightAlert,
): string {
  const { headline, claimLine, contextLine, evidence } = insight;

  // The headline leads when there is one, because it states the size of the
  // event; the claim line leads when there is not, because then it is the only
  // thing said. Both appear when both exist, and neither is ever paraphrased.
  const lines: string[] = [];
  if (headline !== null && headline.trim().length > 0) {
    lines.push(escapeHtml(headline));
  }
  if (claimLine !== null && claimLine.trim().length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push(escapeHtml(claimLine));
  }

  if (contextLine !== null && contextLine.trim().length > 0) {
    lines.push('', escapeHtml(contextLine));
  }

  // The document's own words for the figure. This is what makes the number
  // checkable from inside the message: a reader who doubts "₹18.54 cr" can see
  // that the filing said "Rs. 18,53,66,820" and open the source to confirm it.
  // Collapsed to one line because PDF extraction routinely breaks a figure
  // across three ("Rs\n.\n847\nCrore").
  if (evidence !== null && evidence.trim().length > 0) {
    lines.push(
      '',
      `Stated as "${escapeHtml(oneLine(evidence))}" in the filing`,
    );
  }

  lines.push('', toIstClock(filing.disseminatedAt));

  if (filing.attachmentUrl) {
    lines.push(`Source: ${escapeHtml(filing.attachmentUrl)}`);
  }

  return lines.join('\n');
}

/**
 * Collapses whitespace and bounds the length.
 *
 * Both halves matter for PDF-derived text: the newlines would break the
 * one-fact-per-line convention, and the bound stops a pathological extraction
 * from pushing the message past Telegram's 4,096-character limit, which
 * discards the whole alert rather than truncating it.
 */
const EVIDENCE_MAX_CHARS = 160;
const oneLine = (text: string): string =>
  text.replace(/\s+/g, ' ').trim().slice(0, EVIDENCE_MAX_CHARS);

/**
 * The operator alert for a blind poller. `lastError` is an exception message,
 * which routinely carries a URL, a response fragment or NSE's HTML error page,
 * so it is escaped exactly like exchange text. This is the worst message to
 * lose to a parse failure: it is the one that says the pipeline has gone dark.
 */
export function formatDegradedAlert(
  consecutiveFailures: number,
  lastError: string,
): string {
  return [
    'INGEST DEGRADED',
    '',
    `${consecutiveFailures} consecutive poll failures.`,
    `Last error: ${escapeHtml(lastError)}`,
  ].join('\n');
}

/**
 * The operator alert for a feed that answers but yields nothing usable.
 *
 * This is the blindness the degraded alert cannot see: the request succeeded,
 * so the circuit breaker stays healthy, yet every record on the page failed to
 * map. `seq_id` is validated digits-only, so an exchange-side id format change
 * lands here — and without a message it presents as a quiet market for as long
 * as nobody reads the logs.
 *
 * `received` is a count, so there is nothing to escape; it is stated plainly
 * because "how many did it throw away" is the first question an operator asks.
 */
export function formatBlindFeedAlert(received: number): string {
  return [
    'INGEST BLIND',
    '',
    `NSE returned ${received} record(s) and every one was rejected as unmappable.`,
    'Nothing can be ingested until the mapper matches the feed again; an id or',
    'field format change is the usual cause.',
  ].join('\n');
}

/**
 * The operator alert for a page the mapper only PARTIALLY understood.
 *
 * The quiet sibling of the blind-feed alert, and the one that was missing. A
 * page where every record is rejected is loud by construction — nothing is
 * ingested at all. A page where nineteen of twenty map is indistinguishable
 * from a healthy poll in every signal the system produces: the fetch
 * succeeded, filings arrived, the breaker is clean, the cursor moves, and the
 * one record that was dropped exists only in a warn line nobody is reading.
 *
 * Both counts are numbers, so there is nothing to escape. The recovery path is
 * stated because it is not obvious: the scheduled drain re-pulls the whole IST
 * day every few minutes, so a mapper fix picks these records up on the next
 * sweep without a backfill — but only if someone is told to make the fix.
 */
export function formatSkippedRecordsAlert(
  skipped: number,
  received: number,
): string {
  return [
    'INGEST RECORDS SKIPPED',
    '',
    `${skipped} of ${received} record(s) could not be mapped and were dropped.`,
    'The rest were ingested, so nothing else will report this. A field or id',
    'format change is the usual cause; the scheduled drain re-offers the whole',
    'day, so fixing the mapper recovers them without a backfill.',
  ].join('\n');
}

/**
 * The operator alert for a day re-pull that failed.
 *
 * The most consequential of these messages and the least visible without one.
 * The hot fetch succeeded, so the circuit breaker stays healthy; the cursor is
 * held, so no filing is skipped and nothing downstream misbehaves. The records
 * inside the gap are simply never fetched, and a drain that keeps failing means
 * the hole the entire no-loss guarantee exists to close is never closed.
 *
 * `lastError` is exchange-supplied — routinely NSE's HTML block page or the
 * date-range URL with its parameters — so it is escaped like any other.
 */
export function formatDrainFailureAlert(lastError: string): string {
  return [
    'INGEST DRAIN FAILED',
    '',
    'The page rolled over and the day re-pull failed, so the gap it would have',
    'closed is still open. Filings inside that gap have not been fetched.',
    `Last error: ${escapeHtml(lastError)}`,
  ].join('\n');
}

/**
 * The operator alert for a batch the database refused.
 *
 * Deliberately louder than a retry notice, because a failed write is not a
 * retryable no-op: mongoose can put valid documents in the collection before it
 * reports a validation failure, so rows may be persisted and never alerted —
 * and the unique index will reject them on a retry, so they never come back.
 * `lastError` is driver text carrying document fragments and URIs, so it is
 * escaped exactly like exchange text.
 */
export function formatWriteFailureAlert(
  batchSize: number,
  lastError: string,
): string {
  return [
    'INGEST WRITE FAILED',
    '',
    `A batch of ${batchSize} filing(s) could not be written.`,
    'Rows may be stored WITHOUT having alerted; a retry will not re-return them.',
    `Last error: ${escapeHtml(lastError)}`,
  ].join('\n');
}
