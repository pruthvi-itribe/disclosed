/**
 * The reader-facing vocabulary, ported verbatim from the server fragments.
 * `vocab-mirror.spec.ts` compares every entry against the fragment it came
 * from, so a rewording there fails here instead of leaving two vocabularies
 * for one thing on one product.
 *
 * Maps rather than object literals: several keys arrive from the database,
 * and a plain object's prototype makes 'constructor' a key too.
 */

/*
 * THE MOVEMENT MARK IS NO LONGER A CHARACTER, so no glyph table stands
 * here. ▲ ▼ ◆ are the server fragment's, and this client draws the mark
 * instead — see ui/DirectionMark.tsx for why the triangles had to go (they
 * are the market's gain/loss costume on the one mark this product refuses
 * to colour) and what replaced them. The DIRECTIONS themselves are still a
 * shared vocabulary and vocab-mirror.spec.ts still holds the two clients to
 * the same three, in the labels below and in the drawings' keys.
 */

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

/**
 * The topic chips, value and label — the feed's filter row and the
 * notifications panel draw from this ONE list, so a topic cannot exist in
 * one and be unnameable in the other. Values are the server's CLAIM_TOPICS
 * members; '' is the feed's own "Everything" and is not a topic.
 */
export const TOPIC_CHIPS: readonly (readonly [string, string])[] = [
  ['', 'Everything'],
  ['financial', 'Financials'],
  ['dividend', 'Dividends'],
  ['orders', 'Order wins'],
  ['acquisition', 'Deals'],
  ['capacity', 'Capacity'],
  ['product', 'Product'],
  ['ratings', 'Ratings'],
];

/** A topic's reader-facing name; the value itself when the list lacks it. */
export const topicLabel = (topic: string): string => {
  const found = TOPIC_CHIPS.find(([value]) => value === topic);
  return found === undefined ? topic : found[1];
};
