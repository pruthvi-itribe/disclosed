import type { Filing } from '@app/filings';

/**
 * IST is UTC+05:30 year-round; India observes no daylight saving.
 *
 * DUPLICATION, ACCEPTED DELIBERATELY: `libs/filings` carries the same constant
 * and the same offset arithmetic in its date modules. Sharing it would mean
 * `libs/notify` importing `libs/filings` for a formatting detail, which is a
 * worse coupling than one duplicated constant. Flagged for consolidation into a
 * neutral module if a third consumer appears.
 */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

const pad = (n: number): string => String(n).padStart(2, '0');

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
  return `${pad(ist.getUTCHours())}:${pad(ist.getUTCMinutes())}:${pad(ist.getUTCSeconds())} IST`;
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
export function formatFilingAlert(filing: Filing): string {
  const lines = [
    `${escapeHtml(filing.symbol.toUpperCase())} — ${escapeHtml(
      filing.category.toUpperCase(),
    )}`,
    '',
    escapeHtml(filing.summary),
    '',
    toIstClock(filing.disseminatedAt),
  ];

  if (filing.attachmentUrl) {
    lines.push(`Source: ${escapeHtml(filing.attachmentUrl)}`);
  }

  return lines.join('\n');
}

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
