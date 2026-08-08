import { renderResultsValue } from './results-verify';
import {
  RESULTS_BASIS_LABEL,
  RESULTS_METRIC_LABEL,
  type VerifiedResults,
} from './results.types';

/**
 * The results wire line.
 *
 *     SYMBOL Q1 FY27 (CONSOLIDATED): NET PROFIT ₹3,488.72 MN VS ₹128.78 MN (YOY)
 *          || REVENUE ₹73,977.90 MN VS ₹65,607.59 MN (YOY)
 *
 * ================================================================
 * THE UNIT POLICY, WHICH IS THE ONE REAL DIFFERENCE FROM THE COMPETITOR
 * ================================================================
 *
 * For this exact filing a competitor published:
 *
 *     APOLLO TYRES: Q1 CONS NET PROFIT 3.49B RUPEES VS 129M (YOY)
 *     APOLLO TYRES: Q1 REVENUE 74B RUPEES VS 65.61B (YOY)
 *
 * The document says `₹ Million` and prints `3,488.72`, `128.78`, `73,977.90` and
 * `65,607.59`. Every figure in those two lines has been rescaled and rounded:
 * 3,488.72 million became 3.49B, 128.78 became 129M, 73,977.90 became 74B.
 *
 * This pipeline prints the filer's own token and the filer's own declared scale,
 * and the reason is not fastidiousness. It is that a rescale is a calculation,
 * a calculation can be wrong, and nothing downstream can tell a right one from a
 * wrong one. The same competitor's third line — `Q1 EBITDA MARGIN 11.73% VS
 * 13.32% (YOY)` — is the demonstration: 8.68B over 65.61B is 13.23%, not 13.32%.
 * Two digits transposed, in a figure the filing never printed, on a line about a
 * named listed company. Every figure in a Disclosed results line can be found in
 * the source document by searching for the characters it prints.
 *
 * The one transformation applied is abbreviating the filer's own scale word —
 * `Million` to `MN`, `Crores` to `CR` — which moves no digit and changes no
 * magnitude. It is the same class of change as collapsing whitespace to match a
 * span.
 *
 * ================================================================
 * WHY THE BASIS IS SPELLED OUT AND NEVER ABBREVIATED
 * ================================================================
 *
 * The competitor writes `CONS`. This writes `CONSOLIDATED` and `STANDALONE` in
 * full, in the head of the line where a reader cannot skip it, because the two
 * statements in one filing differ by tens of per cent and confusing them is the
 * single most dangerous error this feature can make. A four-letter abbreviation
 * saves eight characters on a line with three hundred to spare.
 */

/** What separates two figures about the same filing. */
export const RESULTS_SEPARATOR = ' || ';

/**
 * The longest results line that may be composed.
 *
 * A BACKSTOP RATHER THAN A WORKING CONSTRAINT. Five figures of the longest
 * observed shape, the head, and four separators come to about 380 characters, so
 * a line assembled from figures `verifyResults` has accepted always fits. It
 * exists because a message a Telegram client refuses to render is a filing lost,
 * and when it fires it DROPS the tail rather than truncating: half a figure is a
 * different figure.
 */
export const MAX_RESULTS_LINE_CHARS = 700;

const wireCase = (value: string): string =>
  value.replace(/\s+/g, ' ').trim().toUpperCase();

/** One figure, rendered. `NET PROFIT ₹3,488.72 MN VS ₹128.78 MN (YOY)`. */
export const composeResultsFigure = (
  figure: VerifiedResults['figures'][number],
): string =>
  `${RESULTS_METRIC_LABEL[figure.metric]} ` +
  `${renderResultsValue(figure.current, figure.unit)} VS ` +
  `${renderResultsValue(figure.prior, figure.unit)} (YOY)`;

/**
 * Composes the line, or returns null when there is nothing to say.
 *
 * NULL RATHER THAN AN EMPTY STRING, for the reason `claim-line.ts` gives: a bare
 * `SYMBOL Q1 FY27 (CONSOLIDATED):` on the wire reads as a results announcement
 * with no results in it, which is a different fact from having none to announce.
 */
export function composeResultsLine(
  symbol: string,
  results: VerifiedResults,
): string | null {
  const stock = wireCase(symbol);
  if (stock.length === 0) return null;
  const head = `${stock} ${results.period} (${RESULTS_BASIS_LABEL[results.basis]}):`;

  const parts: string[] = [];
  let length = head.length;

  for (const figure of results.figures) {
    const text = composeResultsFigure(figure);
    const cost =
      text.length + (parts.length === 0 ? 1 : RESULTS_SEPARATOR.length);
    if (length + cost > MAX_RESULTS_LINE_CHARS) break;
    parts.push(text);
    length += cost;
  }

  return parts.length === 0 ? null : `${head} ${parts.join(RESULTS_SEPARATOR)}`;
}
