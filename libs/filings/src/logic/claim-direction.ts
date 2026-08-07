/**
 * The movement a claim's own SOURCE SENTENCE printed, and the characters that
 * say so.
 *
 * ================================================================
 * WHY THIS READS THE SPAN AND NOT THE CLAIM
 * ================================================================
 *
 * `claim-topic.ts` files a claim from its `text`, because a wrong topic files a
 * true sentence badly and cannot publish anything false. A DIRECTION is not
 * like that. "Revenue up 20%" asserts something about the world, and a model
 * asked to compress a filing will assert one the document never made: measured
 * over the live collection, 82 of 3,461 stored claims (2.4%) carry a movement
 * word in the extractor's compressed `text` that the matched span does not
 * print, almost all of them a direction read off an unlabelled table row.
 *
 * So the tag is derived from the SPAN — the document's own bytes, already
 * matched character for character by `claim-span.ts` — and never from the
 * claim. That keeps the whole feature inside the verbatim gate: a mark on a
 * card means the document printed those words, and the card shows them.
 *
 * ================================================================
 * WHY A MAGNITUDE IS REQUIRED
 * ================================================================
 *
 * A direction word alone tags 30.2% of claims; a direction word plus a printed
 * `%`/`bps` tags 23.3%. The 6.9 points bought by the magnitude requirement are
 * the difference between BIOCON's "supports future growth" — aspiration, no
 * figure, refused — and CLEDUCATE's "grew 34.7%", which the document printed
 * and can be checked. The floor is not a failure: `unrated` is the honest
 * answer for the other three-quarters, exactly as `claim-topic.ts` keeps
 * `other` at 39.4% rather than tuning it away.
 *
 * ================================================================
 * WHAT THIS IS NOT
 * ================================================================
 *
 * NOT A SENTIMENT. `expansion` and `contraction` describe a FIGURE's movement.
 * Of the 45 contractions in the live collection, 13 (28.9%) are falling gross
 * NPA, net debt, borrowing cost, slippages or emissions — a decrease every
 * reader would call good news. `positive` and `negative` are therefore not in
 * this vocabulary, and nothing downstream may map this tag to either: the words
 * would be factually wrong on a quarter of the cases that matter most, not
 * merely cautious. `claim-advisory.ts` blocks them on the way out for the same
 * reason.
 *
 * NOT ARITHMETIC. Nothing here divides, converts, rounds or compares two
 * numbers. `results-line.ts` records what that costs: a competitor published an
 * EBITDA margin of 13.32% for APOLLOTYRE where the arithmetic gives 13.23%, a
 * figure the filing never printed, about a named listed company.
 */

export type ClaimDirection =
  /** The document printed an increase and the amount it increased by. */
  | 'expansion'
  /** The document printed a decrease and the amount it decreased by. */
  | 'contraction'
  /** The document printed both, in the same span. */
  | 'mixed'
  /** The document printed no checkable movement. The honest floor: 76.7%. */
  | 'unrated';

export const CLAIM_DIRECTIONS: readonly ClaimDirection[] = [
  'expansion',
  'contraction',
  'mixed',
  'unrated',
];

export interface DirectionReading {
  readonly direction: ClaimDirection;
  /**
   * The document's own characters that decided it — the direction word and the
   * magnitude, quoted contiguously from the whitespace-collapsed span. Rendered
   * in the card's `title`, so a mark is checkable by a reader who never leaves
   * the page. Empty string when `unrated`.
   *
   * Measured over the 803 tagged claims in the live collection: 5 characters at
   * the shortest, 17 at the median, 199 at the longest — so there is no length
   * bound here. A quote cut in half is not evidence of anything.
   */
  readonly evidence: string;
}

/**
 * Idioms that carry a direction word and are not a movement of anything.
 *
 * EVERY ONE WAS READ OFF A MATCHED SPAN, not imagined. The count beside each is
 * how many stored claims that pattern occurs in, and the ones marked (tag) are
 * the ones whose tag it currently changes — measured 2026-08-08 over 3,444
 * claims, and re-measure rather than re-guess:
 *
 *   paid-up 52 (tag: 15)   up to 65 (tag: 5)     upto 24        setting up 15
 *   upgrade 20             up-front 12           scale up 8     set up 4
 *   step-down 3 (tag: 1)   ramp up 2             drew down 1    higher end 1 (tag: 1)
 *   not lower than 1       Subansiri Lower 1     Growth Fund 1 (tag: 1)
 *
 * `paid-up` alone fires on ARVIND, BEL and BLUSPRING share-capital lines;
 * `Subansiri Lower` is a hydro project whose NAME made an NHPC capacity-
 * ADDITION claim match DOWN; `Growth Fund` is the name of a SYSTMTXC fund.
 * The ones with no tag change today still occur in real spans and are kept as
 * the guard they are — the collection is a 32-day window, not the market.
 */
const IDIOM_TRAPS: readonly RegExp[] = [
  /paid-?up/gi,
  /\bup\s?to\b/gi,
  /\bupto\b/gi,
  /setting up/gi,
  /\bset up\b/gi,
  /follow-?up/gi,
  /back-?up/gi,
  /wound up/gi,
  /ramp(?:ed|ing)? up/gi,
  /scal(?:e|es|ed|ing) up/gi,
  /signed up/gi,
  /up-?front/gi,
  /upgrade\w*/gi,
  /step-?down/gi,
  /dr(?:aw|ew|awn)n?\s?-?down/gi,
  /shut down/gi,
  /downstream/gi,
  /\bno[t]? lower than\b/gi,
  /higher end/gi,
  /Subansiri Lower/gi,
  /growth fund/gi,
];

/**
 * Phrases where the direction word describes the RATE of a movement rather than
 * the figure's own movement.
 *
 * SUNDROP: "the overall rate of decline is moderating sequentially from -10% in
 * Q4 FY26 to -3% in Q1 FY 27." The level is improving while a naive rule says
 * contraction, so the honest answer is to refuse. Kept apart from
 * `IDIOM_TRAPS` because these ARE printed movements: the span really does say
 * "decline", so only the TAG refuses them.
 */
const SECOND_DERIVATIVE_TRAPS: readonly RegExp[] = [
  /rate of decline/gi,
  /pace of decline/gi,
  /moderating/gi,
  /decline is narrowing/gi,
];

/** The words a filing uses for a figure that went up. */
const UP =
  /\b(?:up|rose|rising|grew|grown|growth|increased?|higher|improved?|improvement|expanded|expansion|gained?|surged|lifted|lifting)\b/gi;

/** The words a filing uses for a figure that went down. */
const DOWN =
  /\b(?:down|fell|declined?|decline|decreased?|decrease|lower|dropped|reduced|reduction|contracted|de-grew|slipped)\b/gi;

/** A printed size for the movement. No magnitude, no tag. */
const MAGNITUDE = /\d[\d,.]*\s*(?:%|per ?cent|bps|basis points)/gi;

interface Match {
  readonly start: number;
  readonly end: number;
}

/** Every match of one pattern, as offsets into the string searched. */
function matchesOf(text: string, pattern: RegExp): readonly Match[] {
  const found: Match[] = [];
  pattern.lastIndex = 0;
  let match = pattern.exec(text);
  while (match !== null) {
    found.push({ start: match.index, end: match.index + match[0].length });
    match = pattern.exec(text);
  }
  return found;
}

/**
 * Blanks every trap, keeping the string the same length.
 *
 * SPACES RATHER THAN DELETION, so every offset still points at the same
 * character of the collapsed span and the evidence can be sliced out of it
 * verbatim. Removal would slide the tail left by the length of each trap and
 * quote the wrong characters.
 *
 * Blanked and NOT skipped, because RAMCOCEM's "Average Cement prices have
 * dropped by 2% YoY; however, improved by 6% QoQ" has to stay readable after an
 * unrelated trap elsewhere in the sentence is taken out.
 */
function blankTraps(text: string, traps: readonly RegExp[]): string {
  let masked = text;
  for (const trap of traps) {
    masked = masked.replace(trap, (hit) => ' '.repeat(hit.length));
  }
  return masked;
}

const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();

const UNRATED: DirectionReading = { direction: 'unrated', evidence: '' };

/**
 * The movement one verified span printed.
 *
 * NEVER THROWS and always answers. The order of operations is the policy:
 * collapse, blank the traps, require a magnitude, then read the direction —
 * and the evidence is a slice of the collapsed span rather than a sentence this
 * function composed.
 *
 * Measured over all 3,461 stored claims on 2026-08-08:
 *
 *   expansion    746  21.6%
 *   contraction   45   1.3%
 *   mixed         12   0.3%
 *   unrated    2,658  76.8%
 *
 * 803 tagged, 23.2%, reaching 348 of 1,169 claim-bearing filings (29.8%).
 * `direction-corpus.spec.ts` pins that distribution against a committed
 * snapshot, so a rule change that quietly moves coverage is a red build.
 */
export function claimDirection(span: string): DirectionReading {
  if (typeof span !== 'string' || span.trim() === '') return UNRATED;

  const text = collapse(span);
  const searchable = blankTraps(
    blankTraps(text, IDIOM_TRAPS),
    SECOND_DERIVATIVE_TRAPS,
  );

  const magnitudes = matchesOf(searchable, MAGNITUDE);
  if (magnitudes.length === 0) return UNRATED;

  const ups = matchesOf(searchable, UP);
  const downs = matchesOf(searchable, DOWN);
  if (ups.length === 0 && downs.length === 0) return UNRATED;

  const direction: ClaimDirection =
    ups.length > 0 && downs.length > 0
      ? 'mixed'
      : ups.length > 0
        ? 'expansion'
        : 'contraction';

  const decisive = [...ups, ...downs, ...magnitudes];
  const start = Math.min(...decisive.map((hit) => hit.start));
  const end = Math.max(...decisive.map((hit) => hit.end));
  return { direction, evidence: text.slice(start, end) };
}
