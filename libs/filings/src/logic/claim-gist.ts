/**
 * The gate for a claim's SHORT FORM — the one line a card leads with.
 *
 * ================================================================
 * WHY THIS IS NOT A SUMMARY, AND MAY NEVER BECOME ONE
 * ================================================================
 *
 * `claim-summary.ts` states the rule this module lives under: compressed
 * prose over a document cannot be checked, so it is stored in its own
 * field, never published, and never counted as a claim. A gist is the
 * opposite construction and that is the entire point — it is a
 * CONTIGUOUS SLICE OF A LINE THIS SERVICE HAS ALREADY PUBLISHED, so a
 * reader comparing the two finds the same words in the same order. The
 * model chooses which of them to keep; it never gets to write any.
 *
 * A model that returns a fluent paraphrase gets `not-found` here and the
 * filing keeps its full claim. That is the design working, not failing.
 *
 * ================================================================
 * IT SLICES THE CLAIM, NOT THE SPAN, AND THAT WAS MEASURED
 * ================================================================
 *
 * The first build pointed the model at the claim's SPAN — the document's
 * own bytes — on the reasoning that provenance is strongest there. A dry
 * run over 20 production claims (2026-08-19) accepted, among others:
 *
 *   "in-\ncreased to Rs. 466,44,08,604 divided into 233,22,04,302"
 *   "Total Total 10258326   9071840   88.43  9062559   9281    99.90"
 *
 * Both are honest slices of their spans. The first is a word a PDF line
 * break cut in half; the second is a table row. The span is raw
 * extracted text — columns, wrapped lines, hyphen splits — and the
 * canonical projection that makes a match possible is exactly what hides
 * all of it from the matcher. Provenance is not readability, and a
 * headline needs both.
 *
 * So the source is the CLAIM text: the wire line this product already
 * shows on every card, already gated by the span it was matched against.
 * A slice of it is no weaker a statement than the whole of it, and it is
 * prose because the claim is prose.
 *
 * ================================================================
 * THE OTHER FOUR RULES ARE ABOUT MEANING, NOT PROVENANCE
 * ================================================================
 *
 * A slice can be perfectly verbatim and still say something the sentence
 * did not. Each rule below was written against a claim this product has
 * actually published (measured over the 2,000 most recent verified
 * filings, 2026-08-19):
 *
 *  - CONDITION DROPPED. "…approved, subject to shareholder approval"
 *    sliced before the comma states a done deal. If the span carries a
 *    condition, a negation or a reversal, the gist must carry it too.
 *  - FIGURE LOST. "CareEdge reaffirmed CARE A; Stable rating on
 *    facilities of Rs 60.90 crore" sliced at the semicolon keeps the
 *    rating and drops the money. A span that prints a figure needs a
 *    gist that prints one.
 *  - DANGLING END. "…of Rs 10 each for FY ended March 31" — a date cut
 *    from its year. Refused: it reads as a rendering fault.
 *  - NO GAIN. A gist that saves a handful of characters is churn on the
 *    reader for nothing; below the threshold the claim stands.
 *
 * Every refusal is NAMED and returned. A gate whose refusals are
 * invisible cannot be told from one that is not running — the rule
 * `claim-verify.ts` opens with.
 */

/**
 * MEASURED ON PRODUCTION, 2026-08-19: across 2,000 verified filings the
 * claim a card leads with runs to a median of 107 characters, p90 162,
 * max 198. At the deck's 21px a 390px phone holds ~35 characters a line,
 * so 100 is three lines — the point at which a headline stops being one.
 */
export const GIST_MAX_CHARS = 100;

/** Below this a slice is a fragment, not a shorter sentence. */
export const GIST_MIN_CHARS = 45;

/**
 * The gist must be shorter than the claim by enough to be worth showing
 * a reader a second version of the line. 0.8 = a fifth off, at least.
 */
export const GIST_MAX_RATIO = 0.8;

export type GistRefusal =
  /**
   * The model returned nothing, which the prompt asks for when no run of
   * the claim satisfies the rules. NOT `too-short`: a decline is the
   * model doing as it was told, and a stub is it failing to — counting
   * them together made a well-behaved run look like a broken one.
   */
  | 'declined'
  /** Not a slice of the claim: the model wrote rather than chose. */
  | 'not-found'
  | 'too-long'
  | 'too-short'
  | 'no-gain'
  | 'figure-lost'
  | 'condition-dropped'
  | 'dangling-end'
  /** Torn out of the middle of the line rather than begun at one. */
  | 'mid-sentence'
  /** A table row the extractor read as text, not a sentence. */
  | 'not-prose'
  /** Cut where the claim printed no join, so a phrase lost its object. */
  | 'mid-phrase'
  /** Cut at an "and" that was joining one phrase's object, not clauses. */
  | 'splits-a-list';

export type GistVerdict =
  | { readonly ok: true; readonly gist: string }
  | { readonly ok: false; readonly refused: GistRefusal };

/** Conditions, negations and reversals: dropping one changes the fact. */
const CONDITIONAL =
  /\b(?:not|nor|without|subject to|pending|proposed|withdrawn|cancelled|revoked|deferred|postponed|revised|except|unless|conditional|contingent|in-?principle)\b/i;

/** Any printed figure. */
const FIGURE = /\d[\d,]*(?:\.\d+)?/;

/**
 * A slice may not end on a word that needs the next one, nor halfway
 * through a date.
 */
const DANGLING =
  /(?:\b(?:of|for|to|at|on|in|by|with|from|and|or|the|a|an|per|as|its|their|that|which)|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?|\b\d{1,2}(?:st|nd|rd|th)?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*)[\s,]*$/i;

export interface GistCandidate {
  /** What the model returned. */
  readonly candidate: string;
  /** The published claim line the gist is a slice of, and replaces. */
  readonly claimText: string;
}

/**
 * Accepts a proposed gist, or names the reason it cannot be published.
 *
 * THE STORED STRING IS THE DOCUMENT'S, NOT THE MODEL'S. What comes back
 * on success is the slice of the SPAN that matched — the same rule
 * `findVerbatimSpan` follows when it returns the document's own bytes
 * rather than the caller's tidied version of them.
 */
export const verifyGist = ({
  candidate,
  claimText,
}: GistCandidate): GistVerdict => {
  const claim = String(claimText).trim();
  const proposed = String(candidate).trim().replace(/\s+/g, ' ');
  if (proposed === '') return { ok: false, refused: 'declined' };
  if (proposed.length > GIST_MAX_CHARS) {
    return { ok: false, refused: 'too-long' };
  }
  if (proposed.length < GIST_MIN_CHARS) {
    return { ok: false, refused: 'too-short' };
  }

  // CONTIGUOUS IN THE CLAIM, whitespace-insensitively and nothing else:
  // every letter, digit and mark in order, with nothing inserted,
  // substituted or reordered. A paraphrase dies here.
  const flat = claim.replace(/\s+/g, ' ');
  const at = flat.indexOf(proposed);
  if (at === -1) return { ok: false, refused: 'not-found' };
  const gist = proposed;

  // A ROW OF FIGURES IS NOT A SENTENCE. Three bare numbers in a row is a
  // table the extractor read as text — "Total Total 10258326 9071840
  // 88.43" was accepted by the first build. Checked BEFORE the rules
  // about where the cut landed: a table row is a table row wherever it
  // was cut, and the refusal a reviewer reads should say so.
  if (/(?:^|\s)[\d,.]+\s+[\d,.]+\s+[\d,.]+/.test(gist)) {
    return { ok: false, refused: 'not-prose' };
  }
  if (gist.length > flat.length * GIST_MAX_RATIO) {
    return { ok: false, refused: 'no-gain' };
  }
  // STARTS WHERE A SENTENCE COULD. The span-sliced build returned
  // "allotted 26,60,700 ... equity shares" — true, contiguous, and
  // reading like a fragment torn out of a page. A headline begins on a
  // word the claim itself began or a boundary printed one after.
  //
  // A COMMA IS NOT THAT BOUNDARY, and the first --write run published the
  // proof: for "Expanding presence in Saudi Arabia, Kenya and other
  // African markets…" it took the line from "Kenya" — a headline that
  // drops the country listed first and reads as the whole of what was
  // said. The capital letter below cannot tell a sentence's first word
  // from a proper noun mid-list, so the comma admitted exactly the case
  // it cannot judge. Strong punctuation only; the comma branch's other
  // survivors were all list items of the same shape.
  if (at !== 0 && !/[.;:]\s+$/.test(flat.slice(0, at))) {
    return { ok: false, refused: 'mid-sentence' };
  }
  if (!/^[A-Z0-9₹]/.test(gist)) return { ok: false, refused: 'mid-sentence' };
  if (FIGURE.test(flat) && !FIGURE.test(gist)) {
    return { ok: false, refused: 'figure-lost' };
  }
  if (CONDITIONAL.test(flat) && !CONDITIONAL.test(gist)) {
    return { ok: false, refused: 'condition-dropped' };
  }
  if (DANGLING.test(gist)) return { ok: false, refused: 'dangling-end' };
  // AN AMOUNT WHOSE OBJECT IS IN THE TAIL. The dry run returned
  // "…after early redemption of ₹423 crore" for a claim that went on
  // "of Non-Convertible Debentures" — true, readable, and it leaves the
  // reader asking ₹423 crore OF WHAT.
  //
  // Narrow on purpose: only when the slice ENDS on a figure and the tail
  // opens with "of". A first attempt refused any tail starting "of" and
  // took "…allotted 26,60,700 fully paid-up equity shares" with it,
  // where the dropped "of face value Rs. 2 each" is a qualifier the
  // sentence does not need. The test suite caught it.
  const tail = flat.slice(at + gist.length);
  // IT MUST END WHERE THE CLAIM PUT A JOIN. The hardest failures are the
  // ones no word list catches: a low-effort run returned "confirmed as
  // final" for a claim that went on "dividend", and "security cover of
  // at least 1.10 times" for one that went on "the entire secured
  // obligations". Neither ends on a preposition; both end mid-phrase.
  //
  // Chasing that with parts of speech is brittle, so the test is
  // structural: the next word must be one a sentence can be broken
  // before — punctuation, a coordinating conjunction, or a preposition
  // opening a phrase the sentence does not need ("…equity shares | of
  // face value Rs. 2 each"). A bare noun or adjective after the cut
  // means the phrase was still going: "final | dividend", "1.10 times |
  // the entire secured obligations", "0.599 MTPA | manganese ore".
  //
  // The preposition half of that list was added after the first version
  // refused those three GOOD cuts along with the bad ones — the tests
  // below hold both halves.
  const JOIN =
    /^\s*(?:[,;:.)\]]|and\b|or\b|but\b|of\b|for\b|to\b|at\b|on\b|in\b|by\b|with\b|from\b|through\b|across\b|during\b|under\b|upon\b|within\b|after\b|before\b|against\b)/i;
  if (tail !== '' && !JOIN.test(tail)) {
    return { ok: false, refused: 'mid-phrase' };
  }
  // "and" JOINS CLAUSES SOMETIMES AND OBJECTS THE REST OF THE TIME, and
  // the difference is a number's meaning. A run accepted:
  //
  //   claim: "Buyback size is 7.20% and 6.63% of aggregate paid-up
  //           equity share capital and free reserves as at 31 March"
  //   gist:  "Buyback size is 7.20% and 6.63% of aggregate paid-up
  //           equity share capital"
  //
  // 7.20% OF CAPITAL PLUS RESERVES IS NOT 7.20% OF CAPITAL. The same cut
  // dropped a second interim dividend from a claim announcing both.
  //
  // The test: if the slice is still inside a prepositional phrase — an
  // "of" after its last punctuation — then the "and" is joining that
  // phrase's object and the cut takes half of it. Outside one ("…5 GWh
  // installed capacity | and delivered 300 containers") the conjunction
  // joins clauses and the cut is sound.
  if (/^\s*(?:and|or)\b/i.test(tail)) {
    const lastBreak = Math.max(
      gist.lastIndexOf(','),
      gist.lastIndexOf(';'),
      gist.lastIndexOf(':'),
    );
    if (/\bof\b/i.test(gist.slice(lastBreak + 1))) {
      return { ok: false, refused: 'splits-a-list' };
    }
  }
  const endsOnFigure =
    /[\d,.]+\s*(?:%|crore|cr|lakh|lakhs|mn|bn|million|billion)?\s*$/i.test(
      gist,
    );
  if (endsOnFigure && /^\s*of\b/i.test(tail)) {
    return { ok: false, refused: 'dangling-end' };
  }
  return { ok: true, gist };
};
