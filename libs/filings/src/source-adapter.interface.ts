import type { Filing } from './filing.types';

/**
 * The product boundary. `NseAdapter` implements this today; a licensed vendor
 * feed replaces it when commercial redistribution is required, with no changes
 * above this interface.
 */
export interface SourceAdapter {
  /** Newest filings available on the live page. Cheap; safe to poll every 2s. */
  fetchLatest(): Promise<Filing[]>;

  /** Every filing for the given IST calendar day. The drain / reconcile path. */
  fetchDay(date: Date): Promise<Filing[]>;
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
