/**
 * The reader-facing vocabulary, ported verbatim from the server fragments.
 * `vocab-mirror.spec.ts` compares every entry against the fragment it came
 * from, so a rewording there fails here instead of leaving two vocabularies
 * for one thing on one product.
 *
 * Maps rather than object literals: several keys arrive from the database,
 * and a plain object's prototype makes 'constructor' a key too.
 */

/**
 * The movement the DOCUMENT printed, one glyph each. There is deliberately
 * no entry for 'unrated': three-quarters of claims are unrated, an explicit
 * badge on three-quarters of a feed is noise, and the absence of a mark
 * already means what it means — the filing printed no direction beside a
 * figure. A missing key draws nothing, which is the same thing.
 *
 * NO COLOUR ON THE MARK, ever. Red and green ARE a view about the company,
 * and the collection says the view would be wrong: 13 of the 45 marked
 * decreases are falling bad loans, debt, borrowing costs or emissions —
 * ESAF's gross NPA down from 7.5% to 5.4% is a triangle pointing down and is
 * the best news in that filing.
 */
export const DIRECTION_GLYPH: ReadonlyMap<string, string> = new Map([
  ['expansion', '▲'],
  ['contraction', '▼'],
  ['mixed', '◆'],
]);

/**
 * Spelled out for a reader who cannot see the glyph. The words describe the
 * DOCUMENT's act — it printed an increase — and never the company.
 */
export const DIRECTION_LABEL: ReadonlyMap<string, string> = new Map([
  ['expansion', 'increase printed'],
  ['contraction', 'decrease printed'],
  ['mixed', 'both printed'],
]);

/**
 * The tier badge's tooltip — the methodology, at the moment somebody wonders
 * how far to trust the line above it.
 */
export const TIER_TITLE: ReadonlyMap<string, string> = new Map([
  [
    'verified',
    'a span of the source document was matched character for character, and the period, basis, column and scale were checked against the document. The only tier allowed near an alert. Traceable end to end: the symbol and category are stored verbatim, the action phrase is a fixed lookup, and every amount and counterparty quotes the source document.',
  ],
  [
    'stated',
    "the exchange said this in its own summary line. Strong provenance, but nobody has checked it against the attached document. A refused amount degrades the headline to the exchange's own words, which is this tier.",
  ],
  [
    'labelled',
    'all that is known is what kind of filing this is. An honest floor, not a failure - an investor presentation nobody verified is still an investor presentation.',
  ],
]);

/**
 * The reader-facing name for each topic, and the same words the filter chips
 * use. A company page that called it "acquisition" beside a chip that says
 * "Deals" would be two names for one thing on one screen.
 */
export const TOPIC_LABEL: ReadonlyMap<string, string> = new Map([
  ['financial', 'Financials'],
  ['dividend', 'Dividends'],
  ['orders', 'Order wins'],
  ['acquisition', 'Deals'],
  ['capacity', 'Capacity'],
  ['product', 'Product'],
  ['ratings', 'Ratings'],
  ['governance', 'Governance'],
  ['other', 'Everything else'],
]);

/** Mirrors RESULTS_METRIC_LABEL on the server; the mirror spec holds them together. */
export const METRIC_LABEL: ReadonlyMap<string, string> = new Map([
  ['revenue', 'Revenue'],
  ['total-income', 'Total income'],
  ['net-profit', 'Net profit'],
  ['ebitda', 'EBITDA'],
  ['ebitda-margin', 'EBITDA margin'],
  ['eps', 'EPS'],
]);

/**
 * A document-printed figure: optional currency mark, digits, optional scale
 * word — pulled in WITH the number, never assembled. Direction words are
 * deliberately not matched: colouring "up" green is this page taking a view.
 *
 * Written ONCE with single escapes — this is a real module, so the doubled
 * backslashes the fragments needed (and the bold-fourth-letter bug they
 * shipped) die here. The mirror spec collapses the fragment's doubling
 * before comparing.
 */
export const FIGURE =
  /((?:₹|Rs\.?|INR|USD|\$)?\s?\d[\d,]*(?:\.\d+)?\s?(?:%|bps|crore|cr|lakh|lakhs|million|mn|billion|bn|MW|MTPA|x)?)/gi;
