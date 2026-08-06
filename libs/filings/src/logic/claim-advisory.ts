/**
 * The two things a claim may never say, enforced on the OUTPUT.
 *
 * ================================================================
 * WHY THIS IS A FILTER AND NOT A PROMPT INSTRUCTION
 * ================================================================
 *
 * The prompt tells the model not to write advisory language. That instruction
 * is worth having and it is not a control: a prompt is a request, and the one
 * time it is not honoured is the time a message goes out reading "positive for
 * the stock" over a named listed company's filing. Under SEBI's research-analyst
 * regulations that sentence is the difference between reporting a disclosure and
 * publishing investment advice without a registration, and the difference is not
 * recoverable by an apology.
 *
 * So the rule is enforced where it can be checked: on the string that is about
 * to be published, after the model has finished, by code with tests. A claim
 * that trips any pattern here is DISCARDED — not softened, not rewritten. A
 * rewrite would be this pipeline authoring a claim, which is precisely what the
 * verbatim gate exists to prevent.
 *
 * ================================================================
 * THE LINE THE PATTERNS DRAW
 * ================================================================
 *
 * Blocked is language about the SECURITY or about what a reader should do:
 * price, rating, valuation, upside, and any verb aimed at an investor. Allowed
 * is language about the COMPANY, including its own forward-looking statements —
 * "expecting volume growth of 16-18%", "targets 100 billion rupees adjusted
 * EBITDA by FY31", "lowers topline guidance". Those are the company's
 * disclosures, quoted; a filings wire that could not carry them would have
 * nothing to carry. The corpus in the spec pins that line with the real
 * published lines this feature exists to match.
 */

/** One forbidden pattern and the reason it exists, for the discard record. */
export interface ForbiddenPhrase {
  readonly pattern: RegExp;
  /** Named in the discard so an operator can see which rule fired. */
  readonly why: string;
}

/**
 * Predictive, advisory and valuation framing.
 *
 * Written as phrases rather than words wherever a word has an innocent use.
 * `rating` is not blocked, because a credit-rating action is a real corporate
 * event this wire should carry; `buy rating` and `analyst rating` are. Bare
 * `valuation` is not blocked, because an acquisition states one; `attractive
 * valuation` is.
 */
export const ADVISORY_PATTERNS: readonly ForbiddenPhrase[] = [
  {
    pattern:
      /\b(?:buy|sell|accumulate|book profits?|exit the (?:stock|position))\b/i,
    why: 'tells a reader what to do with the security',
  },
  {
    pattern: /\b(?:overweight|underweight|outperform\w*|underperform\w*)\b/i,
    why: 'is a research-analyst rating',
  },
  {
    pattern:
      /\b(?:target price|price target|fair value|analyst rating|buy rating|sell rating|stock rating|price objective)\b/i,
    why: 'is a price or rating call',
  },
  {
    pattern: /\b(?:upside|downside|multi-?bagger|re-?rating)\b/i,
    why: 'predicts a move in the security',
  },
  {
    pattern: /\b(?:bullish|bearish|under-?valued|over-?valued)\b/i,
    why: 'is a directional or valuation judgement',
  },
  {
    pattern:
      /\b(?:attractive|cheap|expensive|compelling|rich) valuations?\b|\bvaluation comfort\b/i,
    why: 'is a valuation judgement',
  },
  {
    pattern:
      /\b(?:positive|negative|bad|good|great) for the (?:stock|share|scrip|counter)\b/i,
    why: 'states an effect on the security',
  },
  {
    pattern:
      /\b(?:investors?|traders?|shareholders?) (?:should|may want to|are advised)\b/i,
    why: 'addresses an instruction to investors',
  },
  {
    pattern:
      /\b(?:we|our) (?:recommend|believe|view|expect the stock|see)\b|\brecommendation\b/i,
    why: 'is this pipeline speaking rather than the filing',
  },
  {
    pattern:
      /\b(?:stock|share|shares|scrip|counter)\b[^.]{0,40}\b(?:rally|rallied|surge\w*|jump\w*|crash\w*|plunge\w*|soar\w*|tank\w*|spike\w*)\b/i,
    why: 'predicts or narrates a price move',
  },
  {
    pattern:
      /\b(?:rally|rallied|surge\w*|jump\w*|crash\w*|plunge\w*|soar\w*)\b[^.]{0,40}\b(?:stock|share|shares|scrip|counter)\b/i,
    why: 'predicts or narrates a price move',
  },
  {
    pattern:
      /\b(?:share|stock) price\b|\bmarket cap(?:italisation|italization)?\b/i,
    why: 'is about the security rather than the company',
  },
];

/**
 * Claims that name, or unavoidably identify, an individual.
 *
 * FAILS CLOSED, and deliberately over-blocks. A wire line about a person is the
 * highest-exposure sentence this system could emit — a defamation claim rather
 * than a correction — and the cost of over-blocking is a board-change line
 * nobody needed. A listed company has one managing director, so naming the role
 * names the person as surely as naming them does; the role phrases are here for
 * that reason and not as a proxy for the honorifics.
 *
 * `Board of Directors` is deliberately NOT matched: bare `director` is absent
 * from every pattern, so a board resolution stays sayable while a named or
 * singular officer does not.
 */
export const INDIVIDUAL_PATTERNS: readonly ForbiddenPhrase[] = [
  // Three forms, because one regex cannot cover them. The abbreviated
  // honorifics are only unambiguous when they carry their full stop — a bare
  // `ms` is milliseconds — while the spelled-out ones never need it, and the
  // title-case form has to stay case-SENSITIVE so `dr` inside a word is not a
  // match. The wire renders in capitals, so the first pattern is the one that
  // catches a line already uppercased.
  {
    pattern: /\b(?:mr|mrs|ms|dr|sh|smt)\.\s*[a-z]/i,
    why: 'carries an honorific followed by a name',
  },
  {
    pattern: /\b(?:shri|smt|sri|prof|mrs)\b\s+[a-z]/i,
    why: 'carries an honorific followed by a name',
  },
  {
    pattern: /\b(?:Mr|Ms|Dr)\s+[A-Z][a-z]/,
    why: 'carries an honorific followed by a name',
  },
  {
    pattern:
      /\b(?:appoint\w*|re-?appoint\w*|resign\w*|ceased? to be|steps? down|stepping down|elevat\w*|induct\w*|superannuat\w*|demise)\b/i,
    why: 'describes a change of office, which is always about a person',
  },
  {
    pattern:
      /\b(?:chief (?:executive|financial|operating|technology|risk|business) officer|managing director|whole[- ]?time director|executive director|independent director|non-?executive director|chairman|chairperson|company secretary|compliance officer|\bCEO\b|\bCFO\b|\bCOO\b|\bMD & CEO\b)/i,
    why: 'names an officer, of whom a company has one',
  },
];

/** The first pattern a text trips, or null when it trips none. */
const firstHit = (
  text: string,
  patterns: readonly ForbiddenPhrase[],
): string | null => {
  for (const { pattern, why } of patterns) {
    const found = pattern.exec(text);
    if (found !== null) return `"${found[0].trim()}" ${why}`;
  }
  return null;
};

/**
 * Why a claim may not be published as written, or null when it may.
 *
 * Returns the REASON rather than a boolean, because the reason is what the
 * dashboard shows and what makes a discard reviewable. A discard nobody can
 * explain is indistinguishable from a bug in the filter.
 */
export const advisoryHitIn = (text: string): string | null =>
  firstHit(text, ADVISORY_PATTERNS);

/** Why a claim appears to be about a person, or null when it does not. */
export const individualHitIn = (text: string): string | null =>
  firstHit(text, INDIVIDUAL_PATTERNS);
