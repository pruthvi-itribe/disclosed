import {
  formatBlindFeedAlert,
  formatDegradedAlert,
  formatDrainFailureAlert,
  formatSkippedRecordsAlert,
  formatFilingAlert,
  formatInsightAlert,
  formatWriteFailureAlert,
} from './alert-formatter';
import type { Filing } from '@app/filings';

const filing: Filing = {
  seqId: 106725630,
  symbol: 'PANACEABIO',
  isin: 'INE922B01023',
  companyName: 'Panacea Biotec Limited',
  industry: 'Pharmaceuticals',
  category: 'Bagging/Receiving of orders/contracts',
  summary:
    'Panacea Biotec Limited has informed the Exchange about receiving a letter ' +
    'of award for supply of bivalent oral polio vaccine to UNICEF.',
  attachmentUrl: 'https://nsearchives.nseindia.com/corporate/X.pdf',
  announcedAt: new Date('2026-08-05T04:58:17.000Z'),
  disseminatedAt: new Date('2026-08-05T04:58:18.000Z'),
  ingestedAt: new Date('2026-08-05T04:58:19.000Z'),
};

describe('formatFilingAlert', () => {
  it('leads with the symbol in caps, wire style', () => {
    expect(formatFilingAlert(filing).split('\n')[0]).toBe(
      'PANACEABIO — BAGGING/RECEIVING OF ORDERS/CONTRACTS',
    );
  });

  it('includes the summary verbatim, not paraphrased', () => {
    expect(formatFilingAlert(filing)).toContain(filing.summary);
  });

  it('renders the dissemination time in IST', () => {
    expect(formatFilingAlert(filing)).toContain('10:28:18 IST');
  });

  it('includes the source attachment link', () => {
    expect(formatFilingAlert(filing)).toContain(filing.attachmentUrl as string);
  });

  it('omits the source line when there is no attachment', () => {
    const output = formatFilingAlert({ ...filing, attachmentUrl: null });

    expect(output).not.toContain('Source:');
  });

  it('escapes HTML so a filing cannot inject markup into the message', () => {
    const output = formatFilingAlert({
      ...filing,
      summary: 'Order <b>worth</b> & more',
    });

    expect(output).toContain('Order &lt;b&gt;worth&lt;/b&gt; &amp; more');
  });
});

/**
 * Escaping is a SECURITY CONTROL here, not cosmetics. The message goes out with
 * `parse_mode: 'HTML'`, and every interpolated value is exchange-controlled
 * text we never authored. Three distinct failure modes if it is skipped:
 *
 *   1. Injection — a summary containing `<a href="...">` becomes a real link in
 *      the user's client. The alert's whole value is that it is the exchange's
 *      words and nothing else; a clickable payload we did not write breaks that.
 *   2. Silent rewriting — Telegram resolves entities. A summary containing the
 *      literal text `&#8377;` renders as ₹, changing the exchange's words
 *      without anyone noticing. This is not hypothetical: NSE double-escapes,
 *      and the Task 2 mapper decodes exactly one pass, so 47 of 17,442 corpus
 *      summaries arrive here still carrying literal `&#8377;`-style text.
 *   3. Dropped alerts — Telegram rejects a message whose HTML does not parse
 *      (unclosed tag, invalid code point such as the real corpus value
 *      `&#1048991;`). The API answers 400 and the filing is never delivered.
 *      A formatting slip therefore costs a filing, not just its looks.
 */
describe('formatFilingAlert: HTML escaping', () => {
  const summarising = (summary: string): string =>
    formatFilingAlert({ ...filing, summary });

  const ESCAPE_CASES: ReadonlyArray<readonly [string, string, string]> = [
    ['a bare ampersand', 'Reliance & Sons', 'Reliance &amp; Sons'],
    ['a less-than', 'growth < 5 percent', 'growth &lt; 5 percent'],
    ['a greater-than', 'growth > 5 percent', 'growth &gt; 5 percent'],
    [
      'a full anchor tag with attributes',
      '<a href="https://evil.example/steal">Click here</a>',
      '&lt;a href="https://evil.example/steal"&gt;Click here&lt;/a&gt;',
    ],
    [
      'a bold tag pair',
      'Order <b>worth</b> more',
      'Order &lt;b&gt;worth&lt;/b&gt; more',
    ],
    [
      'a script tag',
      '<script>alert(1)</script>',
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    ],
    [
      'an entity-looking numeric reference',
      'plans &#8377;1000 crore capex',
      'plans &amp;#8377;1000 crore capex',
    ],
    [
      'an entity-looking named reference',
      'Metro &amp; Brands',
      'Metro &amp;amp; Brands',
    ],
    [
      'an out-of-range numeric reference Telegram would reject',
      'In&#1048991;ma&#1048991;on of re-appointment',
      'In&amp;#1048991;ma&amp;#1048991;on of re-appointment',
    ],
    [
      'all three characters in combination',
      '<b>M&M</b> beat & raised > guidance',
      '&lt;b&gt;M&amp;M&lt;/b&gt; beat &amp; raised &gt; guidance',
    ],
  ];

  it.each(ESCAPE_CASES)('escapes %s', (_label, summary, expected) => {
    expect(summarising(summary)).toContain(expected);
  });

  /**
   * Order of replacement is load-bearing and easy to get wrong. Escaping `<`
   * before `&` yields `&amp;lt;`, which renders to the user as the literal text
   * "&lt;" instead of "<". The ampersand must be replaced FIRST. Asserted with
   * `toContain` on the escaped form and `not.toContain` on the double-escaped
   * one, because only the pair distinguishes the two orders.
   */
  it('replaces the ampersand first, so escapes are not themselves escaped', () => {
    const output = summarising('a < b');

    expect(output).toContain('a &lt; b');
    expect(output).not.toContain('&amp;lt;');
  });

  it('does not double-escape its own output', () => {
    // Escaping twice would turn every "&" the exchange wrote into "&amp;amp;".
    const output = summarising('M&M');

    expect(output).toContain('M&amp;M');
    expect(output).not.toContain('M&amp;amp;M');
  });

  /**
   * The literal-ampersand case, spelled out because Task 2 makes it non-obvious.
   * The mapper decodes entities, so NSE's `M&amp;M` has ALREADY become the real
   * character `M&M` by the time it reaches this function. There is no entity
   * left to preserve — the raw `&` must be re-escaped for HTML parse mode, or
   * Telegram sees a stray ampersand. 1,158 of 17,442 corpus summaries contain a
   * literal `&` after mapping, so this is the common path, not the edge case.
   */
  it('escapes a literal ampersand left behind by the mapper decode', () => {
    expect(summarising('Mahindra & Mahindra Ltd')).toContain(
      'Mahindra &amp; Mahindra Ltd',
    );
  });

  it('leaves text with no special characters byte-for-byte unchanged', () => {
    // Escaping must not disturb the exchange's words when there is nothing to
    // escape — including the quotes and apostrophes NSE uses constantly.
    const plain =
      'Panacea Biotec Limited has informed the Exchange regarding \'Allotment of ESOP\' dated "August 05, 2026".';

    expect(summarising(plain)).toContain(plain);
  });
});

/**
 * The brief escaped `summary` and the degraded-alert error only. Every other
 * interpolated value is equally untrusted: `symbol` and `category` come
 * straight off the NSE payload (the Task 2 mapper passes `raw.symbol` and
 * `raw.desc` through without decoding), and `attachmentUrl` is an exchange-
 * supplied URL. Ten distinct corpus symbols carry a raw `&` — M&M, J&KBANK,
 * IL&FSENGG and friends, 94 records in a single month — so an unescaped symbol
 * is not a theoretical hole, it is a daily one.
 */
describe('formatFilingAlert: every interpolated field is escaped', () => {
  const REAL_AMPERSAND_SYMBOLS: readonly string[] = [
    'M&M',
    'M&MFIN',
    'J&KBANK',
    'IL&FSENGG',
    'ARE&M',
    'GVT&D',
    'GMRP&UI',
    'S&SPOWER',
    'IL&FSTRANS',
    'SURANAT&P',
  ];

  it.each(REAL_AMPERSAND_SYMBOLS)(
    'escapes the ampersand in symbol %s',
    (symbol) => {
      const output = formatFilingAlert({ ...filing, symbol });

      expect(output.split('\n')[0]).toBe(
        `${symbol.replace('&', '&amp;')} — BAGGING/RECEIVING OF ORDERS/CONTRACTS`,
      );
    },
  );

  /**
   * Uppercasing must happen BEFORE escaping. The other order yields `&AMP;`,
   * which is not the entity Telegram's parser accepts, so the message either
   * renders wrong or is rejected outright.
   */
  it('uppercases before escaping, never producing &AMP;', () => {
    const output = formatFilingAlert({ ...filing, symbol: 'm&m' });

    expect(output).toContain('M&amp;M');
    expect(output).not.toContain('&AMP;');
  });

  it('escapes markup injected through the symbol', () => {
    const output = formatFilingAlert({
      ...filing,
      symbol: '<b>FAKE</b>',
    });

    expect(output).toContain('&lt;B&gt;FAKE&lt;/B&gt;');
    expect(output).not.toContain('<b>');
    expect(output).not.toContain('<B>');
  });

  it('escapes the ampersand in a real NSE category', () => {
    // "Registrar & Share Transfer Agent Update" is a live category in the
    // 17,442-record corpus, not an invented example.
    const output = formatFilingAlert({
      ...filing,
      category: 'Registrar & Share Transfer Agent Update',
    });

    expect(output.split('\n')[0]).toBe(
      'PANACEABIO — REGISTRAR &amp; SHARE TRANSFER AGENT UPDATE',
    );
  });

  it('escapes markup injected through the category', () => {
    const output = formatFilingAlert({
      ...filing,
      category: 'Updates</b><a href="https://evil.example">tap</a>',
    });

    expect(output).not.toContain('<a href');
    expect(output).toContain('&lt;A HREF="HTTPS://EVIL.EXAMPLE"&gt;');
  });

  it('escapes the attachment url', () => {
    // NSE archive links are plain today, but the field is exchange-controlled
    // and a query string with an ampersand is the ordinary shape of a URL.
    const output = formatFilingAlert({
      ...filing,
      attachmentUrl: 'https://nsearchives.nseindia.com/c.pdf?a=1&b=2',
    });

    expect(output).toContain(
      'Source: https://nsearchives.nseindia.com/c.pdf?a=1&amp;b=2',
    );
  });

  it('escapes markup injected through the attachment url', () => {
    const output = formatFilingAlert({
      ...filing,
      attachmentUrl: 'https://x.example/a.pdf"><b>tap</b>',
    });

    expect(output).not.toContain('<b>');
    expect(output).toContain('&lt;b&gt;tap&lt;/b&gt;');
  });

  /**
   * The structural invariant, checked over the whole rendered message rather
   * than field by field: after formatting, the only `<` and `>` that may appear
   * are ones we emitted, and this format emits none. Any `&` must open one of
   * the three escapes. A future field added to the template without an
   * escapeHtml call fails here even if nobody remembers to write its test.
   */
  it('emits no raw markup anywhere when every field is hostile', () => {
    const output = formatFilingAlert({
      ...filing,
      symbol: 'M&M<script>',
      category: 'Updates & <b>more</b>',
      summary: '<a href="https://evil.example">Order & delivery</a>',
      attachmentUrl: 'https://x.example/a.pdf?x=1&y=<2>',
    });

    expect(output).not.toMatch(/[<>]/);
    // Every ampersand opens a well-formed escape; none is left bare.
    expect(output.match(/&(?!amp;|lt;|gt;)/g)).toBeNull();
  });
});

/**
 * The clock is the one number in the message a reader acts on: it tells them
 * how stale the news is. NSE publishes in IST and the host runs in UTC, so the
 * +05:30 conversion is the whole job. An off-by-one-hour bug would be invisible
 * in review and obvious in production.
 */
describe('formatFilingAlert: IST clock', () => {
  const clockFor = (iso: string): string =>
    formatFilingAlert({ ...filing, disseminatedAt: new Date(iso) }).split(
      '\n',
    )[4];

  const CLOCK_CASES: ReadonlyArray<readonly [string, string]> = [
    ['2026-08-05T04:58:18.000Z', '10:28:18 IST'],
    ['2026-08-05T00:00:00.000Z', '05:30:00 IST'],
    ['2026-08-05T03:45:00.000Z', '09:15:00 IST'],
    ['2026-08-05T10:00:00.000Z', '15:30:00 IST'],
    // 18:30 UTC is exactly midnight IST: the day boundary, and the value most
    // likely to expose a broken offset.
    ['2026-08-05T18:30:00.000Z', '00:00:00 IST'],
    ['2026-08-05T18:29:59.000Z', '23:59:59 IST'],
    ['2026-08-05T18:30:01.000Z', '00:00:01 IST'],
    // India observes no daylight saving, so a January instant converts by the
    // same +05:30 as an August one.
    ['2026-01-15T04:58:18.000Z', '10:28:18 IST'],
  ];

  it.each(CLOCK_CASES)('renders %s as %s', (iso, expected) => {
    expect(clockFor(iso)).toBe(expected);
  });

  it('zero-pads every component', () => {
    expect(clockFor('2026-08-05T03:33:03.000Z')).toBe('09:03:03 IST');
  });

  /**
   * Filings read back from Mongo or replayed from the JSONL corpus carry
   * `disseminatedAt` as an ISO STRING despite the type saying Date — the same
   * shape mismatch Task 8 pinned in alert-window. A bare `date.getTime()` would
   * throw here and take down the send. The `new Date(...)` re-wrap is what makes
   * both shapes behave identically.
   */
  it('tolerates a string disseminatedAt from storage', () => {
    const stored = {
      ...filing,
      disseminatedAt: '2026-08-05T04:58:18.000Z',
    } as unknown as Filing;

    expect(formatFilingAlert(stored)).toContain('10:28:18 IST');
    expect(formatFilingAlert(stored)).toBe(formatFilingAlert(filing));
  });

  it('reads disseminatedAt, never announcedAt or ingestedAt', () => {
    // disseminatedAt is the exchange's own clock and the only honest one to
    // print. announcedAt can lag it; ingestedAt is our wall time and is "now"
    // for every record of a cold-start drain.
    const output = formatFilingAlert({
      ...filing,
      announcedAt: new Date('2026-08-05T01:00:00.000Z'),
      disseminatedAt: new Date('2026-08-05T04:58:18.000Z'),
      ingestedAt: new Date('2026-08-05T09:00:00.000Z'),
    });

    expect(output).toContain('10:28:18 IST');
    expect(output).not.toContain('06:30:00 IST');
    expect(output).not.toContain('14:30:00 IST');
  });

  it('does not mutate the filing it is handed', () => {
    const subject: Filing = { ...filing };
    const before = subject.disseminatedAt.toISOString();

    formatFilingAlert(subject);

    expect(subject.disseminatedAt.toISOString()).toBe(before);
  });
});

/**
 * The wire convention itself: one atomic fact per line, symbol and category in
 * caps up top, the exchange's own words below, time and source last. A trader
 * parses this shape in about 200ms, and only because the shape never varies.
 */
describe('formatFilingAlert: wire structure', () => {
  it('lays the message out as headline, summary, time, source', () => {
    expect(formatFilingAlert(filing).split('\n')).toEqual([
      'PANACEABIO — BAGGING/RECEIVING OF ORDERS/CONTRACTS',
      '',
      filing.summary,
      '',
      '10:28:18 IST',
      `Source: ${filing.attachmentUrl}`,
    ]);
  });

  it('drops only the source line when the attachment is absent', () => {
    expect(
      formatFilingAlert({ ...filing, attachmentUrl: null }).split('\n'),
    ).toEqual([
      'PANACEABIO — BAGGING/RECEIVING OF ORDERS/CONTRACTS',
      '',
      filing.summary,
      '',
      '10:28:18 IST',
    ]);
  });

  it('omits the source line for an empty-string attachment url', () => {
    // The mapper normalises blank to null, but a record read back from storage
    // or built by a future adapter may carry ''. A "Source: " line with nothing
    // after it is worse than no line.
    const output = formatFilingAlert({ ...filing, attachmentUrl: '' });

    expect(output).not.toContain('Source:');
    expect(output.split('\n')).toHaveLength(5);
  });

  it('uppercases a lowercase symbol and category', () => {
    const output = formatFilingAlert({
      ...filing,
      symbol: 'panaceabio',
      category: 'bagging/receiving of orders/contracts',
    });

    expect(output.split('\n')[0]).toBe(
      'PANACEABIO — BAGGING/RECEIVING OF ORDERS/CONTRACTS',
    );
  });

  /**
   * The editorial discipline this task exists to enforce: relay, do not
   * interpret. No truncation, no summarising, no added adjective, no ticker
   * price, no "positive"/"negative" read. Anything beyond the exchange's own
   * words would be both untrustworthy and, in India, investment advice.
   */
  it('reproduces a long summary in full, never truncated', () => {
    const long = `${'The Company has informed the Exchange. '.repeat(40)}End.`;

    const output = formatFilingAlert({ ...filing, summary: long });

    expect(output).toContain(long);
  });

  it('preserves the exchange line breaks inside a summary', () => {
    const output = formatFilingAlert({
      ...filing,
      summary: 'Line one.\nLine two.',
    });

    expect(output).toContain('Line one.\nLine two.');
  });

  /**
   * RATCHET, not a regression test. The template contains none of these words
   * today and no mutation of the current code can make it contain them, so this
   * cannot fail against any implementation that exists — deliberately, like the
   * "no time-based behaviour" suite in the circuit breaker. Its job is to fail
   * the day someone adds a sentiment tag, a price, or a "target" line to the
   * template. In India that framing would make the alert investment advice, so
   * the guard is worth keeping even though it can only catch future code.
   */
  it('adds no interpretation, recommendation or advisory framing', () => {
    const output = formatFilingAlert(filing).toLowerCase();

    for (const word of [
      'buy',
      'sell',
      'bullish',
      'bearish',
      'positive',
      'negative',
      'recommend',
      'target',
      'advice',
    ]) {
      expect(output).not.toContain(word);
    }
  });

  it('renders an empty summary without collapsing the layout', () => {
    // The mapper yields '' when NSE sends no announcement text; the headline
    // and timestamp still carry the news, so the alert must still go out.
    const output = formatFilingAlert({ ...filing, summary: '' });

    expect(output.split('\n')[0]).toBe(
      'PANACEABIO — BAGGING/RECEIVING OF ORDERS/CONTRACTS',
    );
    expect(output).toContain('10:28:18 IST');
  });
});

describe('formatDegradedAlert', () => {
  it('states the failure count and the error', () => {
    const output = formatDegradedAlert(
      3,
      'Request failed with status code 403',
    );

    expect(output).toContain('INGEST DEGRADED');
    expect(output).toContain('3 consecutive');
    expect(output).toContain('403');
  });

  it('lays the operator alert out on its own fixed shape', () => {
    expect(
      formatDegradedAlert(3, 'Request failed with status code 403').split('\n'),
    ).toEqual([
      'INGEST DEGRADED',
      '',
      '3 consecutive poll failures.',
      'Last error: Request failed with status code 403',
    ]);
  });

  /**
   * The error text is an exception message, which routinely carries the
   * offending URL, a response body fragment or NSE's HTML error page. All of it
   * is remote-controlled, so it is escaped exactly like a summary. An
   * unescapable degraded alert is the worst possible one to lose: it is the
   * message that says the pipeline has gone blind.
   */
  const ERROR_CASES: ReadonlyArray<readonly [string, string, string]> = [
    [
      'an HTML error page fragment',
      '<html><body>Access Denied</body></html>',
      'Last error: &lt;html&gt;&lt;body&gt;Access Denied&lt;/body&gt;&lt;/html&gt;',
    ],
    [
      'a url with query parameters',
      'GET https://nseindia.com/api/x?from=1&to=2 failed',
      'Last error: GET https://nseindia.com/api/x?from=1&amp;to=2 failed',
    ],
    [
      'an entity-looking fragment',
      'body was &#8377;garbage',
      'Last error: body was &amp;#8377;garbage',
    ],
    [
      'all three characters together',
      'expected <200> & got 403',
      'Last error: expected &lt;200&gt; &amp; got 403',
    ],
  ];

  it.each(ERROR_CASES)(
    'escapes %s in the error text',
    (_label, raw, expected) => {
      expect(formatDegradedAlert(3, raw)).toContain(expected);
    },
  );

  it('emits no raw markup for a hostile error string', () => {
    const output = formatDegradedAlert(
      7,
      '<a href="https://evil.example">tap</a> & more',
    );

    expect(output).not.toMatch(/[<>]/);
    expect(output.match(/&(?!amp;|lt;|gt;)/g)).toBeNull();
  });

  it('reports the count it is given', () => {
    // The count is the breaker's failure tally and doubles as an outage
    // duration in polls, so it is printed as-is rather than clamped.
    expect(formatDegradedAlert(1, 'boom')).toContain('1 consecutive');
    expect(formatDegradedAlert(120, 'boom')).toContain('120 consecutive');
  });

  it('renders an empty error string without losing the alert', () => {
    const output = formatDegradedAlert(3, '');

    expect(output).toContain('INGEST DEGRADED');
    expect(output).toContain('3 consecutive poll failures.');
  });
});

/**
 * The second way the pipeline goes blind, and the harder one to notice: the
 * fetch succeeds, so the breaker stays healthy and the logs stay calm, but every
 * record on the page failed to map. `seq_id` is validated digits-only, so an
 * exchange-side id format change produces exactly this — a permanently silent
 * feed wearing the face of a slow evening.
 */
describe('formatBlindFeedAlert', () => {
  it('states how many records were rejected', () => {
    const output = formatBlindFeedAlert(20);

    expect(output).toContain('INGEST BLIND');
    expect(output).toContain('20');
  });

  it('lays the operator alert out on its own fixed shape', () => {
    expect(formatBlindFeedAlert(20).split('\n')).toEqual([
      'INGEST BLIND',
      '',
      'NSE returned 20 record(s) and every one was rejected as unmappable.',
      'Nothing can be ingested until the mapper matches the feed again; an id or',
      'field format change is the usual cause.',
    ]);
  });

  it('reports the count it is given', () => {
    expect(formatBlindFeedAlert(1)).toContain('1 record(s)');
    expect(formatBlindFeedAlert(500)).toContain('500 record(s)');
  });

  it('emits no raw markup', () => {
    const output = formatBlindFeedAlert(20);

    expect(output).not.toMatch(/[<>]/);
    expect(output.match(/&(?!amp;|lt;|gt;)/g)).toBeNull();
  });
});

/**
 * A write that threw is not a retryable no-op. Mongoose can put valid documents
 * in the collection before it reports a validation failure, so rows may be
 * persisted and never alerted — and a retry will not return them a second time,
 * because the unique index will reject them as already present.
 */
describe('formatWriteFailureAlert', () => {
  it('states the batch size and the error', () => {
    const output = formatWriteFailureAlert(12, 'connection timed out');

    expect(output).toContain('INGEST WRITE FAILED');
    expect(output).toContain('12');
    expect(output).toContain('connection timed out');
  });

  it('lays the operator alert out on its own fixed shape', () => {
    expect(
      formatWriteFailureAlert(12, 'connection timed out').split('\n'),
    ).toEqual([
      'INGEST WRITE FAILED',
      '',
      'A batch of 12 filing(s) could not be written.',
      'Rows may be stored WITHOUT having alerted; a retry will not re-return them.',
      'Last error: connection timed out',
    ]);
  });

  /**
   * The error text carries whatever the driver put in it — a document fragment,
   * a URI, an HTML proxy error — so it is escaped exactly like exchange text.
   */
  const WRITE_ERROR_CASES: ReadonlyArray<readonly [string, string, string]> = [
    [
      'a document fragment with angle brackets',
      'E11000 duplicate key on <filings>',
      'Last error: E11000 duplicate key on &lt;filings&gt;',
    ],
    [
      'a connection string with an ampersand',
      'mongodb://h/db?a=1&b=2 unreachable',
      'Last error: mongodb://h/db?a=1&amp;b=2 unreachable',
    ],
    ['an empty message', '', 'Last error: '],
  ];

  it.each(WRITE_ERROR_CASES)('escapes %s', (_label, raw, expected) => {
    expect(formatWriteFailureAlert(3, raw)).toContain(expected);
  });

  it('emits no raw markup for a hostile error string', () => {
    const output = formatWriteFailureAlert(
      7,
      '<a href="https://evil.example">tap</a> & more',
    );

    expect(output).not.toMatch(/[<>]/);
    expect(output.match(/&(?!amp;|lt;|gt;)/g)).toBeNull();
  });
});

/**
 * The most consequential silence of the four, and the least visible. The hot
 * fetch succeeded, so the breaker stays healthy and no filing is skipped — the
 * records inside the gap are simply never fetched. A drain that keeps failing
 * means the hole the whole no-loss guarantee exists to close is never closed.
 */
describe('formatSkippedRecordsAlert', () => {
  it('states how many were dropped, out of how many', () => {
    const output = formatSkippedRecordsAlert(4, 20);

    expect(output).toContain('INGEST RECORDS SKIPPED');
    expect(output).toContain('4 of 20');
  });

  it('lays the operator alert out on its own fixed shape', () => {
    expect(formatSkippedRecordsAlert(1, 20).split('\n')).toEqual([
      'INGEST RECORDS SKIPPED',
      '',
      '1 of 20 record(s) could not be mapped and were dropped.',
      'The rest were ingested, so nothing else will report this. A field or id',
      'format change is the usual cause; the scheduled drain re-offers the whole',
      'day, so fixing the mapper recovers them without a backfill.',
    ]);
  });

  it('says the rest were ingested, which is what makes it invisible', () => {
    // The distinguishing fact against INGEST BLIND: this page produced
    // filings, so the fetch, the breaker and the cursor all look healthy.
    expect(formatSkippedRecordsAlert(2, 20)).toContain(
      'The rest were ingested',
    );
  });

  it('carries nothing that needs escaping, because both inputs are counts', () => {
    const output = formatSkippedRecordsAlert(3, 20);

    expect(output).not.toContain('&');
    expect(output).not.toContain('<');
  });
});

describe('formatDrainFailureAlert', () => {
  it('states that the gap is still open, and why', () => {
    const output = formatDrainFailureAlert(
      'Request failed with status code 403',
    );

    expect(output).toContain('INGEST DRAIN FAILED');
    expect(output).toContain('403');
  });

  it('lays the operator alert out on its own fixed shape', () => {
    expect(
      formatDrainFailureAlert('Request failed with status code 403').split(
        '\n',
      ),
    ).toEqual([
      'INGEST DRAIN FAILED',
      '',
      'The page rolled over and the day re-pull failed, so the gap it would have',
      'closed is still open. Filings inside that gap have not been fetched.',
      'Last error: Request failed with status code 403',
    ]);
  });

  const DRAIN_ERROR_CASES: ReadonlyArray<readonly [string, string, string]> = [
    [
      'an HTML block page',
      '<html>Access Denied</html>',
      'Last error: &lt;html&gt;Access Denied&lt;/html&gt;',
    ],
    [
      'a date-range url with parameters',
      '/api/x?from_date=05-08-2026&to_date=05-08-2026',
      'Last error: /api/x?from_date=05-08-2026&amp;to_date=05-08-2026',
    ],
    ['an empty message', '', 'Last error: '],
  ];

  it.each(DRAIN_ERROR_CASES)('escapes %s', (_label, raw, expected) => {
    expect(formatDrainFailureAlert(raw)).toContain(expected);
  });

  it('emits no raw markup for a hostile error string', () => {
    const output = formatDrainFailureAlert(
      '<a href="https://evil.example">tap</a> & more',
    );

    expect(output).not.toMatch(/[<>]/);
    expect(output.match(/&(?!amp;|lt;|gt;)/g)).toBeNull();
  });
});

describe('the derived-context line on a filing alert', () => {
  const filing = {
    seqId: 1,
    symbol: 'PANACEABIO',
    isin: 'INE000000001',
    companyName: 'Panacea Biotec Limited',
    industry: null,
    category: 'Bagging/Receiving of orders/contracts',
    summary: 'Panacea Biotec Limited has informed the Exchange about an order',
    attachmentUrl: 'https://nsearchives.nseindia.com/corporate/a.pdf',
    announcedAt: new Date('2026-08-06T04:58:17.000Z'),
    disseminatedAt: new Date('2026-08-06T04:58:18.000Z'),
    ingestedAt: new Date('2026-08-06T04:58:19.000Z'),
  };

  it('is omitted entirely when there is none', () => {
    // The alert must be byte-identical to what it sent before derived context
    // existed, or every filing without a context line changes shape on the wire.
    expect(formatFilingAlert(filing)).toBe(formatFilingAlert(filing, null));
  });

  it.each([[''], ['   '], ['\n\t ']])(
    'omits a blank context line "%s" rather than emitting an empty line',
    (contextLine) => {
      expect(formatFilingAlert(filing, contextLine)).toBe(
        formatFilingAlert(filing, null),
      );
    },
  );

  it('places it under the symbol line, above the exchange words', () => {
    const lines = formatFilingAlert(
      filing,
      '3rd order for PANACEABIO in 30 days',
    ).split('\n');

    expect(lines[0]).toBe('PANACEABIO — BAGGING/RECEIVING OF ORDERS/CONTRACTS');
    expect(lines[2]).toBe('3rd order for PANACEABIO in 30 days');
    expect(lines[4]).toBe(filing.summary);
  });

  it('escapes it, because the symbol is interpolated into it', () => {
    // Real symbols contain ampersands: M&M, J&KBANK, IL&FSENGG.
    const message = formatFilingAlert(filing, '2nd order for M&M in 30 days');
    expect(message).toContain('M&amp;M');
    expect(message).not.toContain('M&M ');
  });
});

describe('formatInsightAlert', () => {
  const filing = {
    seqId: 1,
    symbol: 'RAILTEL',
    isin: 'INE000000001',
    companyName: 'RailTel Corporation of India Limited',
    industry: null,
    category: 'Bagging/Receiving of orders/contracts',
    summary: 'RailTel has informed the Exchange about an order',
    attachmentUrl: 'https://nsearchives.nseindia.com/corporate/a.pdf',
    announcedAt: new Date('2026-08-06T04:58:17.000Z'),
    disseminatedAt: new Date('2026-08-06T04:58:18.000Z'),
    ingestedAt: new Date('2026-08-06T04:58:19.000Z'),
  };

  it('leads with the headline and carries the source link', () => {
    const message = formatInsightAlert(filing, {
      headline: 'RAILTEL BAGS ORDER ₹18.54 cr from South Western Railway',
      claimLine: null,
      contextLine: '3rd order for RAILTEL in 30 days',
      evidence: 'Rs. 18,53,66,820',
    });

    expect(message.split('\n')[0]).toBe(
      'RAILTEL BAGS ORDER ₹18.54 cr from South Western Railway',
    );
    expect(message).toContain('3rd order for RAILTEL in 30 days');
    expect(message).toContain('Stated as "Rs. 18,53,66,820" in the filing');
    expect(message).toContain('10:28:18 IST');
    expect(message).toContain(`Source: ${filing.attachmentUrl}`);
  });

  it.each([
    ['no context line', null, 'Rs. 5 crore'],
    ['no evidence', '3rd order for RAILTEL in 30 days', null],
    ['neither', null, null],
    ['a blank context line', '  ', 'Rs. 5 crore'],
    ['blank evidence', '3rd order', '   '],
  ])(
    'omits %s rather than emitting an empty line',
    (_label, context, evidence) => {
      const message = formatInsightAlert(filing, {
        headline: 'RAILTEL BAGS ORDER ₹5 cr',
        claimLine: null,
        contextLine: context,
        evidence,
      });
      expect(message).not.toMatch(/\n\n\n/);
      expect(message.split('\n')[0]).toBe('RAILTEL BAGS ORDER ₹5 cr');
    },
  );

  it('collapses evidence broken across lines by the PDF text layer', () => {
    // Real extraction: `Rs\n.\n847\nCrore`.
    const message = formatInsightAlert(filing, {
      headline: 'BEL BAGS ORDER ₹847 cr',
      claimLine: null,
      contextLine: null,
      evidence: 'Rs\n.\n847\nCrore',
    });
    expect(message).toContain('Stated as "Rs . 847 Crore" in the filing');
  });

  it('bounds a pathological evidence string', () => {
    // Telegram discards a message over 4,096 characters outright rather than
    // truncating it, so an unbounded quote loses the whole alert.
    const message = formatInsightAlert(filing, {
      headline: 'X BAGS ORDER ₹1 cr',
      claimLine: null,
      contextLine: null,
      evidence: 'A'.repeat(5000),
    });
    expect(message.length).toBeLessThan(1000);
  });

  it('escapes the headline, the context and the evidence', () => {
    const message = formatInsightAlert(filing, {
      headline: 'M&M BAGS ORDER ₹5 cr from <b>Acme</b> Limited',
      claimLine: null,
      contextLine: '2nd order for M&M in 30 days',
      evidence: 'Rs. 5 crore <script>',
    });

    expect(message).toContain('M&amp;M');
    expect(message).toContain('&lt;b&gt;Acme&lt;/b&gt;');
    expect(message).toContain('&lt;script&gt;');
    expect(message).not.toContain('<b>');
  });

  it('omits the source line for a filing with no attachment', () => {
    const message = formatInsightAlert(
      { ...filing, attachmentUrl: null },
      {
        headline: 'RAILTEL BAGS ORDER ₹5 cr',
        claimLine: null,
        contextLine: null,
        evidence: null,
      },
    );
    expect(message).not.toContain('Source:');
  });

  describe('the claim line', () => {
    const claims = 'SWIGGY: TARGETS ₹10,000 CR ADJ EBITDA BY FY31';

    it('leads the message when there is no headline to lead it', () => {
      // The whole point of the claim work: most of what a filings desk wants to
      // read carries no figure, so a follow-up gated on the amount alone stays
      // silent on exactly the filings this pipeline was built to stop missing.
      const message = formatInsightAlert(filing, {
        headline: null,
        claimLine: claims,
        contextLine: null,
        evidence: null,
      });

      expect(message.split('\n')[0]).toBe(claims);
    });

    it('follows the headline when both exist', () => {
      const message = formatInsightAlert(filing, {
        headline: 'RAILTEL BAGS ORDER ₹5 cr',
        claimLine: claims,
        contextLine: null,
        evidence: null,
      });

      const lines = message.split('\n').filter((line) => line.length > 0);
      expect(lines[0]).toBe('RAILTEL BAGS ORDER ₹5 cr');
      expect(lines[1]).toBe(claims);
    });

    it('escapes it like every other exchange-derived string', () => {
      const message = formatInsightAlert(filing, {
        headline: null,
        claimLine: 'M&M: JOINS <b>ACME</b> ALLIANCE',
        contextLine: null,
        evidence: null,
      });

      expect(message).toContain('M&amp;M');
      expect(message).toContain('&lt;b&gt;ACME&lt;/b&gt;');
      expect(message).not.toContain('<b>');
    });

    it.each([[null], ['   ']])(
      'emits no blank line for a claim line of %s',
      (claimLine) => {
        const message = formatInsightAlert(filing, {
          headline: 'RAILTEL BAGS ORDER ₹5 cr',
          claimLine,
          contextLine: null,
          evidence: null,
        });
        expect(message).not.toMatch(/\n\n\n/);
        expect(message.split('\n')[0]).toBe('RAILTEL BAGS ORDER ₹5 cr');
      },
    );
  });
});
