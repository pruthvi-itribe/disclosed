import { hasAmbiguityKeyword } from './ambiguity';
import {
  findEventPhraseEnds,
  findLabelWindows,
  isPhraseAnchored,
  LabelWindow,
} from './amount-anchors';
import { findUnitScaleHeaders, hasValueBand } from './amount-hazards';
import { RupeeMatch, scanBareAmounts, scanRupeeAmounts } from './rupee-parse';

/**
 * The monetary-amount extractor.
 *
 * ONE RULE GOVERNS THIS MODULE: never emit a wrong number. These figures go
 * into alerts and public posts about named listed companies, where a 1,000x
 * scale error is not a bug but a defamation-adjacent harm. A refusal is a
 * successful outcome; a wrong figure is not recoverable by any downstream
 * check, because nothing downstream can tell a right number from a wrong one.
 *
 * Everything here therefore resolves ties by refusing. The extractor returns a
 * figure only when the document says it once, says it in a place that declares
 * what it means, and says it in a form whose scale is not in question.
 */

export type AmountRefusalReason =
  /** Conditional or rumour language: the event itself is not confirmed. */
  | 'ambiguity-keyword'
  /** A table header re-denominates figures; which ones is not knowable. */
  | 'unit-scaled-header'
  /** The anchored positions disagree about the value. */
  | 'multiple-candidates'
  /** The filer published a band, not a figure. */
  | 'range-only'
  /** Nothing was stated in a position that declares what it means. */
  | 'no-candidate'
  /** The chosen figure could not be traced back to the source text. */
  | 'verbatim-mismatch';

export type AmountAnchor = 'sebi-label' | 'covering-letter';

/** Everything a human or a later pipeline stage needs to audit the figure. */
export interface AmountProvenance {
  /** Which of the two permitted positions the figure was read from. */
  readonly anchor: AmountAnchor;
  /** The Schedule III row label, verbatim, when the anchor is a label. */
  readonly label: string | null;
  /**
   * The exact substring of the document that carries the figure. Slicing the
   * source at `offset` for this length reproduces it byte for byte.
   */
  readonly evidence: string;
  readonly offset: number;
}

export interface ExtractedAmount {
  readonly outcome: 'extracted';
  /** Normalised to rupees. */
  readonly rupees: number;
  readonly provenance: AmountProvenance;
}

export interface RefusedAmount {
  readonly outcome: 'refused';
  readonly reason: AmountRefusalReason;
  /** Why, in terms a human reviewing the filing can check. */
  readonly detail: string;
}

export type AmountExtraction = ExtractedAmount | RefusedAmount;

export interface AmountExtractionInput {
  /** Text extracted from the filing's attachment. */
  readonly documentText: string;
  /**
   * The filing's NSE category, e.g. "Bagging/Receiving of orders/contracts".
   *
   * Carried for the caller's context and deliberately NOT used as a gate. It is
   * tempting to allow a document-wide scan for order wins and refuse it for
   * investor presentations, but that trades a structural guarantee for a
   * string comparison against a vocabulary NSE controls and periodically
   * renames — the reason libs/filings already needs a taxonomy module. The
   * anchors below hold whatever the category says, and on the labelled corpus
   * they refuse every investor presentation without being told what one is.
   */
  readonly category: string;
  /** The one-line NSE summary, which carries its own conditional language. */
  readonly summary: string;
}

interface Candidate extends RupeeMatch {
  readonly anchor: AmountAnchor;
  readonly label: string | null;
}

const refuse = (
  reason: AmountRefusalReason,
  detail: string,
): RefusedAmount => ({ outcome: 'refused', reason, detail });

/**
 * Figures inside one labelled disclosure row.
 *
 * A currency-marked figure is always preferred. The marker-less fallback exists
 * because two sampled filings write the consideration with no marker at all,
 * but it is only consulted when the row states nothing marked — otherwise
 * BSE's row, which reads `₹ 50.50 Crores towards acquisition of 50,00,00,000
 * equity shares`, would contribute the share COUNT as a rival figure and the
 * row would be refused for a disagreement that does not exist.
 */
function candidatesInWindow(window: LabelWindow): readonly Candidate[] {
  const marked = scanRupeeAmounts(window.text);
  const found = marked.length > 0 ? marked : scanBareAmounts(window.text);
  return found.map((match) => ({
    ...match,
    start: window.start + match.start,
    anchor: 'sebi-label' as const,
    label: window.label,
  }));
}

/**
 * Figures in the covering letter that an event phrase names as the value of the
 * event. Used only when the document carries no Schedule III row at all.
 */
function coveringLetterCandidates(text: string): readonly Candidate[] {
  const phraseEnds = findEventPhraseEnds(text);
  if (phraseEnds.length === 0) return [];
  return scanRupeeAmounts(text)
    .filter((match) => isPhraseAnchored(phraseEnds, match.start))
    .map((match) => ({
      ...match,
      anchor: 'covering-letter' as const,
      label: null,
    }));
}

/**
 * Re-derives the value from the evidence alone and checks the evidence is
 * genuinely a substring of the source at the offset claimed.
 *
 * This is the last line of defence and it is deliberately redundant with the
 * scan that produced the candidate: an offset arithmetic error while shifting a
 * window-relative index to an absolute one would otherwise ship provenance
 * pointing at the wrong part of the document, which is worse than no
 * provenance at all — it would survive human review.
 */
export function isTraceableEvidence(
  documentText: string,
  provenance: Pick<AmountProvenance, 'evidence' | 'offset'>,
  rupees: number,
): boolean {
  const { evidence, offset } = provenance;
  if (documentText.slice(offset, offset + evidence.length) !== evidence) {
    return false;
  }
  const reread = [
    ...scanRupeeAmounts(evidence),
    ...scanBareAmounts(evidence),
  ].map((match) => match.rupees);
  return reread.includes(rupees);
}

const distinct = (candidates: readonly Candidate[]): readonly number[] => [
  ...new Set(candidates.map((candidate) => candidate.rupees)),
];

const describeValues = (values: readonly number[]): string =>
  values.map((value) => value.toString()).join(', ');

/**
 * Reads the one figure this filing is about, or explains why it will not.
 *
 * Refusal order is significant. Ambiguity is checked first because a
 * conditional event has no confirmed value to report however clearly the
 * document states a number, and the scale-header guard is checked before the
 * agreement guard because a mis-scaled figure that happens to be the only
 * candidate would otherwise sail through.
 */
export function extractMaterialAmount(
  input: AmountExtractionInput,
): AmountExtraction {
  const { documentText, summary } = input;

  if (documentText.trim().length === 0) {
    return refuse('no-candidate', 'the attachment carries no extractable text');
  }

  // Run over the PDF text, not only the summary. The one-line summary is
  // boilerplate; the document is where "Letter of Intent", "subject to" and
  // "L1 bidder" actually appear, and they change the answer.
  if (hasAmbiguityKeyword(documentText) || hasAmbiguityKeyword(summary)) {
    return refuse(
      'ambiguity-keyword',
      'the filing uses conditional or rumour language, so the event is not confirmed',
    );
  }

  const labelWindows = findLabelWindows(documentText);
  const candidates =
    labelWindows.length > 0
      ? labelWindows.flatMap(candidatesInWindow)
      : coveringLetterCandidates(documentText);

  if (candidates.length === 0) {
    return hasValueBand(documentText)
      ? refuse(
          'range-only',
          'the filer published a value band rather than a figure',
        )
      : refuse(
          'no-candidate',
          labelWindows.length > 0
            ? 'the disclosure row states no figure'
            : 'no figure is stated in a position that declares what it means',
        );
  }

  // A unit-less figure takes its scale entirely from its surroundings, so a
  // document that re-denominates ANY of its tables can silently re-denominate
  // this one. A figure that names its own unit cannot be moved this way and is
  // left alone. Refuse rather than multiply: nothing in the text says which
  // table a given figure belongs to.
  const scaleHeaders = findUnitScaleHeaders(documentText);
  if (scaleHeaders.length > 0 && candidates.some((c) => !c.carriesUnit)) {
    return refuse(
      'unit-scaled-header',
      `the document re-denominates figures ("${scaleHeaders[0]}") and the candidate states no unit of its own`,
    );
  }

  const values = distinct(candidates);
  if (values.length > 1) {
    return refuse(
      'multiple-candidates',
      `the anchored positions disagree: ${describeValues(values)}`,
    );
  }

  if (hasValueBand(documentText)) {
    return refuse(
      'range-only',
      'the document publishes a value band, so a point value cannot be attributed',
    );
  }

  const chosen = candidates[0];
  const provenance: AmountProvenance = {
    anchor: chosen.anchor,
    label: chosen.label,
    evidence: chosen.text,
    offset: chosen.start,
  };
  if (!isTraceableEvidence(documentText, provenance, chosen.rupees)) {
    return refuse(
      'verbatim-mismatch',
      'the figure could not be traced back to an exact substring of the source',
    );
  }

  return { outcome: 'extracted', rupees: chosen.rupees, provenance };
}
