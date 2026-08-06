import { matchesOf } from './regex-matches';

/**
 * Which sentence a character offset falls inside.
 *
 * ================================================================
 * WHY A SENTENCE, AND WHY IT HAS TO BE BOUNDED
 * ================================================================
 *
 * `ambiguity.ts` splits its patterns by the scope over which they are evidence.
 * Rumour framing is a property of the FILING; conditional framing —
 * `subject to`, `letter of intent`, `L1` — is a property of the SENTENCE that
 * states a figure. Deciding the second one needs a way to ask "what sentence is
 * this figure in", and that is all this module does.
 *
 * ================================================================
 * THE MEASUREMENTS EVERYTHING BELOW IS BUILT ON
 * ================================================================
 *
 * The corpus is 645 real documents: the 585 live filings enrichment refused for
 * `ambiguity-keyword` whose attachments NSE served and `pdf-parse` could read,
 * plus the 60-filing committed amount corpus. Within them, 6,762 positions
 * where a rupee figure was found.
 *
 *     a conditional phrase somewhere in the same DOCUMENT      98.0% of positions
 *     a conditional phrase in the same SENTENCE (unbounded)     1.8% of positions
 *     distance from a figure to the nearest conditional phrase  p10 1,126 chars
 *                                                              median 8,216 chars
 *
 * Sentence scope is therefore about fifty times more discriminating than
 * document scope, and the reason is not subtle: the phrase that made the old
 * check fire is typically eight thousand characters away from the figure it was
 * being held against.
 *
 * ================================================================
 * WHAT `pdf-parse` OUTPUT DOES TO THE RULES
 * ================================================================
 *
 * It is not prose, and three of its habits shape every rule below.
 *
 *   1. **A full stop is usually not a sentence end.** `Rs. 78.24 Crore`,
 *      `No. 5`, `Pvt. Ltd.`, `M/s. XYZ` — the abbreviation forms outnumber real
 *      sentence ends near a rupee figure, and splitting on one of them cuts the
 *      figure away from the words that qualify it. That is the DANGEROUS
 *      direction: a sentence cut too short hides the `letter of intent` that
 *      makes the figure conditional and the extractor emits it.
 *   2. **A single newline is a line wrap, not a break.** PDF text layers wrap
 *      mid-sentence constantly, so `\n` cannot end a sentence for the same
 *      reason. A BLANK line can, and does: it is what separates a covering
 *      letter's paragraphs and what `pdf-parse` puts between pages.
 *   3. **The punctuation that exists can be very far away.** Every one of the
 *      6,762 positions is bounded by punctuation somewhere in both directions —
 *      but the "sentence" that punctuation delimits measures mean 479
 *      characters, median 319, p90 982, p95 1,485, p99 2,865 and max 4,487.
 *      Schedule III disclosures are tables (label, value, label, value, one per
 *      line) and legal recitals run for pages without a full stop, so the
 *      nearest real boundary can be most of a page away. A 4,487-character
 *      "sentence" is not a statement about a figure; it is a slab of the
 *      document, and testing conditional framing across one reinstates the very
 *      over-refusal this module exists to remove.
 *
 * So the bound is a rule about what a sentence IS, not a safety net for a
 * pathological input. It is argued from measurement at `SENTENCE_REACH_CHARS`.
 *
 * EVERY OTHER AMBIGUITY HERE RESOLVES TOWARDS THE WIDER SPAN, because a span
 * that is too wide costs a refusal and a span that is too narrow emits a figure
 * the document conditioned. That is the same asymmetry `amount-extraction.ts`
 * is built on, applied one level down.
 */

/** A sentence, located in the text it was read from. */
export interface SentenceSpan {
  /** Index of the first character, in the source text's coordinates. */
  readonly start: number;
  /** One past the last character, in the same coordinates. */
  readonly end: number;
  /** The source's own bytes between `start` and `end`. */
  readonly text: string;
}

/**
 * How far either side of an offset a sentence may reach.
 *
 * 800 characters, and the number is the KNEE of a measured curve rather than a
 * taste. Over the 6,762 figure positions described above, sweeping the bound
 * and counting how many of them carry a conditional phrase inside the span:
 *
 *     bound    positions flagged    of what unbounded scope flags    sentences returned whole
 *       400          88                        71.5%                          84.7%
 *       600         114                        92.7%                          93.2%
 *       800         120                        97.6%                          95.7%
 *     1,200         123                       100.0%                          98.1%
 *
 * 400 to 600 recovers 26 positions, 600 to 800 recovers 6, and 800 to 1,200
 * recovers 3 while letting the span grow by half again. The curve is flat after
 * 800, so that is where the bound goes.
 *
 * THE DIRECTION OF THE ERROR IS WHY THE KNEE IS TAKEN FROM THE FAR SIDE. A span
 * too narrow misses a phrase that genuinely qualifies the figure and the
 * extractor emits a conditioned number; a span too wide costs a refusal, which
 * this pipeline treats as a successful outcome. So the bound is the largest
 * value that keeps the span recognisably local — 1,601 characters at most,
 * against a p95 real sentence of 1,485 — rather than the smallest that works.
 *
 * IT IS NOT LOAD-BEARING FOR THE HEADLINE RESULT, and that is worth stating
 * plainly: re-running the live measurement end to end at 200, 300, 400, 600,
 * 800 and 1,200 produced the SAME verdict for all 585 documents every time. The
 * bound decides how far a planted phrase can sit from a figure and still be
 * seen, not what this corpus happens to say.
 *
 * Symmetric, because `pdf-parse` flattens a two-column layout into one stream
 * and a qualifying clause can land either side of the figure it qualifies.
 */
export const SENTENCE_REACH_CHARS = 800;

/**
 * A blank line: the one whitespace form that ends a sentence in PDF text.
 *
 * A SINGLE `\n` is deliberately not here. `pdf-parse` wraps a sentence across
 * lines whenever the source PDF did, so treating one newline as a break would
 * separate `has received a Letter of Intent` from the figure two lines below it.
 */
const PARAGRAPH_BREAK = /\n[^\S\n]*\n\s*/g;

/**
 * A terminator followed by whitespace, with any closing quote or bracket that
 * belongs to the sentence being closed.
 *
 * Whether the match is REALLY a sentence end is decided by `endsSentence`; this
 * only finds the candidates.
 */
const TERMINATOR = /([.?!])(["'’”)\]]*)(\s+)/g;

/**
 * Tokens that take a full stop without ending a sentence.
 *
 * Drawn from the measured corpus rather than from a general English list: the
 * entries that matter here are the ones that appear immediately before a rupee
 * figure in an Indian filing. `Rs.` alone accounts for more full stops adjacent
 * to a candidate than every real sentence end combined, and splitting on it
 * would cut every `emerged as L1 bidder for a project of Rs. 500 crore` into a
 * clause that no longer says `L1`.
 *
 * Over-inclusion is the safe direction — an entry that is not really an
 * abbreviation only ever widens a sentence — so ordinary words that double as
 * filing abbreviations (`no`, `co`, `re`, `sub`) are kept.
 */
const ABBREVIATIONS: ReadonlySet<string> = new Set([
  // Currency, quantity and the units that surround a figure.
  'rs',
  'inr',
  'cr',
  'crs',
  'lac',
  'lacs',
  'lakh',
  'lakhs',
  'mn',
  'bn',
  'no',
  'nos',
  'qty',
  'approx',
  'sq',
  // Company forms, which sit inside a counterparty's name.
  'ltd',
  'pvt',
  'inc',
  'co',
  'corp',
  'llp',
  'm/s',
  'govt',
  // Honorifics and offices, which precede a signatory's name.
  'mr',
  'mrs',
  'ms',
  'dr',
  'sh',
  'smt',
  'shri',
  'sri',
  'prof',
  'jr',
  'sr',
  // Document furniture: references, sub-headings, cross-references.
  'ref',
  'sub',
  're',
  'dt',
  'dtd',
  'viz',
  'etc',
  'vs',
  'sec',
  'reg',
  'para',
  'cl',
  'vol',
  'pg',
  'st',
  'ext',
  'fig',
  'tel',
  'ph',
  // Months, which end a date rather than a sentence.
  'jan',
  'feb',
  'mar',
  'apr',
  'jun',
  'jul',
  'aug',
  'sep',
  'sept',
  'oct',
  'nov',
  'dec',
]);

/** Characters a preceding token may be built from. */
const TOKEN_CHARACTER = /[A-Za-z0-9/]/;

const ALL_DIGITS = /^[0-9]+$/;
const SINGLE_LETTER = /^[A-Za-z]$/;
const LOWERCASE = /^[a-z]$/;

/**
 * Whether a terminator really ends a sentence.
 *
 * `?` and `!` always do — no Indian filing abbreviates with either. A full stop
 * is refused in four cases, each of which was observed adjacent to a candidate
 * figure in the measured corpus:
 *
 *   - nothing precedes it but whitespace. A full stop alone on a line is what an
 *     OCR text layer produces from `Rs. 847 Crore`, not a sentence end.
 *   - a single letter precedes it: an initial, as in `A. K. Sharma`.
 *   - the token is a known abbreviation.
 *   - the next non-space character is lower case, which no sentence starts with.
 *
 * A purely numeric token DOES end a sentence: `1.` is a numbered clause and
 * `2026.` is a date ending one, and both are real breaks. A decimal point never
 * reaches here, because `78.24` has no whitespace after the stop.
 */
function endsSentence(
  window: string,
  markIndex: number,
  nextIndex: number,
): boolean {
  if (window[markIndex] !== '.') return true;

  let scan = markIndex - 1;
  while (scan >= 0 && TOKEN_CHARACTER.test(window[scan])) scan -= 1;
  const token = window.slice(scan + 1, markIndex);

  if (token.length === 0) return false;
  if (ALL_DIGITS.test(token)) return true;
  if (SINGLE_LETTER.test(token)) return false;
  if (ABBREVIATIONS.has(token.toLowerCase())) return false;

  const next = window[nextIndex];
  return next === undefined || !LOWERCASE.test(next);
}

/**
 * One place a sentence ends and the next begins.
 *
 * The two indices differ by the whitespace between the sentences, which belongs
 * to neither: `at` is one past the last character of the sentence being closed,
 * `next` is the first character of the one being opened.
 */
interface Boundary {
  readonly at: number;
  readonly next: number;
}

/** Every boundary inside a window, in the order they occur. */
function boundariesIn(window: string): readonly Boundary[] {
  const found: Boundary[] = [];

  for (const match of matchesOf(window, TERMINATOR)) {
    // Group 2 is `*`-quantified, so it always participates and is never
    // undefined. No fallback: a guard no input can reach is a claim nobody can
    // check, and it would read as though a match could arrive without it.
    const at = match.index + 1 + match[2].length;
    const next = match.index + match[0].length;
    if (endsSentence(window, match.index, next)) found.push({ at, next });
  }

  for (const match of matchesOf(window, PARAGRAPH_BREAK)) {
    found.push({ at: match.index, next: match.index + match[0].length });
  }

  return found.sort((left, right) => left.at - right.at);
}

/**
 * The sentence containing `offset`.
 *
 * NEVER THROWS and always returns a span containing the offset when the text is
 * non-empty: an offset outside the text is clamped into it, so a caller cannot
 * be handed an empty quote for a figure it just found. An empty text returns an
 * empty span, which is the only case where `start === end`.
 *
 * @param reach the per-side character bound. Defaults to
 *   `SENTENCE_REACH_CHARS`; a caller passing its own is measuring, not tuning.
 */
export function sentenceAt(
  text: string,
  offset: number,
  reach: number = SENTENCE_REACH_CHARS,
): SentenceSpan {
  if (text.length === 0) return { start: 0, end: 0, text: '' };

  const anchor = Math.min(Math.max(offset, 0), text.length - 1);
  const floor = Math.max(0, anchor - reach);
  const ceiling = Math.min(text.length, anchor + reach + 1);

  // Scanned over the window rather than the document: the bound already decides
  // the answer outside it, and a 66,000-character filing would otherwise be
  // re-scanned once per candidate.
  const window = text.slice(floor, ceiling);
  const local = anchor - floor;
  const boundaries = boundariesIn(window);

  let start = 0;
  let end = window.length;
  for (const boundary of boundaries) {
    // `next <= local` rather than `at <= local`, so an offset sitting in the
    // whitespace between two sentences is read as belonging to the one that
    // follows it rather than to an empty span.
    if (boundary.next <= local) start = boundary.next;
    if (boundary.at > local) {
      end = boundary.at;
      break;
    }
  }

  return {
    start: floor + start,
    end: floor + end,
    text: window.slice(start, end),
  };
}
