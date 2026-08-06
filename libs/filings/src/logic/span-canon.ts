/**
 * The canonical projection a quoted span and its document are compared in.
 *
 * ================================================================
 * WHY THIS EXISTS, AND WHAT IT IS NOT ALLOWED TO BE
 * ================================================================
 *
 * `claim-span.ts` refuses any claim whose quoted sentence is not in the document
 * by EXACT CHARACTER MATCH. That refusal is the only thing standing between this
 * pipeline and publishing invented statements about named listed companies, and
 * it is not negotiable.
 *
 * But it collapsed only whitespace, and a measurement of live extraction runs
 * showed what that costs: the large majority of `span-not-found` refusals are a
 * model PARAPHRASING PUNCTUATION rather than inventing a fact. The document
 * carries a typographic apostrophe and the model quotes a straight one; the PDF
 * carries an `ﬁ` ligature and the model writes `fi`; Docling emits a markdown
 * table and the model quotes the row without its pipes. In every one of those the
 * sentence IS in the document and every letter and digit of it agrees.
 *
 * ================================================================
 * THE INVARIANT THAT MAKES THIS SAFE, STATED ONCE
 * ================================================================
 *
 * **`canonicalise` preserves the sequence of letters and digits, exactly.**
 *
 * Every rule below either (a) rewrites a non-alphanumeric character to another
 * non-alphanumeric character, (b) deletes a non-alphanumeric character, or (c)
 * expands a typographic ligature into the very letters it is a ligature OF.
 * Nothing else. No case folding, no stemming, no similarity score, no threshold.
 *
 * The consequence is the whole safety argument and it is checkable rather than
 * asserted: if `canonicalise(span)` is a substring of `canonicalise(document)`,
 * then the span's letters and digits occur in the document, in that order, with
 * nothing inserted, deleted or substituted between them. A model that changed one
 * word or one digit has changed that sequence and CANNOT match — which is what
 * the adversarial suite measures on real documents and what `span-canon.spec.ts`
 * pins as a property.
 *
 * Case is still NOT folded. "no" and "No" are different words in a disclosure and
 * a model that changed one has changed the document.
 *
 * ================================================================
 * THE REPAIRS ARE NAMED AND SEPARATELY SWITCHABLE
 * ================================================================
 *
 * Not for configurability — production always runs all of them — but because the
 * measurement that justified each one had to attribute recoveries to it. A repair
 * nobody can turn off is a repair whose contribution nobody can measure, and the
 * whole reason this module exists is that the previous bound was set by argument
 * rather than by counting.
 */

/** Which repairs the projection applies. */
export interface CanonRepairs {
  /**
   * Quote characters, dashes, ligatures, ellipses and zero-width characters
   * mapped to their plain-ASCII equivalents. The largest measured win.
   */
  readonly typography: boolean;
  /**
   * Markdown table pipes read as whitespace, so a row quoted with its cell
   * separators and the same row quoted without them are the same string.
   *
   * A SPACE rather than a deletion, deliberately: deleting the pipe would weld
   * `growth|decline` into `growthdecline` and invent an adjacency the document
   * does not have.
   */
  readonly tableCells: boolean;
  /**
   * A hyphen that a line break interrupts is dropped along with the break, so
   * `inter-\nnational` reads as `international`.
   *
   * NARROW ON PURPOSE: only a hyphen immediately preceded by a letter or digit
   * AND immediately followed by a run of whitespace containing a newline. A
   * hyphen with a space on both sides is a dash in a sentence, not a broken word.
   */
  readonly lineBreakHyphens: boolean;
  /**
   * Whitespace is dropped entirely rather than collapsed to one space, so a
   * word the text layer split or welded reads the same either way.
   *
   * ================================================================
   * THE LARGEST MEASURED CAUSE, AND THE ONE THAT IS THE PARSER'S FAULT
   * ================================================================
   *
   * Over every `span-not-found` the live pipeline had recorded, 55.7% differed
   * from the document by WORD SPACING ALONE. They are not the model being loose:
   * they are `pdf-parse` reporting the text layer wrong, and the model quoting
   * the sentence the way the page reads it.
   *
   *     SWIGGY    document: "Instamartwill be a Rs 1.5+ Lakh Cr GOV business"
   *     BUILDPRO  document: "Re venue fr om Operat ions grew 21% YoY t o"
   *
   * No amount of punctuation mapping reaches those. A space that the parser
   * invented inside `Operations` cannot be repaired by anything that treats
   * spaces as significant.
   *
   * ================================================================
   * WHY IT IS STILL NOT A FUZZY MATCH
   * ================================================================
   *
   * It obeys the same invariant as every other rule: the sequence of letters and
   * digits is untouched. A word changed, a digit changed, a negation dropped or a
   * unit altered still cannot match. What is given up is only the model's
   * agreement about WHERE the word boundaries are, and three separate things
   * limit what that can cost:
   *
   *   1. **The evidence stored is the DOCUMENT's own bytes**, spacing and all, so
   *      what a reviewer reads is the source's segmentation and never the
   *      model's.
   *   2. **`MIN_SPAN_CHARS` still applies**, so no isolated token can be a span —
   *      the concatenation hazard needs twelve characters of agreement around it.
   *   3. **`unsupportedNumbers` runs afterwards on the document's slice**, so a
   *      claim stating a figure welded out of two adjacent table cells is
   *      refused by the number rule even though the span matched.
   *
   * It is measured separately from the others precisely because it is the one
   * whose cost is an argument rather than an inspection.
   */
  readonly wordSpacing: boolean;
}

/** Everything on. What production uses. */
export const ALL_REPAIRS: CanonRepairs = {
  typography: true,
  tableCells: true,
  lineBreakHyphens: true,
  wordSpacing: true,
};

/** Nothing on: whitespace collapse alone, which is what shipped before. */
export const NO_REPAIRS: CanonRepairs = {
  typography: false,
  tableCells: false,
  lineBreakHyphens: false,
  wordSpacing: false,
};

/**
 * The projection, plus the map back to the original.
 *
 * `origin[i]` is the index in the SOURCE of the character that produced
 * `text[i]`. A collapsed run of whitespace maps to the index of the first
 * whitespace character in the run; both halves of an expanded ligature map to
 * the one source index the ligature occupied.
 */
export interface CanonicalText {
  readonly text: string;
  readonly origin: readonly number[];
}

/**
 * Characters that vanish entirely.
 *
 * Zero-width joiners, the byte-order mark and the soft hyphen. All four are
 * invisible on the page, all four survive PDF extraction, and none of them is
 * something a model can be expected to reproduce in a quote.
 */
const INVISIBLE = new Set([
  '­', // soft hyphen
  '​', // zero-width space
  '‌', // zero-width non-joiner
  '‍', // zero-width joiner
  '⁠', // word joiner
  '﻿', // byte-order mark
]);

/**
 * Non-alphanumeric characters that stand for a plain-ASCII one, and the
 * ligatures that stand for the letters they are made of.
 *
 * EVERY ENTRY IS EITHER PUNCTUATION-FOR-PUNCTUATION OR A LIGATURE-FOR-ITS-OWN
 * -LETTERS. Nothing here maps one letter to a different letter, which is what
 * keeps the invariant at the top of this file true by inspection.
 */
const EQUIVALENT: ReadonlyMap<string, string> = new Map([
  // Single quotes and the primes PDF extraction produces for them.
  ['‘', "'"],
  ['’', "'"],
  ['‚', "'"],
  ['‛', "'"],
  ['′', "'"],
  ['´', "'"],
  ['`', "'"],
  // Double quotes.
  ['“', '"'],
  ['”', '"'],
  ['„', '"'],
  ['‟', '"'],
  ['″', '"'],
  // Dashes and the minus sign.
  ['‐', '-'],
  ['‑', '-'],
  ['‒', '-'],
  ['–', '-'],
  ['—', '-'],
  ['―', '-'],
  ['⁃', '-'],
  ['−', '-'],
  // An ellipsis is three full stops and is written both ways in one document.
  ['…', '...'],
  // Ligatures, expanded into their own letters. `ﬁnancial` and `financial` are
  // the same word and one of them is what the type-setter emitted.
  ['ﬀ', 'ff'],
  ['ﬁ', 'fi'],
  ['ﬂ', 'fl'],
  ['ﬃ', 'ffi'],
  ['ﬄ', 'ffl'],
  ['ﬆ', 'st'],
]);

/** Hyphen-like characters a line break may interrupt a word at. */
const HYPHENS = new Set(['-', '‐', '‑', '‒', '–']);

const WHITESPACE = /\s/;
const ALPHANUMERIC = /[0-9A-Za-z]/;

/**
 * How far a dehyphenating look-ahead may run before it gives up.
 *
 * A line break in a PDF text layer is a newline and at most a little indentation.
 * Without a bound, a hyphen followed by four thousand characters of blank page
 * would make this scan the rest of the document for every hyphen in it.
 */
const LINE_BREAK_LOOKAHEAD = 40;

/**
 * Whether the whitespace run starting at `index` is a line break, and where it
 * ends.
 *
 * Returns -1 when the run carries no newline, which is the case a dash in a
 * sentence produces and which must NOT dehyphenate.
 */
function lineBreakRunEnd(source: string, index: number): number {
  let at = index;
  let sawNewline = false;
  const limit = Math.min(source.length, index + LINE_BREAK_LOOKAHEAD);

  while (at < limit && WHITESPACE.test(source[at])) {
    if (source[at] === '\n' || source[at] === '\r') sawNewline = true;
    at += 1;
  }

  return sawNewline && at > index ? at : -1;
}

/**
 * Projects a string into the form spans are compared in.
 *
 * NEVER THROWS. An empty string projects to an empty string with an empty map,
 * which is what every caller of this already handles as "no match".
 */
export function canonicalise(
  source: string,
  repairs: CanonRepairs = ALL_REPAIRS,
): CanonicalText {
  const characters: string[] = [];
  const origin: number[] = [];
  let inWhitespace = false;

  const emit = (value: string, at: number): void => {
    for (const character of value) {
      characters.push(character);
      origin.push(at);
    }
  };

  let index = 0;
  while (index < source.length) {
    const character = source[index];

    if (repairs.typography && INVISIBLE.has(character)) {
      index += 1;
      continue;
    }

    // BEFORE the whitespace branch, because the whole point is to swallow the
    // break as well as the hyphen. Guarded on the preceding character being
    // alphanumeric so a bulleted line ending in a dash is left alone.
    if (
      repairs.lineBreakHyphens &&
      HYPHENS.has(character) &&
      index > 0 &&
      ALPHANUMERIC.test(source[index - 1])
    ) {
      const runEnd = lineBreakRunEnd(source, index + 1);
      if (runEnd !== -1) {
        index = runEnd;
        // The word continues, so the projection is mid-word rather than mid-gap.
        inWhitespace = false;
        continue;
      }
    }

    const isCell = repairs.tableCells && character === '|';
    if (isCell || WHITESPACE.test(character)) {
      // Dropped entirely, or collapsed to one space. Either way a newline, a
      // tab, a run of four spaces and a table cell boundary are the same thing
      // to the matcher.
      if (!repairs.wordSpacing && !inWhitespace) {
        emit(' ', index);
        inWhitespace = true;
      }
      index += 1;
      continue;
    }

    inWhitespace = false;
    const equivalent = repairs.typography
      ? EQUIVALENT.get(character)
      : undefined;
    emit(equivalent ?? character, index);
    index += 1;
  }

  return { text: characters.join(''), origin };
}

/**
 * The canonical form of a caller's span, trimmed of the separators the
 * projection may have left at either end.
 *
 * Exported so the matcher and the measurement tool ask the same question rather
 * than two questions that agree today.
 */
export const canonicalSpan = (
  span: string,
  repairs: CanonRepairs = ALL_REPAIRS,
): string => canonicalise(span, repairs).text.trim();
