import axios, { type AxiosInstance } from 'axios';
import type { AdapterLogger } from '../source-adapter.interface';
import { mapBsePage } from './bse.mapper';
import type { BseAnnouncement, BseAnnouncementPage } from './bse.types';

export const BSE_API_HOST = 'https://api.bseindia.com';
export const BSE_ANNOUNCEMENTS_PATH =
  '/BseIndiaAPI/api/AnnSubCategoryGetData/w';

/**
 * BSE answers without a cookie handshake, unlike NSE.
 *
 * The NSE lane needs a bot-management cookie refreshed by a `SessionProvider`
 * before any request succeeds. BSE's API host serves this endpoint to a plain
 * request carrying a browser User-Agent and a `bseindia.com` Referer — verified
 * on the wire — so there is no session to hold, invalidate or race. That is a
 * meaningful simplification and it is worth saying out loud, because the
 * absence of a `SessionProvider` here will otherwise read as an omission.
 */
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const REFERER = 'https://www.bseindia.com/';
const TIMEOUT_MS = 15_000;

/**
 * Pages BSE will be asked for before the drain gives up.
 *
 * A BOUND ON A LOOP WHOSE EXIT CONDITION COMES FROM THE SERVER. The drain stops
 * when it has collected `ROWCNT` announcements, and `ROWCNT` is BSE's number —
 * so a payload reporting an unreachable total, or a page silently repeating,
 * would otherwise spin against the exchange until something else broke.
 *
 * 200, AND THE FIRST GUESS AT IT WAS 50, WHICH WAS NEARLY A BUG. That number
 * was reasoned from the NSE corpus: the busiest IST day there carried 1,156
 * filings, so fifty pages "obviously" cleared any real day. Then the drain was
 * run against real ones. BSE served 2,080 announcements for 2026-08-06 and
 * 2,071 for 2026-08-05 — roughly 50 to a page, so 42 pages each. The bound
 * meant to be unreachable sat 19% above a routine Wednesday, and the first
 * heavy results day would have hit it and reported a short day as if BSE had
 * simply published less.
 *
 * The error was reasoning about BSE's volume from NSE's. BSE lists far more
 * companies, so its announcement count is not a variation on NSE's — it is a
 * different quantity that happens to be about the same market. 200 clears the
 * measured 42 by 4.8x.
 */
export const MAX_PAGES = 200;

/** IST calendar date as BSE wants it: YYYYMMDD, no separators. */
export const bseDateParam = (date: Date): string => {
  const ist = new Date(date.getTime() + 5.5 * 60 * 60 * 1000);
  const yyyy = ist.getUTCFullYear();
  const mm = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(ist.getUTCDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
};

/** What a drain of one IST day collected. */
export interface BseDayResult {
  readonly announcements: readonly BseAnnouncement[];
  /** BSE's own count for the day, or null when it never stated one. */
  readonly totalForRange: number | null;
  /** Records BSE sent that could not be mapped, summed across pages. */
  readonly skipped: number;
  /** Pages actually requested. */
  readonly pages: number;
  /**
   * Whether the drain ended because it had everything BSE said existed.
   *
   * THE WHOLE REASON THIS LANE IS SHAPED AROUND `ROWCNT`. False means the day
   * is short of what the exchange claims and the caller must not treat it as a
   * complete picture — the NSE lane can only ever infer this from page overlap,
   * and BSE hands it over.
   */
  readonly complete: boolean;
}

export class BseClient {
  private readonly http: AxiosInstance;

  constructor(
    private readonly logger?: AdapterLogger,
    http?: AxiosInstance,
  ) {
    this.http =
      http ??
      axios.create({
        baseURL: BSE_API_HOST,
        timeout: TIMEOUT_MS,
        headers: {
          'User-Agent': UA,
          Referer: REFERER,
          Accept: 'application/json',
        },
        // BSE's origin emits a malformed response header and Node's strict
        // parser rejects the entire response over it. Observed draining
        // 2026-08-06, at page 20 of that day, as:
        //
        //   HTTP/1.1 200 OK
        //   Content-Type: application/json; charset=utf-8
        //   X-Content-Type-Options: nosniff
        //    Strict-Transport-Security: ...     <- leading space
        //
        // The space before the header name is illegal, so Node raises
        // HPE_INVALID_HEADER_TOKEN and a 200 carrying a perfectly good JSON
        // body is lost. It is intermittent, which is worse than always: a day
        // drains fine until one page does not, and the drain ends mid-day.
        //
        // THE TRADE-OFF, STATED. A lenient parser is how request-smuggling
        // attacks are built, and it is enabled here on ONE client that issues
        // GETs to one public JSON endpoint and never forwards a response
        // onward. It is not on the NSE client, not on the attachment fetcher,
        // and not on any default agent. The alternative — dropping every page
        // BSE malforms — silently truncates the day this lane exists to prove
        // complete.
        insecureHTTPParser: true,
      });
  }

  /** One page. Exposed so the drain and any probe share exactly one request shape. */
  async fetchPage(
    date: Date,
    pageNo: number,
    now: Date,
  ): Promise<BseAnnouncementPage> {
    const day = bseDateParam(date);
    const response = await this.http.get<unknown>(BSE_ANNOUNCEMENTS_PATH, {
      params: {
        pageno: pageNo,
        strCat: -1,
        strPrevDate: day,
        strToDate: day,
        strScrip: '',
        strSearch: 'P',
        strType: 'C',
        subcategory: '',
      },
    });
    return mapBsePage(
      (response.data ?? {}) as { Table?: unknown; Table1?: unknown },
      now,
    );
  }

  /**
   * Every announcement BSE holds for one IST day.
   *
   * Pages until it has as many announcements as BSE said exist, deduplicating
   * by `NEWSID` as it goes. THE DEDUPLICATION IS NOT DEFENSIVE TIDYING: pages
   * are served from a moving result set, so an announcement arriving mid-drain
   * shifts rows across the page boundary and a row can be returned twice. Left
   * alone, that inflates the collected count, the count reaches `ROWCNT` early,
   * and the drain stops believing it is complete while genuinely missing rows.
   *
   * Stops early on a page that adds nothing new, because a server that keeps
   * answering with rows already seen will never move the count and the page
   * bound alone would spend fifty requests learning that.
   */
  async fetchDay(date: Date, now: Date = new Date()): Promise<BseDayResult> {
    const seen = new Map<string, BseAnnouncement>();
    let totalForRange: number | null = null;
    let skipped = 0;
    let pages = 0;

    for (let pageNo = 1; pageNo <= MAX_PAGES; pageNo += 1) {
      const page = await this.fetchPage(date, pageNo, now);
      pages = pageNo;
      skipped += page.skipped;
      if (page.totalForRange !== null) totalForRange = page.totalForRange;

      let added = 0;
      for (const announcement of page.announcements) {
        if (seen.has(announcement.newsId)) continue;
        seen.set(announcement.newsId, announcement);
        added += 1;
      }

      if (page.announcements.length === 0 || added === 0) break;
      if (totalForRange !== null && seen.size >= totalForRange) break;
    }

    const announcements = [...seen.values()].sort(
      (a, b) => b.disseminatedAt.getTime() - a.disseminatedAt.getTime(),
    );

    // Unknown is NOT complete. A day BSE never counted is a day this cannot
    // vouch for, and saying otherwise would hand the caller a completeness
    // claim built on the absence of evidence.
    const complete =
      totalForRange !== null && announcements.length >= totalForRange;

    if (!complete) {
      this.logger?.warn(
        `BSE day ${bseDateParam(date)} is short: collected ` +
          `${announcements.length} of ${totalForRange ?? 'an unstated number of'} ` +
          `announcement(s) over ${pages} page(s)`,
      );
    }
    if (skipped > 0) {
      // Never silent. A payload BSE restructured reads as a quiet day unless
      // the count of unmappable rows is said out loud.
      this.logger?.warn(
        `BSE day ${bseDateParam(date)}: ${skipped} record(s) could not be mapped`,
      );
    }

    return { announcements, totalForRange, skipped, pages, complete };
  }
}
