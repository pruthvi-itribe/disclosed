import type { PageMeta } from './api';

/**
 * MIRRORED, NOT IMPORTED, unlike the filings DTOs: these two interfaces live
 * in controllers that import Nest, and this project's tsc cannot follow a
 * file whose imports resolve only in the server's tree. Each field below is
 * asserted against the controller source by account-mirror.spec.ts, so a
 * rename there fails here.
 */

/** What api/me answers — auth.controller.ts. Signed out, only signedIn. */
export interface MeView {
  readonly signedIn: boolean;
  readonly email?: string;
  readonly watchCount?: number;
  readonly watchCap?: number;
  readonly unread?: number;
  readonly channels?: ReadonlyArray<{ kind: string; enabled: boolean }>;
}

/** One row of the watchlist — watchlist.controller.ts. */
export interface WatchedCompany {
  readonly symbol: string;
  readonly companyName: string;
  readonly addedAt: string;
  readonly addedAtIst: string;
  readonly filingsHeld: number;
  /** Null is a real answer, rendered as "nothing yet in our window". */
  readonly lastFiledAt: string | null;
  readonly lastFiledAtIst: string | null;
}

/** api/watchlist/feed's meta: the page window plus the whole roster. */
export interface WatchlistFeedMeta extends PageMeta {
  readonly unread: number;
  readonly watching: readonly WatchedCompany[];
}
