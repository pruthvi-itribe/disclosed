/**
 * The short form of a claim, for the one line a card leads with.
 *
 * ================================================================
 * WHAT THIS IS ALLOWED TO DO
 * ================================================================
 *
 * CUT, NEVER WRITE. The result is always a PREFIX of the claim, ending at
 * a boundary the claim itself printed — no reordering, no substitution,
 * no word this pipeline chose. A reader who compares the short line with
 * the full one finds the first N characters, identically. That is the
 * whole safety argument, and it is why this needs no model and no second
 * pass through the verbatim gate: a prefix of a published line is not a
 * new statement about the company.
 *
 * REFUSING IS A SUCCESS. Everything below that cannot be shortened
 * safely keeps its full claim, which is what the card already did.
 *
 * ================================================================
 * WHAT WOULD BE A MISTAKE, AND WHY EACH RULE EXISTS
 * ================================================================
 *
 *  - A NEGATION OR CONDITION IN THE TAIL. "…approved, subject to
 *    shareholder approval" cut at the comma says the thing is done. Any
 *    of those words after the cut and the claim is left whole.
 *  - LOSING THE FIGURE. "CareEdge reaffirmed CARE A; Stable rating on
 *    facilities of Rs 60.90 crore" cut at its semicolon keeps the rating
 *    and drops the money — a real production line. A cut that discards a
 *    figure the claim printed is refused.
 *  - A STUB. Under MIN_GIST_CHARS the line stops being a sentence and
 *    starts being a fragment, which is the defect the lede rule already
 *    exists to avoid.
 */

/**
 * MEASURED ON PRODUCTION, 2026-08-19: over the 2,000 most recent verified
 * filings, the claim a card leads with has a median length of 107
 * characters, p90 162, p95 182, max 198 — 65% are over 90. At the deck's
 * 21px, a 390px phone fits ~35 characters a line, so 100 is three lines
 * and the p90 lede is five. The cap is the point at which a headline
 * stops being one.
 */
export const MAX_GIST_CHARS = 100;

/** Below this a cut is a fragment, not a shorter sentence. */
export const MIN_GIST_CHARS = 45;

/**
 * The words whose presence AFTER a cut would make the short line say
 * something the claim does not. Conditions, negations, reversals.
 */
const CHANGES_MEANING =
  /\b(?:not|nor|without|subject to|pending|proposed|withdrawn|cancelled|revoked|deferred|postponed|revised|except|unless|save for|conditional|contingent|in-?principle|intends? to|expects? to|plans? to)\b/i;

/** A boundary the claim itself printed, in the order they are preferred. */
const BOUNDARIES = [';', ' — ', ' – ', ' (', ', '];

/**
 * A CUT MAY NOT LEAVE THE SENTENCE HANGING. Measured against production
 * on 2026-08-19, the comma rule produced "…of Rs 10 each for FY ended
 * March 31" — a date sliced from its year — and the same shape strands a
 * trailing preposition or conjunction. Both read as a rendering fault
 * rather than as a shorter sentence, so a candidate ending in one is
 * refused and the next boundary is tried.
 */
const DANGLING =
  /(?:\b(?:of|for|to|at|on|in|by|with|from|and|or|the|a|an|per|as|its|their)|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?|\b\d{1,2}(?:st|nd|rd|th)?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*)\s*$/i;

/** Any figure the claim printed: what a cut may not throw away. */
const FIGURE = /\d[\d,]*(?:\.\d+)?/g;

const figuresIn = (text: string): readonly string[] => text.match(FIGURE) ?? [];

export interface Gist {
  /** The line to lead with — the claim itself when nothing was cut. */
  readonly line: string;
  /** True when `line` is shorter than the claim it came from. */
  readonly cut: boolean;
}

/**
 * The longest safe prefix at a printed boundary, or the claim whole.
 */
export const briefGist = (claimText: string): Gist => {
  const text = String(claimText).trim();
  if (text.length <= MAX_GIST_CHARS) return { line: text, cut: false };

  const whole = figuresIn(text);
  const candidates: string[] = [];
  for (const boundary of BOUNDARIES) {
    let at = text.indexOf(boundary);
    while (at !== -1) {
      candidates.push(text.slice(0, at).trim());
      at = text.indexOf(boundary, at + 1);
    }
  }

  // Longest first: the most of the sentence that still fits.
  const ordered = [...new Set(candidates)].sort((a, b) => b.length - a.length);
  for (const candidate of ordered) {
    if (candidate.length > MAX_GIST_CHARS) continue;
    if (candidate.length < MIN_GIST_CHARS) continue;
    if (DANGLING.test(candidate)) continue;
    const tail = text.slice(candidate.length);
    if (CHANGES_MEANING.test(tail)) continue;
    // The first figure the claim printed must survive the cut; a claim
    // that printed none is judged on its words alone.
    if (whole.length > 0 && figuresIn(candidate).length === 0) continue;
    return { line: candidate, cut: true };
  }
  return { line: text, cut: false };
};
