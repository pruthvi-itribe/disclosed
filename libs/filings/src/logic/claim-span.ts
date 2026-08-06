/**
 * Finding a quoted span in the document it was supposed to come from.
 *
 * ================================================================
 * THIS IS THE WHOLE DESIGN
 * ================================================================
 *
 * A language model asked to compress a filing into a wire line will, sooner or
 * later, produce a plausible corporate statement the filing does not contain.
 * Nothing downstream can tell one of those from a real one — that is what makes
 * it dangerous, and it is why the amount extractor already refuses any figure it
 * cannot re-read out of the source. The same discipline applies here and it is
 * the only thing standing between this pipeline and publishing invented claims
 * about named listed companies.
 *
 * So every claim must arrive with the sentence it was read from, and that
 * sentence must be findable in the document by EXACT CHARACTER MATCH before the
 * claim may be published. No fuzzy match, no similarity score, no "close
 * enough". A span that is not in the document means the claim is discarded.
 *
 * ================================================================
 * WHAT "EXACT" IS MEASURED IN, AND WHY IT IS STILL EXACT
 * ================================================================
 *
 * PDF text extraction breaks lines wherever the page did. A sentence that reads
 * "targets 100 billion rupees adjusted EBITDA by FY31" in the document arrives
 * from `pdf-parse` as, say, `targets 100 billion \nrupees adjusted\nEBITDA by
 * FY31`, and the amount extractor already documents the same hazard ("Rs. \n
 * 42,00,000"). Demanding a byte-exact match against that would discard almost
 * every true claim and keep almost none — a gate that refuses everything is not
 * a safety property, it is a broken feature that happens to be safe.
 *
 * So the comparison runs in a CANONICAL PROJECTION of both sides, and
 * `span-canon.ts` owns it and argues every rule in it. Whitespace runs collapse
 * to one space; typographic quotes, dashes and ligatures become their plain
 * equivalents; invisible characters vanish; a markdown cell boundary reads as a
 * separator; a hyphen a line break interrupted rejoins its word.
 *
 * THE PROJECTION PRESERVES THE SEQUENCE OF LETTERS AND DIGITS, EXACTLY, and that
 * single property is the whole safety argument. A match therefore still means
 * every letter and digit of the span occurs in the document in that order, with
 * nothing inserted, deleted or substituted — so no word, digit, negation or unit
 * can differ between the claim's span and the document. Case is NOT folded:
 * "no" and "No" are different words in a disclosure, and a model that changed one
 * has changed the document.
 *
 * This is a widening of what counts as the same CHARACTER, never of what counts
 * as the same WORD. There is no similarity score here and there must never be
 * one.
 *
 * ================================================================
 * WHY THE OFFSET IS MAPPED BACK
 * ================================================================
 *
 * The match runs against the collapsed projection, but what is STORED is the
 * corresponding slice of the ORIGINAL text, recovered through an index map. Two
 * reasons, both learned from the amount extractor: the evidence a human reviews
 * has to be the document's own bytes rather than this module's tidied version of
 * them, and an offset that cannot be resliced is provenance that survives review
 * without meaning anything.
 */

import {
  ALL_REPAIRS,
  canonicalise,
  canonicalSpan,
  type CanonRepairs,
} from './span-canon';

/** Where a span was found, and what the source actually says there. */
export interface SpanMatch {
  /** Index into the ORIGINAL document text. */
  readonly offset: number;
  /**
   * The original text at that offset, whitespace and all. This is what is
   * stored and shown, never the caller's version of it.
   */
  readonly evidence: string;
}

/** Shortest span that can be evidence for anything. */
export const MIN_SPAN_CHARS = 12;

/**
 * The longest span kept as evidence.
 *
 * A bound rather than a preference: the span is persisted on the filing, echoed
 * into the dashboard, and may reach a Telegram message, where an unbounded quote
 * from a PDF can push the whole alert past the 4,096-character limit — which
 * discards the message rather than truncating it.
 */
export const MAX_SPAN_CHARS = 400;

/**
 * Finds a span in a document, or reports that it is not there.
 *
 * NEVER THROWS and never guesses. Returns null for an absent span, for a span
 * too short to be evidence of anything, and for an empty document — three
 * different ways of having nothing, all of which mean the claim is discarded.
 *
 * The FIRST occurrence wins. A repeated sentence is the same sentence, and
 * choosing among duplicates would be this module inventing a preference the
 * document does not express.
 *
 * `repairs` exists so the measurement tool can attribute each recovery to the
 * rule that made it, and for no other reason: every caller in the service takes
 * the default.
 */
export function findVerbatimSpan(
  documentText: string,
  span: string,
  repairs: CanonRepairs = ALL_REPAIRS,
): SpanMatch | null {
  const needle = canonicalSpan(span, repairs);
  if (needle.length < MIN_SPAN_CHARS) return null;
  if (needle.length > MAX_SPAN_CHARS) return null;

  // No empty-document guard, deliberately. A needle is at least
  // MIN_SPAN_CHARS long and `''.indexOf(x)` is -1 for every non-empty x, so a
  // guard here would be a branch no input can distinguish from the ordinary
  // miss below — and an unreachable branch is a claim nobody can check.
  const haystack = canonicalise(documentText, repairs);
  const at = haystack.text.indexOf(needle);
  if (at === -1) return null;

  const start = haystack.origin[at];
  // The character AFTER the last matched one, in original coordinates. Taken
  // from the next entry in the map rather than by adding the needle's length,
  // because the projected and original lengths differ by exactly what the
  // projection removed.
  const lastIndex = at + needle.length - 1;
  const after =
    lastIndex + 1 < haystack.origin.length
      ? haystack.origin[lastIndex + 1]
      : documentText.length;
  // At least one source character, because a ligature expands to two projected
  // characters that share one source index — so a span ending on the first half
  // of one would otherwise reslice to nothing.
  const end = Math.max(after, haystack.origin[lastIndex] + 1);

  return { offset: start, evidence: documentText.slice(start, end) };
}

/**
 * Whether a span is present at all, ignoring where.
 *
 * The predicate the gate actually asks. Kept separate from `findVerbatimSpan` so
 * a caller that only needs the yes/no cannot accidentally publish a match it did
 * not check.
 */
export const containsVerbatimSpan = (
  documentText: string,
  span: string,
): boolean => findVerbatimSpan(documentText, span) !== null;
