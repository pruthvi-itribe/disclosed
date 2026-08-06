import type { ResultsBasis } from './results.types';

/**
 * Deciding, from the document alone, whether a table is consolidated or
 * standalone.
 *
 * ================================================================
 * THE ERROR THIS MODULE EXISTS TO MAKE IMPOSSIBLE
 * ================================================================
 *
 * A results filing carries both statements. Apollo Tyres' Q1 FY27 outcome prints
 * consolidated revenue of ₹73,977.90 million at character 7,900 and standalone
 * revenue of ₹54,618.69 million at character 21,900 — same row label, same
 * column header, same units, 35% apart. A model reading either row will state a
 * basis, and a model that states the wrong one produces a line that is fluent,
 * well-formed, correctly quoted, and a wrong number about a named listed
 * company.
 *
 * So the extractor's answer is never taken. It is treated as a CLAIM about the
 * document, and this module produces an independent answer from the document's
 * own headings; `results-verify.ts` publishes only when the two agree. Two
 * independent readings that must coincide is the only structure available here
 * that turns "the model said so" into evidence.
 *
 * ================================================================
 * WHAT COUNTS AS A HEADING, AND WHY IT IS ANCHORED TO THE COLUMNS
 * ================================================================
 *
 * A basis marker is the word `consolidated` or `standalone` written within
 * `BASIS_HEADING_CONTEXT` characters of the word `result`. That is what a
 * statement title looks like in every real filing measured — `UNAUDITED
 * CONSOLIDATED FINANCIAL RESULTS`, `CONSOLIDATED RESULTS`, `Statement of
 * Unaudited Standalone Financial Results` — and it excludes the word appearing
 * loose in a note about consolidation policy.
 *
 * The marker is then matched against the TABLE'S COLUMN HEADER, not against the
 * row. This is the load-bearing choice and it was made from a measurement:
 * `pdf-parse` does not emit a page in reading order, and in the Apollo document
 * the standalone statement's rows appear BEFORE its own title in the flattened
 * stream, with a consolidated note sitting between. Nearest-preceding-marker
 * from the ROW therefore answers "consolidated" for a standalone row — the exact
 * failure this module exists to prevent.
 *
 * Anchoring to the column header instead, with a short reach, asks a different
 * and answerable question: *does a statement title sit immediately above this
 * table's own column header?* For the consolidated table the title is 78
 * characters above it; for the mis-ordered standalone table the nearest marker
 * is 3,260 characters away and the answer is **nothing is close enough to say**,
 * which refuses the block. A missed table is a line nobody sees. A mislabelled
 * one is the harm.
 */

/** How far from the word `result` a basis word still reads as a heading. */
export const BASIS_HEADING_CONTEXT = 40;

/**
 * How far above a table's column header its statement title may sit.
 *
 * 400 characters, and the number sits in a MEASURED GAP rather than at a round
 * one. Across 16 live results filings, all 34 column-date lines were paired with
 * the nearest basis marker above them, and the distances are bimodal:
 *
 *     a title that really governs the table   54, 64, 75, 78, 108, 115, 117,
 *                                             119, 143, 164
 *     anything else `pdf-parse` left above    936, 1054, 1156, 1303, 1320,
 *                                             1616, 1935, 1953, 2101, 2258,
 *                                             2747, 2824, 3474, 6247, 11655,
 *                                             12291, 16117, 17058, 19521
 *
 * There is nothing at all between 164 and 936. A real statement title is separated from
 * its own column header by the "for the quarter ended" line and the units
 * declaration and nothing else; everything past a thousand characters is a
 * covering letter, a note, or another statement's title that the flattening
 * moved. 400 clears the real pairings by 2.4x and excludes the nearest false one
 * by 2.3x, which is the widest a bound can be and still answer the question this
 * module exists to answer.
 *
 * The failure it accepts is a coverage one: BRITANNIA's Q1 FY27 statement was
 * refused because the header the extractor quoted has its nearest marker 936
 * characters above it — while a DIFFERENT header line in the same document sits
 * 117 characters below a real title. A missed table is a line nobody sees. A
 * mislabelled one is the harm.
 *
 * THIS NUMBER IS A PROPERTY OF `pdf-parse`'s OUTPUT, NOT OF FILINGS. See
 * `DOCLING_BASIS_HEADING_REACH` below for why that matters now.
 */
export const BASIS_HEADING_REACH = 400;

/**
 * The same bound, for text Docling produced.
 *
 * ================================================================
 * WHY THE BOUND HAD TO BE RETUNED RATHER THAN REUSED OR DELETED
 * ================================================================
 *
 * 400 was measured against `pdf-parse` output, where the distances are bimodal —
 * real pairings at 54-164, everything else at 936 and beyond, nothing between.
 * Docling emits markdown: pipes, cell padding, and repeated column headers, so
 * the SAME real pairing is physically further from its heading. Measured over 14
 * live results filings converted by `docling-serve` with `do_ocr=false`, 77
 * column-header table rows paired with the nearest statement heading above them:
 *
 *     385, 397, 399, 405, 413, 446, 478, 484, 487, 488, 498, 506, 511, 520,
 *     533, 533, 536, 549, 549, 582, 598, 598, 636, 642, 642, 650, 693, 768,
 *     795, 905, 919, 919, 925, 985, 1000, 1063, 1063, 1226, 1290, 1478, 1699,
 *     1719, 1815, 1983, 2046, 2174, 2262, 2370, | 2948, 2974, 3237, ...
 *
 * **At 400 exactly three of those 77 are reachable.** Apollo Tyres' consolidated
 * header sits 478 characters below its title and its standalone header 598 —
 * so keeping the `pdf-parse` number would refuse the very tables this routing
 * exists to read correctly, and the hybrid would make results coverage WORSE
 * while looking like an upgrade.
 *
 * 2,400 sits in the widest gap available below 3,000: the distribution above
 * runs continuously to 2,370 and then jumps 578 characters to 2,948. It clears
 * the furthest genuine primary-statement pairing measured — COFFEEDAY's
 * standalone header at 1,478 — by 1.6x, and it still excludes the annexures
 * that no statement heading governs at all: Apollo's debt-service-coverage
 * tables at 26,994 and 30,321, Edelweiss's public-issue table at 25,115,
 * Cohance's at 26,605.
 *
 * WHAT THE BOUND IS FOR HAS CHANGED, AND IT IS KEPT ANYWAY. Under `pdf-parse`
 * it was what stood between the pipeline and a mislabelled statement, because
 * the nearest preceding heading was often the wrong one. Under Docling the
 * nearest preceding heading is the right one — that is the entire reason to pay
 * fifty times the parse cost. So this is now a cheap assertion that the document
 * still looks the way results filings look, and it earns its place on the
 * annexure cases above, where a table sits under no heading and would otherwise
 * inherit one from tens of thousands of characters away. Removing it costs a
 * wrong number about a named listed company; keeping it costs a missed line.
 */
export const DOCLING_BASIS_HEADING_REACH = 2_400;

/**
 * How close an opposing basis word makes the heading ambiguous.
 *
 * Real covering letters say `Un-audited Financial Results (Standalone and
 * Consolidated)` and `results (consolidated & standalone)`. Both words are
 * genuine markers by the rule above, they are 15 characters apart, and a
 * nearest-preceding rule would silently pick whichever came second. A heading
 * that names both statements governs neither, so it refuses.
 */
export const BASIS_AMBIGUITY_CHARS = 120;

/** How much of the document is kept as evidence around a heading. */
export const MAX_BASIS_EVIDENCE_CHARS = 160;
const BASIS_EVIDENCE_PAD = 30;

/** One statement heading, located in the document. */
export interface BasisMarker {
  readonly offset: number;
  readonly basis: ResultsBasis;
  /** Exactly as the document writes it. */
  readonly raw: string;
}

/**
 * `consolidated` or `standalone` with `result` in its neighbourhood, either side.
 *
 * Two lookarounds rather than one pattern with a gap, because the word can
 * precede its noun (`consolidated financial results`) or follow it
 * (`Financial Results (Standalone`), and both spellings appear in the corpus.
 */
const BASIS_WORD = /\b(consolidated|standalone)\b/gi;
const NEAR_RESULT = /result/i;

// A total function over the two words the pattern can match, rather than a
// lookup with an unreachable fallback: a branch no input can reach is a claim
// nobody can check, and the compiler still refuses anything outside the union.
const basisOf = (word: string): ResultsBasis =>
  word.toLowerCase() === 'standalone' ? 'standalone' : 'consolidated';

/**
 * Every statement heading in a document, in the order written.
 *
 * NEVER THROWS. A document with no results table returns an empty list.
 */
export function basisMarkersIn(
  documentText: string,
  context: number = BASIS_HEADING_CONTEXT,
): readonly BasisMarker[] {
  const markers: BasisMarker[] = [];
  for (const match of documentText.matchAll(BASIS_WORD)) {
    const from = Math.max(0, match.index - context);
    const to = Math.min(
      documentText.length,
      match.index + match[0].length + context,
    );
    if (!NEAR_RESULT.test(documentText.slice(from, to))) continue;
    markers.push({
      offset: match.index,
      basis: basisOf(match[0]),
      raw: match[0],
    });
  }
  return markers;
}

export type GoverningBasis =
  | {
      readonly outcome: 'ok';
      readonly basis: ResultsBasis;
      readonly evidence: string;
    }
  | { readonly outcome: 'none'; readonly detail: string };

/**
 * The basis of the table whose column header starts at `headerOffset`.
 *
 * Returns `none` — never a guess — when no heading is within reach, and when the
 * nearest one is contradicted by an opposing heading beside it. Both are
 * refusals of the whole results block, which is the point: a table whose basis
 * this pipeline cannot establish has nothing publishable in it.
 */
export function governingBasis(
  documentText: string,
  headerOffset: number,
  reach: number = BASIS_HEADING_REACH,
): GoverningBasis {
  const markers = basisMarkersIn(documentText);
  const reachable = markers.filter(
    (marker) =>
      marker.offset <= headerOffset && headerOffset - marker.offset <= reach,
  );

  if (reachable.length === 0) {
    return {
      outcome: 'none',
      detail:
        `no consolidated or standalone statement heading appears in the ` +
        `${reach} characters above the table's column header`,
    };
  }

  const nearest = reachable[reachable.length - 1];
  const opposing = markers.find(
    (marker) =>
      marker.basis !== nearest.basis &&
      Math.abs(marker.offset - nearest.offset) <= BASIS_AMBIGUITY_CHARS,
  );
  if (opposing !== undefined) {
    return {
      outcome: 'none',
      detail:
        `the nearest heading names both statements ` +
        `("${nearest.raw}" and "${opposing.raw}" within ` +
        `${BASIS_AMBIGUITY_CHARS} characters), so it governs neither`,
    };
  }

  const evidence = documentText
    .slice(
      Math.max(0, nearest.offset - BASIS_EVIDENCE_PAD),
      Math.min(
        documentText.length,
        nearest.offset + nearest.raw.length + BASIS_EVIDENCE_PAD,
      ),
    )
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_BASIS_EVIDENCE_CHARS);

  return { outcome: 'ok', basis: nearest.basis, evidence };
}
