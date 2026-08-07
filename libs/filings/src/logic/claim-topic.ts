/**
 * What a verified claim is ABOUT, decided from the claim's own words.
 *
 * ================================================================
 * WHY THIS IS SEPARATE FROM `ClaimKind`
 * ================================================================
 *
 * `kind` is what the extractor was asked for and describes the SHAPE of a
 * statement — is it forward-looking, is it an approval, is it a partnership.
 * That vocabulary was measured and found to be one bucket wearing six labels:
 * across 2,334 stored claims, `operational` holds 1,581 of them, 67.7%. A
 * dividend declaration, a quarterly revenue figure and a new plant all land
 * there, so a reader cannot filter for any of the three.
 *
 * TOPIC is the other axis: what the statement is about. The two are genuinely
 * different questions — "Q1 revenue up 20.7% YoY" is operational in shape and
 * financial in topic, and a reader looking for results wants the second.
 *
 * ================================================================
 * WHY IT IS DETERMINISTIC AND NOT A MODEL CALL
 * ================================================================
 *
 * The claim text is already stored, so classifying it needs no document, no
 * fetch and no extractor. Rules are free, reproducible and testable, and a
 * model call per claim would cost roughly $2 to reclassify a collection this
 * size and would have to be paid again for every future change of mind.
 *
 * The stakes also differ from extraction in a way that matters. A wrong topic
 * FILES a claim badly; it cannot publish anything false, because the claim
 * itself was already matched character-for-character against the source
 * document by the time this runs. That asymmetry is what makes rules an honest
 * choice here and not a shortcut — the verbatim gate is upstream and unaffected.
 *
 * ================================================================
 * THE ORDER OF THE RULES IS THE POLICY
 * ================================================================
 *
 * First match wins, so the list reads most-specific first. `dividend` precedes
 * `financial` because "dividend of ₹1.50 per equity share" contains neither
 * more nor less arithmetic than a revenue line and a reader hunting payouts
 * would lose it in eight hundred results. `orders` precedes `financial` for the
 * same reason: "Q1 order bookings INR 11.4 billion, down 30% YoY" is an order
 * statement that happens to carry a figure.
 *
 * Measured over all 2,334 stored claims with these exact rules:
 *
 *   financial   748  32.0%      product      66   2.8%
 *   capacity    171   7.3%      orders       56   2.4%
 *   acquisition 153   6.6%      ratings      48   2.1%
 *   dividend    146   6.3%      governance   27   1.2%
 *   other       919  39.4%
 *
 * `other` at 39.4% is NOT a failure of the rules and must not be tuned away.
 * Reading it: employee stock option grants, IEPF transfers, exercise prices,
 * cash balances. Those are true, verified, and close to worthless on a wire —
 * which makes `other` the most useful topic on this list, because it is the one
 * an alert path can mute.
 */

export type ClaimTopic =
  /** A payout to shareholders: dividend, buyback, bonus issue. */
  | 'dividend'
  /** A reported financial figure: revenue, profit, margin, EPS. */
  | 'financial'
  /** An order won, an order book, a contract award. */
  | 'orders'
  /** An acquisition, a stake, a merger, a subsidiary, a joint venture. */
  | 'acquisition'
  /** New or commissioned capacity: a plant, a facility, megawatts, tonnage. */
  | 'capacity'
  /** A product launched, or a regulator's approval to sell one. */
  | 'product'
  /** A credit rating action. */
  | 'ratings'
  /** Meeting mechanics: an AGM, a record date, a ballot, an appointment. */
  | 'governance'
  /** Everything else. Deliberately large, and the one a wire can mute. */
  | 'other';

export const CLAIM_TOPICS: readonly ClaimTopic[] = [
  'dividend',
  'financial',
  'orders',
  'acquisition',
  'capacity',
  'product',
  'ratings',
  'governance',
  'other',
];

/**
 * The rules, most specific first.
 *
 * Each pattern is anchored on vocabulary a filing actually uses, taken from
 * reading the stored claims rather than from imagining what a filing says.
 */
const RULES: readonly (readonly [ClaimTopic, RegExp])[] = [
  // Before `financial`: a payout carries figures like any other line, and a
  // reader hunting dividends would lose them among 748 revenue statements.
  ['dividend', /\b(dividend|payout|buy-?back|bonus issue)\b/i],
  // Before `financial`: "Q1 order bookings INR 11.4 billion, down 30% YoY" is
  // an order statement that happens to be quantified.
  [
    'orders',
    /\b(order book|orderbook|order intake|order bookings?|order win|bagged|letter of intent|LOI)\b|\b(secured|received|won|awarded)\b[^.]{0,40}\border/i,
  ],
  [
    'ratings',
    /\b(credit rating|rating (?:action|upgrade|downgrade)|CRISIL|ICRA|CARE Ratings|India Ratings|outlook (?:revised|stable|positive|negative))\b/i,
  ],
  [
    'acquisition',
    /\b(acquisitions?|acquired|acquiring|merger|amalgamation|divest|stake|subsidiar\w+|joint venture|\bJV\b)\b/i,
  ],
  [
    'financial',
    /\b(revenue|EBITDA|PAT|profit|income|margin|turnover|earnings|EPS|net worth|cash flow|topline|bottom ?line)\b/i,
  ],
  [
    'capacity',
    /\b(capacity|plant|facility|commissioned?|commissioning|MTPA|MW|greenfield|brownfield|expansion|debottleneck\w*)\b/i,
  ],
  [
    'product',
    /\b(launch\w*|approvals?|approved|FDA|EMA|ANDA|patent|certificat\w+|registration|clearance)\b/i,
  ],
  [
    'governance',
    /\b(AGM|annual general meeting|record date|board meeting|postal ballot|e-?voting|resignation|resigned|appointed|appointment)\b/i,
  ],
];

/**
 * The topic of one claim.
 *
 * NEVER THROWS and always answers. An unclassifiable claim is `other`, which is
 * a real answer about a real claim rather than an error — 39.4% of the live
 * collection lands there and most of it deserves to.
 */
export function claimTopic(text: string): ClaimTopic {
  if (typeof text !== 'string' || text.trim() === '') return 'other';
  for (const [topic, pattern] of RULES) {
    if (pattern.test(text)) return topic;
  }
  return 'other';
}
