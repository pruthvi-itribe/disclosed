/**
 * What one pass of the enrichment loop did, and how two passes add up.
 *
 * SPLIT OUT OF THE WORKER because none of it needs the worker: a tick result is
 * a record of twelve counts, its log line is a pure function of that record, and
 * adding two of them together is arithmetic. Keeping them beside 800 lines of
 * I/O made the file longer without making any of this easier to read, and the
 * comment explaining `merge` had drifted a hundred lines away from `merge`.
 */
export interface EnrichmentTickResult {
  readonly claimed: number;
  readonly enriched: number;
  /** Documents read successfully whose amount the extractor refused. */
  readonly refused: number;
  readonly unparseable: number;
  /**
   * Parse failures put back to be looked at again, because the filing is young
   * enough that NSE's own upload could still be the explanation.
   */
  readonly parseRetried: number;
  /** Transient failures put back with a backoff. */
  readonly retried: number;
  /** Transient failures that exhausted the attempt budget. */
  readonly failed: number;
  /** Documents that produced at least one verified claim. */
  readonly claimed_lines: number;
  /**
   * Documents whose stored claim line said nothing the wire would carry.
   *
   * SEPARATE FROM `claimed_lines`, which counts what was STORED. The two
   * disagree exactly when every claim on a filing was boilerplate, and that
   * disagreement is the whole effect of the mute — collapsing them into one
   * counter would make "the extractor found nothing" and "everything it found
   * was an ESOP grant" indistinguishable in the logs, which is how a mute that
   * had started eating real claims would stay invisible.
   */
  readonly claimLinesMuted: number;
  /** Proposed claims the verbatim gate refused. */
  readonly claimsDiscarded: number;
  /** Documents that produced a verified results line. */
  readonly resultsLines: number;
  /** Follow-up messages ATTEMPTED. Not proof of delivery. */
  readonly alerted: number;
}

/**
 * How long the loop may sit idle before it says so.
 *
 * Five minutes: frequent enough that a dead lane is visible within one coffee
 * break, rare enough that a quiet overnight costs a dozen log lines and a dozen
 * indexed counts.
 */
export const HEARTBEAT_MS = 300_000;

/** One tick's outcome, in the order an operator reads it. */
export const describeTick = (result: EnrichmentTickResult): string =>
  `Enrichment tick: claimed ${result.claimed}, enriched ${result.enriched} ` +
  `(amount refused on ${result.refused}), unparseable ${result.unparseable}, ` +
  `parse-retried ${result.parseRetried}, retried ${result.retried}, ` +
  `failed ${result.failed}, claim-lines ${result.claimed_lines} ` +
  `(${result.claimsDiscarded} claim(s) discarded, ` +
  `${result.claimLinesMuted} muted off the wire), ` +
  `results-lines ${result.resultsLines}, alerted ${result.alerted}`;

export const EMPTY_TICK: EnrichmentTickResult = {
  claimed: 0,
  enriched: 0,
  refused: 0,
  unparseable: 0,
  parseRetried: 0,
  retried: 0,
  failed: 0,
  claimed_lines: 0,
  claimLinesMuted: 0,
  claimsDiscarded: 0,
  resultsLines: 0,
  alerted: 0,
};

/**
 * Adds one document's outcome to the running tally.
 *
 * Takes a COMPLETE result rather than a partial: every path through `process`
 * spreads `EMPTY_TICK` before it returns, so a per-field fallback here would be
 * seven branches no input can reach — and an unreachable branch is a claim
 * nobody can check.
 */
export const merge = (
  tally: EnrichmentTickResult,
  delta: EnrichmentTickResult,
): EnrichmentTickResult => ({
  claimed: tally.claimed + delta.claimed,
  enriched: tally.enriched + delta.enriched,
  refused: tally.refused + delta.refused,
  unparseable: tally.unparseable + delta.unparseable,
  parseRetried: tally.parseRetried + delta.parseRetried,
  retried: tally.retried + delta.retried,
  failed: tally.failed + delta.failed,
  claimed_lines: tally.claimed_lines + delta.claimed_lines,
  claimLinesMuted: tally.claimLinesMuted + delta.claimLinesMuted,
  claimsDiscarded: tally.claimsDiscarded + delta.claimsDiscarded,
  resultsLines: tally.resultsLines + delta.resultsLines,
  alerted: tally.alerted + delta.alerted,
});
