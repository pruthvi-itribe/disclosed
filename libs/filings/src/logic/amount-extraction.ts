import {
  conditionalFramingIn,
  hasConditionalFraming,
  hasRumourFraming,
} from './ambiguity';
import {
  findEventPhraseEnds,
  findLabelWindows,
  isPhraseAnchored,
  LabelWindow,
} from './amount-anchors';
import { findUnitScaleHeaders, hasValueBand } from './amount-hazards';
import { RupeeMatch, scanBareAmounts, scanRupeeAmounts } from './rupee-parse';
import { sentenceAt } from './sentence-scope';

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
  /**
   * The event is not confirmed: the filing restates a news report, or the
   * sentence stating every candidate figure conditions it.
   *
   * ONE REASON FOR BOTH, deliberately. They are the same verdict about the
   * filing — "there is no settled number here" — and a dashboard that split
   * them would be reporting on which pattern list fired rather than on what a
   * reviewer has to decide. The `detail` names the scope, the phrase and, for a
   * conditional refusal, the sentence it fired on.
   */
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

/** A candidate dropped because its own sentence conditions it, and the proof. */
interface ConditionedCandidate {
  /** The phrase that fired, exactly as the document spells it. */
  readonly phrase: string;
  /** The sentence it fired in, unbounded — `quote` shortens it at the edge. */
  readonly sentence: string;
}

const refuse = (
  reason: AmountRefusalReason,
  detail: string,
): RefusedAmount => ({ outcome: 'refused', reason, detail });

/**
 * How much of a filing's own text a refusal detail may quote.
 *
 * The detail is the whole product of a refusal, so it has to carry enough of
 * the sentence for a reviewer to agree or disagree without opening the PDF —
 * `safeEcho`'s 32 characters would truncate "extended subject to necessary" to
 * a fragment that proves nothing. Bounded all the same, because the source is
 * an exchange-supplied document and the destination is a stored record and a
 * log line.
 */
export const MAX_SENTENCE_QUOTE_CHARS = 160;

/** A stretch of a filing, made safe and short enough to embed in a detail. */
const quote = (text: string): string =>
  text.replace(/\s+/g, ' ').trim().slice(0, MAX_SENTENCE_QUOTE_CHARS);

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
 * ================================================================
 * REFUSAL ORDER IS PART OF THE DESIGN, AND AMBIGUITY IS NOW IN TWO PLACES
 * ================================================================
 *
 * The document-wide checks run first, because they are verdicts about the
 * FILING that no figure can rescue: a filing restating a news item has no
 * company-stated number in it anywhere, and an exchange summary that conditions
 * the event says so about the only event the filing has.
 *
 * CONDITIONAL FRAMING IN THE DOCUMENT RUNS LAST, AFTER THE CANDIDATES ARE
 * FOUND, and moving it there is the point of this arrangement. Tested against
 * the whole document it refused 590 live filings, because `subject to` is
 * boilerplate — "subject to shareholder approval", "subject to applicable
 * taxes" — and appears in filings whose disclosure row states an entirely
 * settled consideration. Tested against the sentence a candidate was read from,
 * 33 of those 590 are still refused and 541 are refused for what was always the
 * real reason: they carry no candidate figure at all. `ambiguity.ts` argues the
 * split; `sentence-scope.ts` argues what a sentence is in PDF text, and
 * `tools/extraction/measure-ambiguity-scope.ts` is where those counts come
 * from.
 *
 * The remaining order is unchanged: the scale-header guard is checked before
 * the agreement guard because a mis-scaled figure that happens to be the only
 * candidate would otherwise sail through.
 */
export function extractMaterialAmount(
  input: AmountExtractionInput,
): AmountExtraction {
  const { documentText, summary } = input;

  if (documentText.trim().length === 0) {
    return refuse('no-candidate', 'the attachment carries no extractable text');
  }

  // Run over the PDF text as well as the summary. Rumour framing is a property
  // of the whole filing: if the exchange asked for a clarification about a news
  // item, every figure in the document is a journalist's number.
  if (hasRumourFraming(documentText) || hasRumourFraming(summary)) {
    return refuse(
      'ambiguity-keyword',
      'the filing restates an unverified news report, so no figure in it is the company’s own',
    );
  }

  // The summary is one line and it is directly about the event, so there is no
  // figure to scope conditional framing to and nothing to gain by waiting: a
  // summary that says "emerged as L1 bidder" has already said the event is not
  // settled, whatever the attachment goes on to state.
  if (hasConditionalFraming(summary)) {
    return refuse(
      'ambiguity-keyword',
      `the exchange summary conditions the event: "${quote(summary)}"`,
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

  // Each candidate answers for its OWN sentence. A figure the document
  // conditions is dropped rather than refusing the filing, because a filing can
  // state a settled consideration in its disclosure row and mention an
  // unrelated letter of intent three paragraphs later — and under the old
  // document-wide test the second sentence silently vetoed the first.
  //
  // Refusing only when EVERY candidate is dropped keeps the guarantee intact in
  // the direction that matters: a figure is never emitted from a clause that
  // conditions it, and a filing whose only figures are conditional is still
  // refused rather than quietly reported as having none.
  const admitted: Candidate[] = [];
  const conditioned: ConditionedCandidate[] = [];
  for (const candidate of candidates) {
    const sentence = sentenceAt(documentText, candidate.start).text;
    const phrase = conditionalFramingIn(sentence);
    if (phrase === null) admitted.push(candidate);
    else conditioned.push({ phrase, sentence });
  }

  if (admitted.length === 0) {
    const [{ phrase, sentence }] = conditioned;
    return refuse(
      'ambiguity-keyword',
      `the sentence stating the figure conditions it ("${phrase}"): "${quote(sentence)}"`,
    );
  }

  // A unit-less figure takes its scale entirely from its surroundings, so a
  // document that re-denominates ANY of its tables can silently re-denominate
  // this one. A figure that names its own unit cannot be moved this way and is
  // left alone. Refuse rather than multiply: nothing in the text says which
  // table a given figure belongs to.
  const scaleHeaders = findUnitScaleHeaders(documentText);
  if (scaleHeaders.length > 0 && admitted.some((c) => !c.carriesUnit)) {
    return refuse(
      'unit-scaled-header',
      `the document re-denominates figures ("${scaleHeaders[0]}") and the candidate states no unit of its own`,
    );
  }

  const values = distinct(admitted);
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

  const chosen = admitted[0];
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
