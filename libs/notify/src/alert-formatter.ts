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
