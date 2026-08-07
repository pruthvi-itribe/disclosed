/**
 * Whether two verified claims assert the SAME FACT.
 *
 * ================================================================
 * WHY THIS EXISTS
 * ================================================================
 *
 * A company reporting a quarter files it more than once. DHARMAJ filed an
 * investor presentation and a press release a minute apart, one saying
 * "Revenue growth of 5% YOY in Q1FY27" and the other "Revenue grew 5% YOY in
 * Q1FY27." LUPIN filed a deck and a press release covering the same quarter.
 * Both claims are true, both were matched character for character against their
 * own source document, and printing both tells a reader one thing twice.
 *
 * That is a PRESENTATION problem and it is fixed at presentation. Nothing here
 * discards a claim, changes what is stored, or weakens the verbatim gate — a
 * claim suppressed as a repeat is still in the database, still carries its span,
 * and is still evidence for the filing it came from.
 *
 * ================================================================
 * THE FIGURES ARE THE FACT
 * ================================================================
 *
 * The obvious approach is a text-similarity threshold, and measuring it showed
 * why that would be wrong. Over 36 hours of live claims, 122 pairs from one
 * company shared an identical figure set. Sorted by word overlap they run from
 * 1.00 down to 0.20, and reading them, the LOW ones are duplicates too:
 *
 *   0.86  "Q1 consolidated EBITDA rose 18% YoY to INR 765.5 Lakhs"
 *      == "Q1 consolidated EBITDA INR 765.5 lakhs, up 18% YoY"
 *   0.29  "Inaugurates 5.6 GW Seetharampur module plant"
 *      == "Inaugurated 5.6 GW Seetharampur module manufacturing facility"
 *   0.20  "Record date fixed as August 20, 2026 for dividend payment"
 *      == "NIIT fixes Aug 20, 2026 as record date for dividend."
 *
 * Any threshold placed to catch those would have to sit near zero, at which
 * point it is not a threshold. What actually separates the set is starker:
 *
 *   pairs sharing an identical, non-empty figure set   122
 *     ..sharing at least one content word (duplicate)  120
 *     ..sharing no content word at all (different)       2
 *
 * So the rule is the figure set, with a single shared word as the guard against
 * the two that coincide. Two claims from ONE company carrying exactly the same
 * numbers are about the same thing unless they have no vocabulary in common.
 *
 * THE FIGURE SET MUST BE NON-EMPTY. Two unquantified claims — "entered a
 * partnership", "commissioned the plant" — share the empty set with every other
 * unquantified claim in the collection, and treating that as a match would
 * collapse a company's whole qualitative output into one line.
 */

/** Words too common to evidence that two claims are about the same thing. */
const STOP_WORDS: ReadonlySet<string> = new Set([
  'the',
  'a',
  'an',
  'of',
  'in',
  'to',
  'for',
  'and',
  'on',
  'at',
  'is',
  'was',
  'from',
  'by',
  'with',
  'as',
  'up',
  'down',
  'vs',
  'yoy',
  'qoq',
]);

/**
 * Every number a claim states, with grouping separators removed.
 *
 * `1,089` and `1089` are the same figure written twice, and a filing writes it
 * both ways across a presentation and a press release.
 */
const figuresIn = (text: string): ReadonlySet<string> =>
  new Set(
    (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((figure) =>
      figure.replace(/,/g, ''),
    ),
  );

/**
 * The content words, which exist only to catch the coincidence case.
 *
 * Short tokens and pure numbers are dropped: the numbers are already compared
 * exactly, and counting them twice would let two claims match on arithmetic
 * alone.
 */
const wordsIn = (text: string): ReadonlySet<string> =>
  new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9%. ]+/g, ' ')
      .split(/\s+/)
      .filter(
        (word) =>
          word.length > 2 && !STOP_WORDS.has(word) && !/^[\d.]+$/.test(word),
      ),
  );

/** What a claim asserts, reduced to the two things that decide sameness. */
export interface ClaimFact {
  readonly figures: ReadonlySet<string>;
  readonly words: ReadonlySet<string>;
}

export const claimFact = (text: string): ClaimFact =>
  typeof text === 'string'
    ? { figures: figuresIn(text), words: wordsIn(text) }
    : { figures: new Set<string>(), words: new Set<string>() };

const sameMembers = (
  a: ReadonlySet<string>,
  b: ReadonlySet<string>,
): boolean => {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
};

const sharesAWord = (
  a: ReadonlySet<string>,
  b: ReadonlySet<string>,
): boolean => {
  for (const word of a) if (b.has(word)) return true;
  return false;
};

/**
 * Whether two claims BY THE SAME COMPANY state the same fact.
 *
 * The caller is responsible for the company check. This deliberately takes no
 * symbol: comparing across companies would be a different and much more
 * dangerous question — two firms can report the same revenue in the same
 * quarter, and collapsing those would hide one of them entirely.
 */
export function sameFact(a: ClaimFact, b: ClaimFact): boolean {
  if (a.figures.size === 0) return false;
  if (!sameMembers(a.figures, b.figures)) return false;
  return sharesAWord(a.words, b.words);
}

/**
 * Remembers the facts already shown, so a repeat can be recognised.
 *
 * Scoped per symbol by the caller's key. Held for the length of one render
 * rather than persisted: what counts as a repeat depends on what a reader has
 * just been shown, which is a property of the view and not of the filing.
 */
export class FactsSeen {
  private readonly bySymbol = new Map<string, ClaimFact[]>();

  /**
   * Records a claim and answers whether it repeats one already recorded.
   *
   * Returns false for the FIRST occurrence, so the earliest filing to state a
   * fact is the one that keeps it. The feed renders newest first, which means
   * the newest telling wins — correct here, because a company that restates a
   * figure in a later document is usually correcting or confirming it.
   */
  addAndCheck(symbol: string, text: string): boolean {
    const fact = claimFact(text);
    const held = this.bySymbol.get(symbol) ?? [];
    for (const seen of held) {
      if (sameFact(fact, seen)) return true;
    }
    held.push(fact);
    this.bySymbol.set(symbol, held);
    return false;
  }
}
