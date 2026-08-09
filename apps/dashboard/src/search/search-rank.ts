import type { PipelineStage } from 'mongoose';
import { normaliseQuery, toTextSearch } from './search-terms';

/**
 * The ranking rule for a free-text search, expressed as aggregation stages.
 *
 * ================================================================
 * THE RULE, AND WHY IT IS THIS ONE
 * ================================================================
 *
 *   0  the query IS the ticker
 *   1  the query appears in the company's name
 *   2  the text index matched something the filing SAYS
 *
 * The tiers are about CERTAINTY OF INTENT, not about relevance. A reader who
 * typed `LUPIN` named a company — a ticker is an identifier and there is nothing
 * to infer. A reader who typed `solar` described one, which is a weaker signal
 * but still a signal about WHO rather than about WHAT. Anything matching only
 * the body of a filing is the weakest of the three: `solar` also appears in the
 * claim lines of filings by companies with no solar business at all, and a
 * scoring function that let a term-frequency spike in a PDF outrank a company's
 * own name would put those above Vikram Solar. Measured on the live collection,
 * `solar` returns 29 filings across three companies and two unrelated bodies;
 * the tiers put all of Vikram Solar's above all of the strays.
 *
 * ================================================================
 * WHY THE TEXT SCORE ONLY BREAKS TIES INSIDE TIER 2
 * ================================================================
 *
 * `textRank` is ZERO for tiers 0 and 1 and the negated text score for tier 2.
 * That is deliberate and it is the least obvious thing in this file.
 *
 * Inside tier 0 every row is the same company, so the score is measuring how
 * often the word `britannia` happens to occur in each of Britannia's own PDFs.
 * Ordering a company's filings by that is noise dressed as relevance: a reader
 * who searched for a company wants their filings NEWEST FIRST, which is how
 * every other view on this page is ordered. Flattening the score to a constant
 * lets `disseminatedAt` decide, which is the answer.
 *
 * Inside tier 2 the score is the only thing there is. `stock split` matches 369
 * filings under MongoDB's OR semantics — every filing saying `stock` and every
 * one saying `split` — and the score is what separates a filing that says both
 * from one that mentions a shareholder meeting of a broking company. So it is
 * kept exactly where it means something.
 *
 * Negated rather than sorted descending because a compound sort takes one
 * direction per key and the three keys after it want ascending, descending,
 * descending. One sign flip is cheaper to read than a second sort.
 */

/**
 * Whether the reader's query IS this ticker, case-folded.
 *
 * ================================================================
 * WHY A TIER IS NOT ENOUGH, AND THIS PREDICATE EXISTS
 * ================================================================
 *
 * `SEARCH_RANK.symbol` orders the answer. It cannot put a filing into one. The
 * tiers are computed over the documents the TEXT INDEX matched, so a company's
 * own filings lead the page only while they are in that set — and the reader's
 * other filters are applied to the same set. Measured on the live collection
 * (3,937 filings, 1,289 companies, 2026-08-09) with the feed's shipped default
 * — the "said something" toggle, which sends `tier=verified`:
 *
 *   q=ACC     →  6 filings, every one of them STUDDS
 *   q=CERA    →  2 filings: KAJARIACER, ORIENTCER
 *   q=NH      →  1 filing:  NHPC
 *   q=LTF     →  1 filing:  LTFOODS
 *   q=MCL     →  1 filing:  MCLOUD
 *   q=CRISIL  →  8 filings by 8 other companies, each naming its rating agency
 *   q=ZENTEC  →  nothing, though Zen Technologies has filed five times
 *
 * Not one of those rows is a filing by the company whose ticker was typed. The
 * page says "Searching for ACC" above six filings by Studds Accessories, which
 * is the failure mode this codebase treats as its most dangerous: every row is
 * a true answer to a question the reader did not ask.
 *
 * So an identifier is answered as an identifier. A reader who typed `ACC` named
 * a company, and this file already argues that there is nothing to infer from
 * that — the same argument says a filing that merely MENTIONS the word must not
 * stand in for the company, not merely rank below it. The query is resolved
 * against the company directory before the text index is asked anything, and an
 * exact ticker is answered with `{symbol: ...}` — the same filter the type-ahead
 * applies when a reader PICKS the company from the list. That agreement is the
 * point: typing `ACC` and picking ACC were two different answers to one query.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO is widen the reader's other filters. Under
 * the insight toggle, a company with nothing verified answers with an empty page
 * — which is what picking it from the list has always done, and is honest in a
 * way that six filings by another company is not.
 */
export const namesSymbol = (raw: string, symbol: string): boolean =>
  normaliseQuery(raw) === symbol.toLowerCase();

/** The three tiers, named so the pipeline and the tests cannot drift apart. */
export const SEARCH_RANK = {
  /** The query is the ticker, case-folded. An identifier, not a description. */
  symbol: 0,
  /** The query appears anywhere in the company's name. */
  companyName: 1,
  /** The text index matched, and nothing above did. */
  text: 2,
} as const;

/**
 * The `$text` predicate for a query, or null when the query holds no term.
 *
 * NULL IS A REAL ANSWER and callers must handle it. A reader who typed only
 * punctuation has not asked for anything, and `$text: {$search: ''}` is a query
 * error rather than an empty result set.
 */
export const textFilter = (raw: string): Record<string, unknown> | null => {
  const search = toTextSearch(raw);
  return search === null ? null : { $text: { $search: search } };
};

/**
 * Whether this filing's symbol IS the query.
 *
 * `$toLower` on both sides rather than uppercasing the query in TypeScript. NSE
 * symbols are uppercase by construction today; the comparison should not stop
 * working on the day one is not.
 */
const isSymbolMatch = (query: string): Record<string, unknown> => ({
  $eq: [{ $toLower: '$symbol' }, query],
});

/**
 * Whether the query appears anywhere in the company's name.
 *
 * `$indexOfCP` RATHER THAN `$regexMatch`, and the reason is the same one
 * `filing-query.service.ts` gives for refusing a regex on `symbol`: a pattern
 * assembled from request text is a pattern the caller chose. `$regexMatch` here
 * would need every metacharacter in the query escaped by hand, and an escaping
 * table that is one character short is a ReDoS on a route a browser calls while
 * somebody types. A substring search takes no pattern at all, so there is
 * nothing to escape and nothing to get wrong.
 *
 * This is computed over documents the TEXT INDEX ALREADY MATCHED — 29 of 2,243
 * for `solar` — so it is a projection over the answer, never a filter over the
 * collection. It could not be a filter: it is not indexable, which is precisely
 * why the match is `$text` and only the RANKING is a substring test.
 */
const isNameMatch = (query: string): Record<string, unknown> => ({
  $gte: [{ $indexOfCP: [{ $toLower: '$companyName' }, query] }, 0],
});

/**
 * The stages that turn a `$text` match into a ranked one.
 *
 * TWO `$addFields` RATHER THAN ONE. Within a single stage every expression is
 * evaluated against the stage's INPUT document, so `textRank` cannot read the
 * `searchRank` computed beside it — it would silently see a missing field and
 * `$lt` against it is true, flattening every score to zero and losing the tier-2
 * ordering entirely. Two stages is what makes the second able to read the first.
 */
export const rankStages = (raw: string): PipelineStage[] => {
  const query = normaliseQuery(raw);

  return [
    {
      $addFields: {
        searchRank: {
          $switch: {
            branches: [
              { case: isSymbolMatch(query), then: SEARCH_RANK.symbol },
              { case: isNameMatch(query), then: SEARCH_RANK.companyName },
            ],
            default: SEARCH_RANK.text,
          },
        },
      },
    },
    {
      $addFields: {
        textRank: {
          $cond: [
            { $lt: ['$searchRank', SEARCH_RANK.text] },
            0,
            { $multiply: [{ $meta: 'textScore' }, -1] },
          ],
        },
      },
    },
  ];
};

/**
 * The sort a ranked search uses.
 *
 * `seqId` breaks the last tie for the reason `getRecent` gives: NSE stamps
 * `disseminatedAt` to the second and publishes several filings within one, so a
 * sort without it has no defined order among them — and an undefined order means
 * a row can appear on page 1 and page 2, or on neither, while a reader pages.
 */
export const SEARCH_SORT = {
  searchRank: 1,
  textRank: 1,
  disseminatedAt: -1,
  seqId: -1,
} as const;
