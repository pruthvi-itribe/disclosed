import { Controller, Get, Header, Query } from '@nestjs/common';
import { ok, okWith, type ApiEnvelope } from '../http/envelope';
import {
  readBoundedInteger,
  readEnum,
  readFilter,
  type RawQuery,
} from '../http/query-params';
import { renderDashboardPage } from '../ui/page';
import type {
  CategoryCount,
  DailyCount,
  EnrichmentSummaryView,
  FilingView,
  PageMeta,
  SummaryView,
} from './dashboard.types';
import {
  AMOUNT_FILTERS,
  CLAIM_FILTERS,
  ENRICHMENT_STATES,
  GROUP_FILTERS,
  TIER_FILTERS,
  FilingQueryService,
} from './filing-query.service';

/** Rows returned when `limit` is absent: one screenful without scrolling on a laptop. */
export const DEFAULT_LIMIT = 25;

/**
 * Hard ceiling on rows per request. Not a preference — the collection grows
 * without bound and an unbounded page would serialise all of it into one
 * response, on a route a browser re-requests every few seconds.
 */
export const MAX_LIMIT = 200;

/** Ceiling on `offset`. Deep paging is a scan; the filters exist for that. */
export const MAX_OFFSET = 100_000;

/** Categories returned when `limit` is absent. The real taxonomy is around 60 wide. */
export const DEFAULT_CATEGORY_LIMIT = 40;

/** Days of history returned when `days` is absent. */
export const DEFAULT_DAYS = 14;

/** Ceiling on the per-day series. A year of buckets is already more than a page can draw. */
export const MAX_DAYS = 366;

/**
 * Every route this application serves.
 *
 * ALL OF THEM ARE `@Get`. There is no POST, PUT, PATCH or DELETE handler here
 * and there must never be one: the service behind them holds a model narrowed
 * to read methods (`filing-read.model.ts`), so a write route would not compile
 * anyway — but the absence is stated here too, because this file is where
 * someone would add one.
 */
@Controller()
export class DashboardController {
  constructor(private readonly filings: FilingQueryService) {}

  /**
   * The dashboard page itself: one self-contained HTML document with its CSS
   * and JavaScript inline. No CDN, no external font, no build step.
   *
   * `no-store` because the page polls the JSON routes for everything that
   * changes; a cached shell that outlives a deploy would poll them with stale
   * client code.
   */
  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  getPage(): string {
    return renderDashboardPage();
  }

  /** Headline stats: totals, today's IST count, the cursor, and feed lag. */
  @Get('api/summary')
  @Header('Cache-Control', 'no-store')
  async getSummary(): Promise<ApiEnvelope<SummaryView>> {
    return ok(await this.filings.getSummary());
  }

  /**
   * Recent filings, newest first, paginated and filterable.
   *
   * Query: `limit`, `offset`, `symbol`, `category`, `state`, `amount`,
   * `claim`, `refusal`. Anything unparseable is a 400 rather than a silently applied
   * default — a filter that quietly did nothing is indistinguishable from one
   * that matched everything, and on the refusal filters that difference is the
   * whole point of the view.
   */
  @Get('api/filings')
  @Header('Cache-Control', 'no-store')
  async getFilings(
    @Query() query: RawQuery,
  ): Promise<ApiEnvelope<readonly FilingView[], PageMeta>> {
    const page = await this.filings.getRecent({
      limit: readBoundedInteger('limit', query, {
        fallback: DEFAULT_LIMIT,
        min: 1,
        max: MAX_LIMIT,
      }),
      offset: readBoundedInteger('offset', query, {
        fallback: 0,
        min: 0,
        max: MAX_OFFSET,
      }),
      symbol: readFilter('symbol', query),
      category: readFilter('category', query),
      state: readEnum('state', query, ENRICHMENT_STATES),
      amount: readEnum('amount', query, AMOUNT_FILTERS),
      claim: readEnum('claim', query, CLAIM_FILTERS),
      // Both are allowlisted rather than length-checked, for the reason
      // `readEnum` gives: an unrecognised value reaching the filter matches
      // nothing, and on a page whose job is showing what was found that is
      // indistinguishable from nothing having been found.
      group: readEnum('group', query, GROUP_FILTERS),
      tier: readEnum('tier', query, TIER_FILTERS),
      refusal: readFilter('refusal', query),
    });

    return okWith(page.items, page.meta);
  }

  /**
   * How the attachment worker is doing, and every reason it refused something.
   *
   * A separate route from `api/summary` rather than more fields on it: this one
   * runs seven grouped aggregations and the page fetches it on the slow cycle,
   * while the summary is on every four-second poll.
   */
  @Get('api/enrichment')
  @Header('Cache-Control', 'no-store')
  async getEnrichment(): Promise<ApiEnvelope<EnrichmentSummaryView>> {
    return ok(await this.filings.getEnrichmentSummary());
  }

  /** Category breakdown across the whole collection, largest first. */
  @Get('api/categories')
  @Header('Cache-Control', 'no-store')
  async getCategories(
    @Query() query: RawQuery,
  ): Promise<ApiEnvelope<readonly CategoryCount[]>> {
    return ok(
      await this.filings.getCategories(
        readBoundedInteger('limit', query, {
          fallback: DEFAULT_CATEGORY_LIMIT,
          min: 1,
          max: MAX_LIMIT,
        }),
      ),
    );
  }

  /** Filings per IST day for the last `days` days, oldest first, zero-filled. */
  @Get('api/daily')
  @Header('Cache-Control', 'no-store')
  async getDaily(
    @Query() query: RawQuery,
  ): Promise<ApiEnvelope<readonly DailyCount[]>> {
    return ok(
      await this.filings.getDaily(
        readBoundedInteger('days', query, {
          fallback: DEFAULT_DAYS,
          min: 1,
          max: MAX_DAYS,
        }),
      ),
    );
  }
}
