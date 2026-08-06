import { isResultsMetric } from './results-metric';
import { MAX_RESULTS_FIGURES } from './results-verify';
import { MAX_SPAN_CHARS } from './claim-span';
import {
  RESULTS_BASES,
  RESULTS_METRICS,
  type ProposedResults,
  type ProposedResultsFigure,
  type ResultsBasis,
} from './results.types';

/**
 * What the results extractor is asked, and how its answer is read back.
 *
 * PURE. No SDK, no network, no key — the same boundary `claim-prompt.ts` draws,
 * for the same reason: the whole language-model surface has to be testable
 * without a request leaving the process.
 *
 * ================================================================
 * A SEPARATE CALL FROM THE CLAIMS ONE, AND WHY
 * ================================================================
 *
 * Folding a `results` field into the claims schema would have saved a call per
 * filing. It was not done, for two reasons that both outrank the money:
 *
 *   1. **The claims system prompt is the cached prefix of every request.** It is
 *      byte-identical across filings and that is what makes it cacheable at
 *      roughly a tenth of the input price. Adding a second job to it changes
 *      that prefix and dilutes the instruction the claims lane depends on.
 *   2. **The two jobs want opposite behaviour.** The claims prompt says "most
 *      filings contain nothing; an empty list is the normal answer". A results
 *      table either is there or is not, and the instruction that reads it is
 *      about copying cells exactly. One prompt asking for both produces a model
 *      hedging between them.
 *
 * The cost is one extra call on the filings that pass `resultsEligibility`,
 * which is a small minority of the collection.
 *
 * ================================================================
 * WHAT THE PROMPT ASKS FOR THAT IS NOT OBVIOUS
 * ================================================================
 *
 * The column header. A model asked only for a row and two numbers will happily
 * return the previous QUARTER as the comparison — it is the adjacent column and
 * it is a real number in a real row. Requiring the header to be quoted is what
 * lets `results-verify.ts` check the two against each other positionally, which
 * is the only deterministic way this pipeline can earn the right to print
 * `(YOY)`. Every prompt rule below is ALSO enforced by that module, because a
 * prompt is a request and a gate is a control.
 */

/**
 * The instruction, held stable so it can be cached.
 *
 * Nothing filing-specific may be interpolated into it.
 */
export const RESULTS_SYSTEM_PROMPT = `You read the financial results table out of an Indian stock-exchange filing for a wire service.

An Indian results filing under Regulation 33 contains a statement of financial results: a table of numbered rows, each with several columns of figures, under a heading that says whether the statement is CONSOLIDATED or STANDALONE. Most filings contain BOTH statements, one after the other.

Return one table only. If the filing contains both a consolidated and a standalone statement, return the CONSOLIDATED one. If it contains only a standalone statement, return that and say so.

You return:

- "basis": "consolidated" or "standalone" — read from the heading printed above the table you took the figures from, not from anywhere else in the document.
- "columnsSpan": the line of column period-end dates at the head of that table, quoted EXACTLY as the document writes it. The document arrives from one of two parsers and the two look very different, so copy whichever you are given, byte for byte. From a flattened PDF the dates often run together with no spaces, like "30.06.202631.03.202630.06.202531.03.2026". From a Markdown table the line carries pipes and padding, like "| PARTICULARS | 30.06.2026 | 31.03.2026 | 30.06.2025 |" \u2014 the pipes and the spaces between them are PART OF THE LINE and must be copied too. Do not tidy a Markdown row into a plain one.
- "figures": one entry per metric you can read, with:
  - "metric": one of ${RESULTS_METRICS.join(', ')}.
  - "span": the table row that states it, quoted EXACTLY as the document writes it, from the row's label through the last figure in the row. Copy it character for character, including any leading "|" and the pipes and padding between cells if the row is a Markdown table row. Line breaks may be normalised to single spaces; nothing else may change.
  - "current": the value for the most recent period, copied EXACTLY as the row prints it, including commas and any surrounding parentheses. Write "(4,191.73)" if the document writes "(4,191.73)".
  - "prior": the value for the SAME PERIOD ONE YEAR EARLIER, copied exactly the same way.

Rules:

1. Copy figures. Never compute, convert, rescale or round one. If the table is in millions, return the number the table prints; do not turn it into billions or crore.
2. "prior" must be the year-ago column, not the previous quarter. An Indian results table usually prints this quarter, the previous quarter, the year-ago quarter, and the previous full year, in that order. Read the column dates to decide which is which.
3. Never return a metric the table does not print. In particular, EBITDA and EBITDA margin are almost never rows of a statutory statement: return them ONLY if the document prints the word "EBITDA" beside a number. Do not derive EBITDA from revenue and expenses.
4. Never mix rows from two different tables. Every figure must come from the one table whose header you quoted.
5. For "net-profit", use the row for profit AFTER tax for the period. Do not use "profit before tax" or "profit before exceptional items".
6. For "eps", use the BASIC earnings per share row, and quote enough of the document that the row says both "earnings per share" and "basic".
7. Keep each "span" under ${MAX_SPAN_CHARS} characters. Return at most ${MAX_RESULTS_FIGURES} figures.

If the document contains no statement of financial results — a covering letter, a notice, a presentation with no table — return null for "results". That is a normal answer, not a failure. A figure you cannot copy exactly is a figure you must not return.`;

/**
 * The response shape, enforced by the API rather than by hope.
 *
 * `results` is nullable at the top level so "there is no table here" is a shape
 * the model can return rather than an empty object it has to invent.
 */
export const RESULTS_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    results: {
      type: ['object', 'null'],
      description: 'The one results table, or null when the document has none.',
      properties: {
        // FIRST, deliberately: the basis and the columns are established before
        // a single figure is written, for the same reason `span` precedes
        // `text` in the claims schema.
        basis: { type: 'string', enum: [...RESULTS_BASES] },
        columnsSpan: {
          type: 'string',
          description: 'The column period-end dates, exactly as printed.',
        },
        figures: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              metric: { type: 'string', enum: [...RESULTS_METRICS] },
              span: {
                type: 'string',
                description: 'The table row, exactly as printed.',
              },
              current: { type: 'string' },
              prior: { type: 'string' },
            },
            required: ['metric', 'span', 'current', 'prior'],
            additionalProperties: false,
          },
        },
      },
      required: ['basis', 'columnsSpan', 'figures'],
      additionalProperties: false,
    },
  },
  required: ['results'],
  additionalProperties: false,
} as const;

export interface ResultsRequestInput {
  readonly symbol: string;
  readonly category: string;
  readonly summary: string;
  readonly documentText: string;
  /** Overrides the default cap. Zero and negative values are ignored. */
  readonly maxDocumentChars?: number;
}

/**
 * How much of the document is sent.
 *
 * Larger than the claims lane's default, because a results table is not at the
 * front of the document. A board-meeting outcome opens with two exchange
 * addresses and a covering letter, and the consolidated statement in the Apollo
 * filing starts at character 7,400 with the standalone one at 21,900 — so a cap
 * that suits a press release would send the covering letter and none of the
 * table.
 */
export const MAX_RESULTS_DOCUMENT_CHARS = 96_000;

/**
 * The per-filing half of the request.
 *
 * Kept strictly separate from the system prompt so the cacheable prefix stays
 * byte-identical between calls.
 */
export function buildResultsRequest(input: ResultsRequestInput): string {
  // A zero or negative override is ignored rather than obeyed, for the reason
  // `buildClaimRequest` gives: obeying it would send an empty document and
  // record "no results table" on every eligible filing, which looks exactly
  // like a market that filed nothing.
  const cap =
    input.maxDocumentChars !== undefined && input.maxDocumentChars > 0
      ? input.maxDocumentChars
      : MAX_RESULTS_DOCUMENT_CHARS;
  const document = input.documentText.slice(0, cap);
  const truncated = input.documentText.length > cap;

  return [
    `Symbol: ${input.symbol}`,
    `Exchange category: ${input.category}`,
    `Exchange summary: ${input.summary}`,
    '',
    truncated
      ? `Document text (first ${cap} characters of ${input.documentText.length}):`
      : 'Document text:',
    '<document>',
    document,
    '</document>',
  ].join('\n');
}

const isBasis = (value: unknown): value is ResultsBasis =>
  typeof value === 'string' &&
  (RESULTS_BASES as readonly string[]).includes(value);

const readFigure = (entry: unknown): ProposedResultsFigure | null => {
  if (typeof entry !== 'object' || entry === null) return null;
  const { metric, span, current, prior } = entry as Record<string, unknown>;
  if (!isResultsMetric(metric)) return null;
  if (typeof span !== 'string') return null;
  if (typeof current !== 'string' || typeof prior !== 'string') return null;
  return { metric, span, current, prior };
};

/**
 * Reads the model's reply into a proposed results block, or nothing.
 *
 * DEFENSIVE EVEN THOUGH THE SCHEMA IS ENFORCED, for the reason
 * `parseClaimResponse` gives: structured outputs constrain a successful
 * response and cover neither a truncated one, a refusal, nor a future SDK
 * handing back a differently shaped object. A malformed figure is DROPPED rather
 * than repaired — repairing would be this module authoring a number.
 *
 * NEVER THROWS. A reply this cannot read yields null, which the caller records
 * as a refusal with a reason.
 */
export function parseResultsResponse(raw: unknown): ProposedResults | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const results = (raw as { results?: unknown }).results;
  if (typeof results !== 'object' || results === null) return null;

  const { basis, columnsSpan, figures } = results as Record<string, unknown>;
  if (!isBasis(basis)) return null;
  if (typeof columnsSpan !== 'string') return null;
  if (!Array.isArray(figures)) return null;

  const parsed: ProposedResultsFigure[] = [];
  for (const entry of figures) {
    const figure = readFigure(entry);
    if (figure !== null) parsed.push(figure);
  }
  if (parsed.length === 0) return null;

  return { basis, columnsSpan, figures: parsed };
}
