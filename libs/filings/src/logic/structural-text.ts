/**
 * The projection a STRUCTURAL test reads a document through.
 *
 * ================================================================
 * WHY THIS EXISTS
 * ================================================================
 *
 * `pdf-parse` does not always emit a line of a PDF as a line. On some documents
 * it emits one WORD per line, and the whole class of tests that ask "does this
 * document say `total income`" then answers no about a document that plainly
 * does.
 *
 * GKENERGY's board-meeting outcome (seqId 106730500) is the measured case. Its
 * text layer is 22,708 characters carrying 1,495 `" \n"` pairs, and it holds two
 * complete Regulation 33 statements — `Revenue from operations 5,051.92`,
 * `Total income 5,086.36`, standalone and consolidated. `pdf-parse` renders the
 * row label as `"Total \nincome"`, `RESULTS_STATEMENT_PATTERN` wants a literal
 * space, and the filing was refused with "the document states none of a results
 * statement's row labels".
 *
 * THE CASCADE IS THE WORSE HALF. `parse-route.ts` reuses the same pattern to
 * decide whether a document deserves the layout parser, so a document whose
 * cheap text is mangled can never earn the parser that would unmangle it. And
 * `hasUsableTextLayer` cannot catch it either — that test counts non-space
 * characters, and 22,708 characters of garbage passes it comfortably. The
 * document falls between both escalation routes and lands as a filing that
 * produced nothing.
 *
 * Measured over the collection: 124 filings carry that exact refusal, and 19 of
 * them (15.3%) become eligible on whitespace alone — 15 board-meeting outcomes,
 * 2 investor presentations, a press release and an integrated filing, including
 * ASAHIINDIA, NAVINFLUOR, RAIN and TRANSRAILL.
 *
 * ================================================================
 * WHY IT IS A PROJECTION AND NOT A REWRITE
 * ================================================================
 *
 * THE STORED DOCUMENT MUST NOT CHANGE. `claim-span.ts`, `governingBasis` and
 * the results column-header logic all index by character offset INTO
 * `documentText`; substituting a normalised string as the document would shift
 * every one of those offsets and quietly relocate the evidence a claim is
 * verified against. So this is used ONLY by the boolean structural tests — "is
 * this row label present at all" — and never as the text anything is quoted
 * from or measured into.
 *
 * That boundary is the entire safety argument for this module, and it is why
 * the function is named for the question it answers rather than for what it
 * does to the string.
 */

/**
 * Collapses every run of whitespace to a single space.
 *
 * Deliberately the smallest possible transformation. It does NOT lowercase —
 * the callers' patterns are already case-insensitive — and it does not touch
 * punctuation, ligatures or digits, because each of those is a different
 * failure with different evidence and folding them together here would make one
 * knob that nobody can reason about. Whitespace is the one defect measured to
 * account for this class.
 */
export const forStructuralTest = (documentText: string): string =>
  documentText.replace(/\s+/g, ' ');
