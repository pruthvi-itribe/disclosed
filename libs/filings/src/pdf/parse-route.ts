import { RESULTS_STATEMENT_PATTERN } from '../logic/results-eligibility';
import { forStructuralTest } from '../logic/structural-text';
import {
  basisMarkersIn,
  BASIS_HEADING_REACH,
  DOCLING_BASIS_HEADING_REACH,
} from '../logic/results-basis';

/**
 * Which parser reads a document, decided from what the cheap one already found.
 *
 * ================================================================
 * WHY `pdf-parse` STAYS THE DEFAULT AND DOCLING IS AN ESCALATION
 * ================================================================
 *
 * The parsing spike measured four engines over 38 real filings and the answer
 * was a hybrid, not a replacement. `pdf-parse` reads a typical filing in 0.19 s;
 * Docling takes 59 s on the same document and holds 2.3–7.7 GB resident. For the
 * ~90% of filings that are neither scanned nor results tables, the cheap
 * parser's output is entirely adequate and the expensive one buys nothing.
 *
 * But `pdf-parse` returns NOTHING AT ALL for the 21 scanned PDFs in the live
 * collection — between 2 and 97 characters, median 8, all of it page furniture —
 * and on results filings it mis-attributes the standalone statement to the
 * consolidated heading, which is the single most dangerous error this product
 * can make. Docling recovers 20/20 of the scanned documents with 25/25
 * ground-truth digits verbatim, puts the standalone heading BEFORE its own
 * table, and drops the malformed-number rate on results filings from 3.98% to
 * 0.00%.
 *
 * ================================================================
 * THE ROUTE IS DECIDED AFTER THE CHEAP READ, NOT BEFORE IT
 * ================================================================
 *
 * This is the load-bearing shape of the design and it is worth being explicit
 * about why, because the obvious alternative — route on the category before
 * anything is parsed — is worse in three separate ways.
 *
 *   1. **"Scanned" is a property of the bytes, not of the category.** The 21
 *      scanned filings span eight categories, from `Credit Rating` to `Press
 *      Release`. There is no category rule that finds them. `pdf-parse`
 *      answering with 8 characters IS the detector, and it costs 0.04 s.
 *   2. **The page count comes from the cheap read.** Docling must never see the
 *      640-page annual report — extrapolated at ~40 minutes — and page count is
 *      not knowable from the URL. `pdf-parse` reports `numpages` for free, even
 *      on a document whose text layer is empty.
 *   3. **"Results-bearing" is structural.** `Outcome of Board Meeting` carries
 *      dividend declarations and registered-office changes as well as
 *      statements; only 8.66% of live filings are results-bearing against
 *      11.85% in the category. The document's own row labels and statement
 *      headings say which, and those need the text.
 *
 * So the sequence is: parse cheaply, look at what came back, and escalate only
 * the documents that measurably need it. The cheap read is never wasted — on the
 * ~90% it is the answer, and on the rest it is the routing evidence.
 *
 * ================================================================
 * WHAT HAPPENS WHEN DOCLING IS NOT THERE
 * ================================================================
 *
 * It falls back to `pdf-parse` and RECORDS THAT IT DID. Docling is an optional
 * dependency — a Python service that a deployment may simply not run — and the
 * pipeline must keep working on a machine with no Python at all. A scanned
 * filing then reaches `no-text-layer` exactly as it does today, which is a
 * missing line rather than a wrong one. What must never happen is a filing
 * failing because an optional parser was unreachable, or a filing being read by
 * the fallback without anybody being able to tell afterwards.
 */

/** Which parser produced, or should produce, a document's text. */
export type ParseRoute =
  /** The default. ~90% of traffic, 0.19 s a document. */
  | 'pdf-parse'
  /** Docling with OCR on. For raster scans `pdf-parse` cannot read at all. */
  | 'docling-ocr'
  /**
   * Docling with `do_ocr=False`. For text-layer results filings, where the value
   * is reading order and column alignment rather than character recovery.
   *
   * Measured quality-identical to the OCR run — output differs by well under 1%
   * and the standalone heading lands before its table in both — at a flat
   * 2.3–2.6 GB instead of 4.7–7.7 GB and up to 15x faster (BOSCH-HCIL 24.7 s →
   * 3.96 s). Turning OCR off is what makes the hybrid affordable.
   */
  | 'docling-layout';

export const PARSE_ROUTES: readonly ParseRoute[] = [
  'pdf-parse',
  'docling-ocr',
  'docling-layout',
];

/**
 * Pages above which a scanned document is not sent for OCR.
 *
 * OCR is the expensive configuration: measured at 2.5–4 s a page against
 * layout-only's fraction of that, and holding 3.8–7.4 GB. 40 pages is therefore
 * about 160 seconds, which fits inside the ten-minute lease alongside a fetch
 * and two model calls with room to spare.
 *
 * It costs nothing today: the largest of the 21 live scanned filings is 15
 * pages, so every one of them is inside this bound with 2.6x of headroom. It is
 * a bound on the case that has not arrived yet, set where a single document
 * cannot eat a worker's whole lease.
 */
export const DOCLING_OCR_MAX_PAGES = 40;

/**
 * Pages above which a results filing is not sent to Docling at all.
 *
 * 150, and the number comes from both ends of the measured range. The largest
 * results filing in the spike is POLICYBZR at 129 pages, and it must fit — it is
 * a real Q1 results document, not a pathological case. NHPC's 640-page annual
 * report must not: at the measured per-page rate it extrapolates to ~40 minutes,
 * and the answer for a document like that is the page budget `pdf-parse` already
 * has, not a better parser.
 *
 * 150 clears the largest real results filing by 1.16x and excludes the 640-page
 * case by 4.3x. Between those two there is nothing in the collection.
 */
export const DOCLING_LAYOUT_MAX_PAGES = 150;

/**
 * Characters of text below which a read counts as "no text layer".
 *
 * Deliberately the same judgement `hasUsableTextLayer` makes, and this module
 * takes the answer as an input rather than re-deriving it, so the worker cannot
 * route on one definition of scanned while recording another.
 */

/** What the cheap read produced, and what the filing is. */
export interface ParseRouteInput {
  /** NSE's own category string, unnormalised. */
  readonly category: string;
  /** The document's OWN page count, from `pdf-parse`. */
  readonly pages: number;
  /** The text `pdf-parse` produced. Empty or near-empty for a raster scan. */
  readonly text: string;
  /**
   * Whether `pdf-parse`'s text is usable at all.
   *
   * Passed in rather than measured here so that "this document has no text
   * layer" has exactly one definition in the pipeline — the one the worker uses
   * to record `no-text-layer`.
   */
  readonly hasTextLayer: boolean;
  /** False when no Docling service is configured or it is known to be down. */
  readonly doclingAvailable: boolean;
}

/** The chosen route and the sentence explaining it. */
export interface ParseRouteDecision {
  readonly route: ParseRoute;
  /**
   * Why this route, in words, for the stored provenance.
   *
   * A ROUTE WITHOUT A REASON IS UNAUDITABLE. "This filing was read by
   * pdf-parse" and "this filing was read by pdf-parse because the Docling
   * service was unreachable" are the same state and very different facts, and
   * the second one is how an operator learns the optional dependency has been
   * down for a week.
   */
  readonly reason: string;
  /**
   * The page ceiling to send with the request, when the route is a Docling one.
   *
   * ALWAYS SENT, even though the route is only chosen when the page count is
   * already inside it. Docling's `max_num_pages` REJECTS an over-long document
   * rather than truncating it — `ConversionError: Document has 640 pages,
   * exceeding the max_num_pages limit of 40` — so truncation has to go through
   * `page_range`, and a page count `pdf-parse` under-reported would otherwise
   * turn a long filing into a hard failure instead of a partial read.
   */
  readonly maxPages: number | null;
}

/**
 * Whether a document looks like it carries a statutory results statement.
 *
 * The same two structural tests `results-eligibility.ts` applies, and they are
 * imported rather than restated: a row label a Regulation 33 statement is
 * required to print, and a consolidated or standalone statement heading. A
 * covering letter announcing that results were approved has neither, and it is
 * that distinction — not the category — that separates the 8.66% of live filings
 * worth the expensive parser from the 11.85% in the category.
 */
export function looksLikeResultsStatement(documentText: string): boolean {
  // THE SAME PROJECTION `results-eligibility.ts` READS THROUGH, and sharing it
  // is the point rather than a convenience. These two ask the same question at
  // two moments — "should this document get the layout parser" and "is this
  // document worth extracting results from" — and when they disagreed the
  // failure was circular: a document whose cheap text is mangled was refused
  // for having no row labels AND denied the parser that would have unmangled
  // it. GKENERGY sat in exactly that loop, and `hasUsableTextLayer` could not
  // rescue it either, because that test counts non-space characters and 22,708
  // characters of garbage passes it.
  const structural = forStructuralTest(documentText);
  return (
    RESULTS_STATEMENT_PATTERN.test(structural) &&
    basisMarkersIn(structural).length > 0
  );
}

/**
 * Categories whose documents are PROSE ABOUT results rather than a statement of
 * them, and which must therefore never be escalated for table alignment.
 *
 * THIS IS NOT THE CATEGORY ROUTING THIS MODULE ARGUES AGAINST ABOVE, and the
 * distinction is the whole justification. That argument is that a category
 * cannot FIND results filings — only 8.66% of live filings carry a statement
 * against 11.85% in the category, so the document's own structure has to
 * decide. This is the inverse: a small set of categories that can be ruled OUT
 * before reading, because an earnings-call transcript is not a Regulation 33
 * statement no matter what it quotes.
 *
 * It exists because ESAF Small Finance Bank's earnings call was escalated to
 * Docling and then produced nothing at all. The transcript DISCUSSES results,
 * so it carries the row labels and the basis markers `looksLikeResultsStatement`
 * looks for, and the structural test cannot tell a table from a person reading
 * one aloud. The escalation then bought nothing — there is no column alignment
 * to fix in dialogue — while inflating the text from 31,923 characters to
 * 51,180, and the claims call came back with empty content on a document that
 * answered fine from the cheap parser's text.
 *
 * So the cost of the false positive is not "a slower read". It is 60% more
 * input tokens, spent to make an extraction fail.
 */
const NEVER_A_STATEMENT =
  /\b(con\.?\s*call|conference call|earnings call|analysts?\s*\/|investor meet|transcript)\b/i;

export const carriesNoStatement = (category: string): boolean =>
  NEVER_A_STATEMENT.test(category);

const decide = (
  route: ParseRoute,
  reason: string,
  maxPages: number | null = null,
): ParseRouteDecision => ({ route, reason, maxPages });

/**
 * Which parser should read this document, given what the cheap one found.
 *
 * PURE, and never throws. Takes no clock, no network and no service handle, so
 * every routing rule in this pipeline is decidable from a table of inputs — the
 * whole point of putting the decision here rather than inside the worker's
 * fetch loop.
 *
 * The order of the tests is the policy:
 *
 *   1. **No Docling, no escalation.** Stated first so the degraded path is the
 *      one branch nothing else can shadow.
 *   2. **Scanned wins over results.** JKIL's board-meeting outcome is both a
 *      results filing and a raster scan; without OCR there is no text for the
 *      layout pass to align, so OCR is not optional there.
 *   3. **Then results, then nothing.**
 *
 * The page bound is checked INSIDE each branch rather than once at the top,
 * because the two routes have different ceilings for different reasons — OCR is
 * an order of magnitude more expensive per page than layout-only — and one
 * shared bound would either starve the cheap route or blow the lease on the
 * expensive one.
 */
/**
 * How far above its column header a statement title may sit, for this route.
 *
 * THE MAPPING LIVES HERE rather than in `results-basis.ts` because the route
 * vocabulary is this module's, and `results-basis.ts` must not learn about
 * parsers — it would be a cycle, and the two constants are justified by
 * measurements of *text*, not of routing.
 *
 * A wrong answer here is the most dangerous thing in this file. Reading Docling
 * markdown with the `pdf-parse` bound refuses 74 of 77 measured tables; reading
 * `pdf-parse` output with the Docling bound admits pairings that module measured
 * as false at 936 and up. So the two must be selected by the route that actually
 * produced the text, which is why `RoutedRead.route` is stored rather than
 * inferred.
 */
export const basisReachFor = (route: ParseRoute): number =>
  route === 'pdf-parse' ? BASIS_HEADING_REACH : DOCLING_BASIS_HEADING_REACH;

export function routeAfterFirstRead(
  input: ParseRouteInput,
): ParseRouteDecision {
  const { pages, text, hasTextLayer, doclingAvailable } = input;

  if (!doclingAvailable) {
    return decide(
      'pdf-parse',
      'no Docling service is available, so the cheap parser is the only reader',
    );
  }

  if (!hasTextLayer) {
    if (pages > DOCLING_OCR_MAX_PAGES) {
      return decide(
        'pdf-parse',
        `the document has no text layer but is ${pages} pages, over the ` +
          `${DOCLING_OCR_MAX_PAGES}-page ceiling for an OCR read`,
      );
    }
    return decide(
      'docling-ocr',
      `the document has no text layer, so ${pages} page(s) go to Docling with OCR`,
      DOCLING_OCR_MAX_PAGES,
    );
  }

  // Checked AFTER the scan branch, deliberately. A transcript delivered as a
  // raster scan still has no text for anything to read, and OCR is not optional
  // there — this rules out the table-alignment escalation, not character
  // recovery.
  if (looksLikeResultsStatement(text) && !carriesNoStatement(input.category)) {
    if (pages > DOCLING_LAYOUT_MAX_PAGES) {
      return decide(
        'pdf-parse',
        `the document carries a results statement but is ${pages} pages, over ` +
          `the ${DOCLING_LAYOUT_MAX_PAGES}-page ceiling for a Docling read`,
      );
    }
    return decide(
      'docling-layout',
      'the document carries a results statement, so it is re-read by Docling ' +
        'with OCR off for reading order and column alignment',
      DOCLING_LAYOUT_MAX_PAGES,
    );
  }

  return decide(
    'pdf-parse',
    'the document has a text layer and carries no results statement',
  );
}
