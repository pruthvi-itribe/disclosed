import type { Filing } from './filing.types';

/**
 * One fetch, with enough accounting to tell an empty feed from a broken one.
 *
 * A bare `Filing[]` cannot: zero filings is both a quiet market and a page whose
 * every record was rejected. That second case is reachable - `seq_id` is
 * validated digits-only, so an exchange-side id format change would silence the
 * feed permanently while looking like a slow evening. `received` and `skipped`
 * make it detectable in code rather than only in a log.
 */
export interface FetchResult {
  /** Successfully mapped filings, newest `seqId` first. */
  readonly filings: readonly Filing[];

  /** Records in the source response, before any mapping. */
  readonly received: number;

  /** Records dropped as unmappable. `received - skipped === filings.length`. */
  readonly skipped: number;
}

/**
 * The product boundary. `NseAdapter` implements this today; a licensed vendor
 * feed replaces it when commercial redistribution is required, with no changes
 * above this interface.
 */
export interface SourceAdapter {
  /** Newest filings available on the live page. Cheap; safe to poll every 2s. */
  fetchLatest(): Promise<FetchResult>;

  /** Every filing for the given IST calendar day. The drain / reconcile path. */
  fetchDay(date: Date): Promise<FetchResult>;
}

/** Provides and refreshes the bot-management cookie jar. */
export interface SessionProvider {
  getCookieHeader(): Promise<string>;
  invalidate(): void;
}

/**
 * The single logging call an adapter makes, declared structurally so that
 * `libs/filings` states what it needs rather than depending on a framework
 * logger. NestJS's `Logger` satisfies it as-is, and a test can pass a recorder.
 */
export interface AdapterLogger {
  warn(message: string): void;
}
