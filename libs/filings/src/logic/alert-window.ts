import type { Filing } from '../filing.types';

/**
 * Guards the cold-start alert storm: a first run, or a restart after downtime,
 * drains up to ~1000 filings that all look new to the repository. Without this
 * gate every one of them would fire a Telegram alert.
 *
 * Uses `disseminatedAt` (the exchange clock), never ingest or local time.
 *
 * Two decisions this function makes deliberately:
 *
 * 1. The boundary is EXCLUSIVE. A filing exactly `windowMs` old is stale.
 * 2. A NEGATIVE age is fresh. NSE's dissemination clock is not ours; if theirs
 *    runs marginally ahead, `now - disseminatedAt` goes below zero. That is the
 *    freshest possible filing, so `<` alone is correct here and any absolute
 *    value or lower bound on age would suppress a live alert.
 *
 * `disseminatedAt` is typed as a Date but arrives as an ISO string from Mongo
 * and from JSONL replay, so it is re-wrapped rather than read directly. An
 * unparseable value yields NaN, and `NaN < windowMs` is false — a corrupt
 * record is stored silently instead of alerting.
 */
export function isWithinAlertWindow(
  filing: Filing,
  now: Date,
  windowMs: number,
): boolean {
  const age = now.getTime() - new Date(filing.disseminatedAt).getTime();
  // Negative age means NSE's clock is marginally ahead of ours; still fresh.
  return age < windowMs;
}

export interface AlertPartition {
  alertable: Filing[];
  silent: Filing[];
}

/**
 * Splits a batch into what may alert and what is stored silently.
 *
 * Every input filing appears in exactly one output array, by reference and in
 * input order — the caller persists both sides and sends `alertable` in the
 * order NSE returned it. The input array and the filings on it are never
 * mutated.
 */
export function partitionForAlerting(
  filings: readonly Filing[],
  now: Date,
  windowMs: number,
): AlertPartition {
  const alertable: Filing[] = [];
  const silent: Filing[] = [];

  for (const filing of filings) {
    (isWithinAlertWindow(filing, now, windowMs) ? alertable : silent).push(
      filing,
    );
  }

  return { alertable, silent };
}
