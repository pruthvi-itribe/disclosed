export interface RolloverInput {
  /** seq_ids present on the fetched page, any order. */
  pageSeqIds: readonly number[];
  /** Highest seq_id already ingested, or null before the first successful poll. */
  cursor: number | null;
}

export interface RolloverResult {
  /** Ids to ingest, descending. */
  newSeqIds: number[];
  /** True when the page cannot prove continuity with what we already hold. */
  holeDetected: boolean;
}

/**
 * Decides what to ingest and whether a drain is required.
 *
 * The completeness rule: if the OLDEST id on the page is still newer than our
 * cursor, the page turned over between polls and there is no overlap to prove
 * we saw everything in between. We cannot use seq_id contiguity for this —
 * seq_id is a global counter across all NSE streams, so gaps are normal and
 * prove nothing. Overlap is the only honest signal.
 */
export function detectRollover({
  pageSeqIds,
  cursor,
}: RolloverInput): RolloverResult {
  // Copy before sorting: the caller's page must never be reordered underneath it.
  const descending = [...pageSeqIds].sort((a, b) => b - a);

  if (cursor === null) {
    // Cold start: nothing to overlap against, so drain the day to be safe.
    // This holds even for an empty page — an empty page cannot advance the
    // cursor, so this is the only chance to establish a baseline.
    return { newSeqIds: descending, holeDetected: true };
  }

  if (descending.length === 0) {
    return { newSeqIds: [], holeDetected: false };
  }

  const oldestOnPage = descending[descending.length - 1];

  return {
    newSeqIds: descending.filter((id) => id > cursor),
    holeDetected: oldestOnPage > cursor,
  };
}
