import { actionPhraseFor } from './action-phrase';

/**
 * One line saying what happened, for EVERY filing.
 *
 * ================================================================
 * WHY THIS IS DETERMINISTIC AND NOT A MODEL CALL
 * ================================================================
 *
 * The requirement is universal coverage: every enriched filing states an
 * outcome, not the 29% that survived a category allowlist. A model call cannot
 * deliver that, and the reason is not cost — at DeepSeek prices a call on every
 * filing is under a dollar a day. It is that **a model call can fail**. The
 * provider returns a truncated reply, a 429, a body that will not parse; the
 * live runs behind `gate-and-attachments-report.md` saw 3 of 8 calls fail in one
 * session and 0 of 8 in another. Coverage that depends on a network call is
 * coverage with a bad afternoon in it, and "every filing produces an outcome"
 * would quietly become "most of them do".
 *
 * So the outcome is built from what this pipeline already holds with certainty
 * before anything is fetched: the exchange's own summary line and its category.
 * It is available for a filing whose PDF is a raster scan, whose attachment URL
 * is NSE's `"-"` sentinel, and whose model call failed — three populations that
 * together are 3.2% of the live collection and produced nothing at all before.
 *
 * The model's contribution is kept where it belongs: `documentSummary` is model
 * prose about the document, marked unverified, and the claims are the verbatim
 * -gated sentences. Those ADD to the outcome; they are not what makes it exist.
 *
 * ================================================================
 * WHAT NSE'S SUMMARY ACTUALLY CONTAINS, MEASURED
 * ================================================================
 *
 * All 17,442 filings in the 32-day corpus carry a non-empty `summary`, and it is
 * written to a template: `<Company> has informed the Exchange <about|regarding|
 * that> <rest>`. 89.3% match that lead exactly.
 *
 * The value is entirely in `<rest>`, and it is bimodal. **72.82% of summaries
 * say something the category does not** —
 *
 *     "Record date for the purpose of Buyback is 18-Aug-2026."
 *     "the financial results for the period ended Jun 30, 2026."
 *     "Appointment of Mr. Manish Mehta as Senior Management Personnel w.e.f.
 *      August 05, 2026."
 *
 * — and **27.18% restate the category and nothing else**: "...has informed the
 * Exchange about Credit Rating". Whole categories are 100% boilerplate
 * (`Investor Presentation` 533/533, `Credit Rating` 153/153,
 * `Resignation of Director/KMP/SMP` 213/213) and whole categories are almost
 * entirely informative (`Updates` 1,161/1,183).
 *
 * That split is not a nuisance to be smoothed over — it is the honest signal,
 * and it is what `source` reports. A reader must be able to tell "the exchange
 * said a record date was set for a buyback on 18 August" from "the exchange said
 * this is a credit rating filing", because only one of them is news.
 *
 * ================================================================
 * WHOSE WORDS THESE ARE
 * ================================================================
 *
 * NSE'S, and that is the whole point of the confidence tier this feeds. The
 * outcome is not a claim this pipeline makes and not prose a model wrote: it is
 * the exchange's own sentence, trimmed of its template and bounded. It carries
 * the strongest provenance available short of a verbatim span from the document,
 * and it is the reason `stated` sits above `labelled` and below `verified`.
 *
 * It is still NOT alertable. See `confidence-tier.ts`.
 */

/** Where an outcome's words came from. */
export type OutcomeSource =
  /**
   * The exchange's own summary, which said something the category does not.
   * 72.82% of the corpus.
   */
  | 'exchange-summary'
  /**
   * The summary restated the category and nothing more, so the outcome is the
   * category. 27.18% of the corpus. An honest floor rather than a failure.
   */
  | 'category';

export interface FilingOutcome {
  /** One bounded line. Always non-empty. */
  readonly text: string;
  readonly source: OutcomeSource;
}

/**
 * How much of the exchange's sentence is kept.
 *
 * 200 characters. The corpus's summaries run to 500 and the longest 65 of them
 * are recitals of a scheme of arrangement's parties; 200 covers 98.9% of them
 * whole and leaves the rest readable. This is a dashboard column, not a wire
 * line, so it is bounded for layout rather than for a message-size limit.
 */
export const MAX_OUTCOME_CHARS = 200;

/**
 * NSE's template lead.
 *
 * Written as one pattern with alternatives rather than several, because the
 * variants are the same sentence: `has informed the Exchange about`,
 * `has submitted to the Exchange, the`, `has informed the Exchange regarding`,
 * `has intimated the Exchange that`. The trailing connective is optional
 * because `... has informed the Exchange Trading Window closure...` occurs
 * without one.
 *
 * NOT ANCHORED TO A COMPANY NAME LIST. Matching `^.*?` up to the verb is what
 * makes this work for a company whose registered name this pipeline has never
 * seen, which is every newly listed one.
 */
const SUMMARY_LEAD =
  /^.*?\bhas\s+(?:informed|submitted|intimated|inform|submitte?d)\s+(?:to\s+)?the\s+exchanges?\b[,:]?\s*(?:about|regarding|that|of|on|the)?\s*/i;

const CONTROL_CHARACTERS = /\s+/g;

/** Whitespace collapsed, quotes and trailing punctuation trimmed. */
const tidy = (value: string): string =>
  value
    .replace(CONTROL_CHARACTERS, ' ')
    .trim()
    .replace(/^['"“”‘’]+|['"“”‘’.,;:]+$/g, '')
    .trim();

const comparable = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * Whether what the exchange wrote adds anything to the category.
 *
 * Compared on letters and digits alone, so `ESOP/ESOS/ESPS` and `ESOP ESOS
 * ESPS` are the same string, and containment rather than equality because NSE
 * writes both `Copy of Newspaper Publication` and the shorter `Newspaper
 * Publication` against the same category.
 *
 * Exported because it is the measurement that decided this module's design and
 * a reader of the report should be able to run it.
 */
export function restatesCategory(rest: string, category: string): boolean {
  const left = comparable(rest);
  const right = comparable(category);
  if (left.length === 0) return true;
  return left === right || right.includes(left);
}

/**
 * The outcome line for one filing.
 *
 * NEVER THROWS and never returns an empty string. A filing with a blank summary
 * and a category this pipeline has no action phrase for still yields
 * `SYMBOL — CATEGORY`, which is what the alert has always said and is exactly as
 * true as it was before this module existed.
 *
 * The symbol leads because the dashboard sorts and filters by it, and because a
 * line that begins with a company's ticker is scannable in a column of two
 * thousand.
 */
export function composeOutcome(filing: {
  readonly symbol: string;
  readonly category: string;
  readonly summary: string;
}): FilingOutcome {
  const symbol = tidy(filing.symbol).toUpperCase();
  const category = tidy(filing.category);
  const summary = tidy(filing.summary ?? '');

  const rest = tidy(summary.replace(SUMMARY_LEAD, ''));

  if (rest.length > 0 && !restatesCategory(rest, category)) {
    return {
      text: `${symbol}: ${rest}`.slice(0, MAX_OUTCOME_CHARS),
      source: 'exchange-summary',
    };
  }

  // The floor. `actionPhraseFor` turns a category into a verb where this
  // pipeline knows one — "BAGS ORDER" rather than "BAGGING/RECEIVING OF
  // ORDERS/CONTRACTS" — and falls back to the exchange's own label where it does
  // not. Either way the line says what KIND of thing happened, which is all the
  // exchange itself said.
  const phrase = actionPhraseFor(category);
  return {
    text: (phrase === null
      ? `${symbol} — ${category.toUpperCase()}`
      : `${symbol} ${phrase}`
    ).slice(0, MAX_OUTCOME_CHARS),
    source: 'category',
  };
}
