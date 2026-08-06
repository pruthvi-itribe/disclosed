import { matchesOf } from './regex-matches';

/**
 * Where the material figure is allowed to be read from.
 *
 * The alternative — "the largest rupee figure in the document" — is unsafe on
 * real filings, and measurably so. In the sampled corpus that rule returns a
 * total-addressable-market slide statistic for an investor deck, an authorised
 * share capital for an acquisition, and a full-year order-book total for a
 * press release whose subject line states the actual new-order value. Every one
 * of those is a confidently wrong number about a named listed company.
 *
 * So a figure is only ever read from a position that DECLARES what it means:
 *
 *   1. a SEBI LODR Schedule III disclosure row, whose label is mandated and
 *      therefore reproduced near-verbatim by filers, or
 *   2. the covering letter's own statement of the event, in the first pages,
 *      where the phrase before the figure names it as the consideration.
 *
 * Anything else is refused.
 */

/**
 * Schedule III Part A(B) — order and contract wins. Present in two thirds of
 * sampled order-wins, with the figure always inside the following row.
 *
 * Whitespace between every token is `\s*` rather than `\s+`: PDF text
 * extraction both stretches the gaps ("Broad   consideration   or   size") and
 * removes them entirely ("Broadconsiderationorsizeof"), sometimes in the same
 * corpus. "commercial" is optional because roughly a fifth of filers use the
 * older wording "Broad commercial consideration".
 */
const ORDER_SIZE_LABEL =
  /(?:broad\s*)?(?:commercial\s*)?consideration\s*(?:or|and)\s*size\s*of\s*(?:the\s*)?order/gi;

/**
 * Schedule III Part A(A)(1) — acquisitions. The consideration lives in this row
 * rather than in a subject line, because acquisition covering letters lead with
 * the stake, not the price.
 */
const ACQUISITION_COST_LABEL =
  /cost\s*of\s*acquisition\s*(?:and\s*\/\s*or|and|or)\s*(?:the\s*)?price\s*at\s*which\s*the\s*shares\s*are\s*acquired/gi;

const LABELS: readonly RegExp[] = [ORDER_SIZE_LABEL, ACQUISITION_COST_LABEL];

/**
 * How much text after the label belongs to the labelled field.
 *
 * Measured, not guessed: across the sampled filings that carry the label, the
 * figure sits within ~150 characters of it, and the row that follows is always
 * a yes/no answer about promoter interest or related-party status. 260 leaves
 * headroom for the label's own `(s)/contract(s) (in INR);` tail and for the
 * doubled spacing that PDF extraction inserts, without reaching a row that
 * could contribute a competing figure.
 */
export const LABEL_WINDOW_CHARS = 260;

/** A labelled disclosure row: the label matched, and the text that follows it. */
export interface LabelWindow {
  /** The label text exactly as the document spells it. */
  readonly label: string;
  /** Offset of the window's first character in the source document. */
  readonly start: number;
  readonly text: string;
}

/** Every Schedule III disclosure row this module knows how to read. */
export function findLabelWindows(text: string): readonly LabelWindow[] {
  const windows: LabelWindow[] = [];
  for (const label of LABELS) {
    // Each pattern is global and shared, so its lastIndex must not leak between
    // documents — matchAll clones the regex internally and leaves it untouched.
    for (const match of matchesOf(text, label)) {
      const start = match.index + match[0].length;
      windows.push({
        label: match[0].replace(/\s+/g, ' ').trim(),
        start,
        text: text.slice(start, start + LABEL_WINDOW_CHARS),
      });
    }
  }
  return windows.sort((a, b) => a.start - b.start);
}

/**
 * How far into the document the covering letter reaches.
 *
 * For every sampled press-release-layout order win the figure is on page 1 or
 * page 2. Beyond that a document stops being a covering letter and becomes an
 * annexure, a results table or a slide deck, where a figure near a matching
 * phrase is as likely to be a market-size statistic as the event value.
 */
export const HEADLINE_SCAN_CHARS = 4_000;

/**
 * How far a figure may sit behind the phrase that names it.
 *
 * Long enough for `New Orders worth\nRs. 1,063 Crores` after PDF line breaks,
 * short enough that the phrase and the figure are unmistakably one statement.
 */
export const PHRASE_REACH_CHARS = 60;

/**
 * Phrases that state what the figure IS. They are deliberately specific.
 *
 * The distinction they have to draw is inside a single KEC press release, which
 * says both "has secured new orders of Rs. 1,063 crores" — the event — and "our
 * YTD order intake stands at over Rs. 6,300 crore" — a running total that is
 * six times larger and would be a spectacular over-report. Only the first form
 * names the figure as the consideration for what was just announced.
 */
const EVENT_PHRASES: readonly string[] = [
  'orders?\\s+worth',
  'orders?\\s+of',
  'order\\s+value\\s+of',
  'contract\\s+(?:price|value)\\s+of',
  'aggregate\\s+value\\s+of',
  'total\\s+value\\s+of',
  'consideration\\s+of',
  'amounting\\s+to',
  'letter\\s+of\\s+acceptance\\s+of',
];

const EVENT_PHRASE_PATTERN = new RegExp(`(?:${EVENT_PHRASES.join('|')})`, 'gi');

/** Offsets, within the leading window, where an event phrase ends. */
export function findEventPhraseEnds(text: string): readonly number[] {
  const leading = text.slice(0, HEADLINE_SCAN_CHARS);
  const ends: number[] = [];
  for (const match of matchesOf(leading, EVENT_PHRASE_PATTERN)) {
    ends.push(match.index + match[0].length);
  }
  return ends;
}

/** True when some event phrase ends within reach of a figure at `start`. */
export const isPhraseAnchored = (
  phraseEnds: readonly number[],
  start: number,
): boolean =>
  phraseEnds.some((end) => start >= end && start - end <= PHRASE_REACH_CHARS);
