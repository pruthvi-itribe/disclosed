import type { FilingEnrichment } from './enrichment.types';

/**
 * Keeping the better of two reads of the same filing.
 *
 * ================================================================
 * WHY A BACKFILL NEEDS THIS AND THE ORDINARY WORKER DOES NOT
 * ================================================================
 *
 * `recordEnrichment` `$set`s the WHOLE enrichment block, deliberately, so a
 * filing can never end up with an amount from one attempt and a refusal reason
 * from another. That is exactly right on the ordinary path, where a filing is
 * read once and the write is the first verdict there has ever been.
 *
 * A backfill inverts the situation. It re-reads documents that ALREADY carry a
 * verdict — 115 of the live collection's filings carry verified claims and 26
 * carry a verified amount — and a re-read is not guaranteed to be as good as
 * what it replaces. A model is sampled rather than deterministic; NSE serves a
 * measured 3.3% of its PDFs truncated; an extractor can return a 429. Every one
 * of those turns "re-enrich everything" into "delete the best thing this
 * pipeline ever learned about this filing", silently, at 800ms intervals, two
 * thousand times.
 *
 * So the backfill writes through here, and the rule is: **a re-read may add, and
 * may replace like with like, but may never subtract.**
 *
 * ================================================================
 * WHY LANES RATHER THAN FIELDS OR RECORDS
 * ================================================================
 *
 * Merging field by field would be wrong: `amountRupees` without `amountEvidence`
 * is an unsourced figure, and `claims` without `claimLine` is a claim that
 * cannot be published. Keeping whole records would be wrong in the other
 * direction: a re-read that finds a results table for the first time should not
 * be discarded because the old record happened to have one more claim.
 *
 * The enrichment block already divides into three internally-coherent LANES, and
 * each is the product of its own gate over the same document:
 *
 *   - the AMOUNT lane, with its evidence, anchor, counterparty and headline;
 *   - the CLAIMS lane, with its discards, its proposal count and the summary;
 *   - the RESULTS lane, with its figures and its refusal.
 *
 * A lane is taken whole from whichever read produced more of it. That the two
 * reads may have used different parsers is not a soundness problem: both read
 * the same immutable document at the same URL, and each lane's own evidence was
 * matched against the text that lane was read from.
 *
 * ================================================================
 * A READ THAT FAILED REPLACES NOTHING
 * ================================================================
 *
 * If the re-read did not reach `enriched` — the fetch 404'd, the bytes would not
 * parse, the attempt budget ran out — then it learned nothing, and lane
 * arithmetic on nothing is how a verified claim becomes an `unparseable` row. In
 * that case the previous verdict is kept whole and the regression is counted.
 */

/** The three independently-gated products of reading one document. */
export type EnrichmentLane = 'amount' | 'claims' | 'results';

export interface EnrichmentMergeResult {
  /** What should be written. */
  readonly enrichment: FilingEnrichment;
  /**
   * Lanes where the re-read produced LESS than what was already stored, and the
   * stored version was therefore kept.
   *
   * Reported rather than logged away: a backfill with a rising regression count
   * is a backfill that should be stopped, and a silent one is indistinguishable
   * from a clean one.
   */
  readonly regressions: readonly EnrichmentLane[];
  /** True when the re-read reached no verdict and the old one stands entire. */
  readonly readFailed: boolean;
}

const AMOUNT_FIELDS = [
  'amountRupees',
  'amountEvidence',
  'amountAnchor',
  'amountLabel',
  'amountRefusalReason',
  'amountRefusalDetail',
  'counterparty',
  'counterpartyEvidence',
  'counterpartyRefusalReason',
  'headline',
  'contextLine',
] as const;

const CLAIM_FIELDS = [
  'claims',
  'claimLine',
  'claimDiscards',
  'claimsProposed',
  'claimRefusalReason',
  'claimRefusalDetail',
  'documentSummary',
  'documentSummaryRefusalReason',
  'coverageSkip',
] as const;

const RESULTS_FIELDS = [
  'results',
  'resultsLine',
  'resultsDiscards',
  'resultsProposed',
  'resultsRefusalReason',
  'resultsRefusalDetail',
] as const;

const LANE_FIELDS: Readonly<Record<EnrichmentLane, readonly string[]>> = {
  amount: AMOUNT_FIELDS,
  claims: CLAIM_FIELDS,
  results: RESULTS_FIELDS,
};

/**
 * How much a lane is worth, so two reads of it can be compared.
 *
 * The weights encode what this pipeline publishes rather than a general notion
 * of richness: a verified figure outranks a counterparty, a verified claim
 * outranks a summary nothing checked, and a results LINE — every figure of which
 * agreed with the document's own header block — outranks any number of figures
 * that did not survive the gate.
 */
export function laneScore(
  enrichment: FilingEnrichment,
  lane: EnrichmentLane,
): number {
  if (lane === 'amount') {
    return (
      (enrichment.amountRupees === null ? 0 : 2) +
      (enrichment.counterparty === null ? 0 : 1)
    );
  }
  if (lane === 'claims') {
    return (
      enrichment.claims.length * 2 +
      (enrichment.documentSummary === null ? 0 : 1)
    );
  }
  return (
    (enrichment.resultsLine === null ? 0 : 100) +
    (enrichment.results?.figures.length ?? 0)
  );
}

const copyLane = (
  into: Record<string, unknown>,
  from: FilingEnrichment,
  lane: EnrichmentLane,
): void => {
  const source = from as unknown as Record<string, unknown>;
  for (const field of LANE_FIELDS[lane]) {
    into[field] = source[field];
  }
};

/**
 * The record a backfill should write, given what is already stored.
 *
 * NEVER THROWS and never mutates either argument. A null `previous` — a filing
 * the worker has never reached — returns the new record untouched, which is the
 * ordinary case for anything ingested after the last backfill.
 *
 * TIES GO TO THE NEW READ. Two reads that found the same amount are the same
 * fact, and preferring the fresh one keeps the evidence, the discards and the
 * proposal counts consistent with the parser that is running now.
 */
export function mergeEnrichment(
  previous: FilingEnrichment | null,
  next: FilingEnrichment,
): EnrichmentMergeResult {
  if (previous === null) {
    return { enrichment: next, regressions: [], readFailed: false };
  }

  const lanes: readonly EnrichmentLane[] = ['amount', 'claims', 'results'];

  // A re-read that reached no verdict learned nothing. Keeping its empty lanes
  // would turn a verified claim into a blank row, so the previous verdict stands
  // entire and only the derived fields — which come from the filing rather than
  // from the document — are refreshed.
  if (next.state !== 'enriched' && previous.state === 'enriched') {
    const held = lanes.filter((lane) => laneScore(previous, lane) > 0);
    return {
      enrichment: {
        ...previous,
        attempts: next.attempts,
        parseAttempts: next.parseAttempts,
        attemptedAt: next.attemptedAt,
        lastError: next.lastError,
      },
      regressions: held,
      readFailed: true,
    };
  }

  const merged: Record<string, unknown> = { ...next };
  const regressions: EnrichmentLane[] = [];

  for (const lane of lanes) {
    if (laneScore(previous, lane) > laneScore(next, lane)) {
      copyLane(merged, previous, lane);
      regressions.push(lane);
    }
  }

  return {
    enrichment: merged as unknown as FilingEnrichment,
    regressions,
    readFailed: false,
  };
}
