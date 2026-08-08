import {
  Controller,
  Get,
  Header,
  Inject,
  Query,
  Req,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ok, okWith, type ApiEnvelope } from '../http/envelope';
import { CLAIM_TOPICS } from '@app/filings';
import { ApiErrorFilter } from '../auth/api-error';
import { AUTH_CONFIG } from '../auth/auth.tokens';
import { SessionGuard } from '../auth/session.guard';
import { SessionService } from '../auth/session.service';
import type { AuthConfig } from '../config/auth-config';
import {
  readBoundedInteger,
  readEnum,
  readFilter,
  type RawQuery,
} from '../http/query-params';
import { renderAuthPage } from '../ui/auth-page';
import { renderLandingPage } from '../ui/landing';
import { renderDashboardPage } from '../ui/page';
import { CompanyDirectory } from '../search/company-directory';
import { suggestFrom } from '../search/suggest';
import type {
  CategoryCount,
  DailyCount,
  EnrichmentSummaryView,
  FilingView,
  PageMeta,
  SuggestionsView,
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
 *
 * 500, raised from 200 when the feed's auto-load reached the old ceiling with
 * the reader mid-scroll and the button simply stopped. The cost is bounded and
 * paid every four seconds by whoever scrolls that deep: ~500 rows a poll.
 * Past it the feed says so and offers the filters, because a window that
 * re-serialises the whole collection each tick is not a page any more.
 */
export const MAX_LIMIT = 500;

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
 *
 * ================================================================
 * EVERY ROUTE THAT READS A FILING IS BEHIND THE SESSION
 * ================================================================
 *
 * This controller used to be entirely public, on the argument that it was a
 * loopback view of a local database. It is not that any more: it is a product
 * with accounts, and the founder's decision is that there is NO ACCESS WITHOUT
 * SIGN-IN. So `@UseGuards(SessionGuard)` sits on every route below that touches
 * `filings`, and the three that do not are the three exceptions, each named
 * here so an addition has to argue with this list:
 *
 *   - `GET /` decides which page to serve and reads no filing either way.
 *   - `GET /auth` is the sign-in page. Gating the way in is a lockout.
 *   - `GET /api/health` answers whether this process is up, and nothing else.
 *     Nine bytes, no database, no collection named. A monitor must not need a
 *     credential, and a liveness probe that needs the database is a probe that
 *     reports the database.
 *
 * `GET /api/me` is also public and lives on `AuthController`; it answers
 * `{signedIn: false}` rather than 401 for the reason stated there.
 *
 * THE FILTER IS NEW ON THIS CONTROLLER. Without it the guard's 401 serialises as
 * Nest's bare shape while every other refusal on the origin is an envelope, and
 * the page's `getJson` would report "a body that is not a success envelope" for
 * an expired session. Existing 400s keep their status and their message; they
 * gain the envelope, which is what the page was already parsing on every other
 * route.
 */
@Controller()
@UseFilters(ApiErrorFilter)
export class DashboardController {
  constructor(
    private readonly filings: FilingQueryService,
    private readonly directory: CompanyDirectory,
    private readonly sessions: SessionService,
    @Inject(AUTH_CONFIG) private readonly authConfig: AuthConfig,
  ) {}

  /**
   * The front door, and the one route whose answer depends on who is asking.
   *
   * Signed in: the dashboard — one self-contained HTML document with its CSS and
   * JavaScript inline, no CDN, no external font, no build step.
   *
   * Signed out: the landing page, which is a constant and performs no read at
   * all. Not a trimmed dashboard, not the feed with the data blanked: a
   * different document with no client code and nothing to fetch. That is what
   * makes "signed-out visitors read nothing" a property of the routing table
   * rather than a promise about what the client asks for.
   *
   * NOT `SessionGuard`. The guard's job is to refuse and this route's job is to
   * answer — the same split `api/me` makes. A 401 here would mean an anonymous
   * visitor's first impression of this product is a JSON error body.
   *
   * `no-store` on both. The dashboard polls the JSON routes and a cached shell
   * outliving a deploy would poll them with stale client code; the landing page
   * shares the URL with the dashboard, and a cached landing page would be served
   * to the same person one second after they signed in.
   */
  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  async getPage(@Req() request: Request): Promise<string> {
    const who = await this.sessions.resolve(request);
    return who === null ? renderLandingPage() : renderDashboardPage();
  }

  /**
   * The sign-in page. Public, necessarily.
   *
   * Redirects a signed-in browser to the app rather than showing it a form it
   * does not need — which is also the honest answer to somebody who followed a
   * stale link from a second tab.
   *
   * Rendered from the resolved `AuthConfig`, so a `local` host ships no Firebase
   * code and a host whose keys have not arrived says which ones are missing. See
   * `ui/auth-page.ts` for the CDN relaxation this page carries and its bounds.
   */
  @Get('auth')
  @Header('Cache-Control', 'no-store')
  async getAuthPage(
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    if ((await this.sessions.resolve(request)) !== null) {
      response.redirect(302, '/');
      return;
    }

    response
      .type('text/html; charset=utf-8')
      .send(renderAuthPage(this.authConfig));
  }

  /**
   * Whether this process is up. The one unauthenticated JSON route.
   *
   * TOUCHES NO DATABASE AND NAMES NOTHING. A liveness probe that reads mongo
   * reports the database rather than the process, and one that returns a build
   * string or a collection count is reconnaissance available to anyone who can
   * reach the port. It answers that the HTTP server is answering.
   */
  @Get('api/health')
  @Header('Cache-Control', 'no-store')
  getHealth(): ApiEnvelope<{ status: 'ok' }> {
    return ok({ status: 'ok' as const });
  }

  /** Headline stats: totals, today's IST count, the cursor, and feed lag. */
  @Get('api/summary')
  @Header('Cache-Control', 'no-store')
  @UseGuards(SessionGuard)
  async getSummary(): Promise<ApiEnvelope<SummaryView>> {
    return ok(await this.filings.getSummary());
  }

  /**
   * Recent filings, newest first, paginated and filterable.
   *
   * Query: `q`, `limit`, `offset`, `symbol`, `category`, `state`, `amount`,
   * `claim`, `refusal`. Anything unparseable is a 400 rather than a silently applied
   * default — a filter that quietly did nothing is indistinguishable from one
   * that matched everything, and on the refusal filters that difference is the
   * whole point of the view.
   */
  @Get('api/filings')
  @Header('Cache-Control', 'no-store')
  @UseGuards(SessionGuard)
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
      // Free text, and DELIBERATELY NOT ALLOWLISTED like the filters below it.
      // This one is meant to be arbitrary: it is a reader's own words. What
      // makes that safe is that it never becomes a Mongo operator or a regex —
      // `search-terms.ts` decomposes it into letters and digits and reassembles
      // it, so there is nothing to escape. `readFilter` still bounds its length,
      // because a query longer than 128 characters is a paste or an attack and
      // is never a company.
      q: readFilter('q', query),
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
      // Validated against the closed list like every other filter, so caller
      // text never reaches a Mongo predicate.
      topic: readEnum('topic', query, CLAIM_TOPICS),
      tier: readEnum('tier', query, TIER_FILTERS),
      refusal: readFilter('refusal', query),
    });

    return okWith(page.items, page.meta);
  }

  /**
   * What the reader might be typing: companies, categories and groups.
   *
   * THE ONLY ROUTE HERE A BROWSER CALLS WHILE SOMEBODY IS TYPING, which decides
   * everything about it. It touches the database on NO request in the ordinary
   * case: the answer comes from a snapshot the directory refreshes on a clock,
   * so a reader holding a key down costs zero reads rather than one per
   * character. See `search/company-directory.ts` for the two covered index scans
   * behind that snapshot and what they were measured at.
   *
   * A `@Get` with one query parameter and no state, like every other route on
   * this controller. It is a search box, not a session.
   */
  @Get('api/suggest')
  @Header('Cache-Control', 'no-store')
  @UseGuards(SessionGuard)
  async getSuggestions(
    @Query() query: RawQuery,
  ): Promise<ApiEnvelope<SuggestionsView>> {
    const snapshot = await this.directory.snapshot();
    // An absent `q` is answered as an empty suggestion list rather than a 400.
    // The page debounces and can race a cleared box against its own timer, and
    // a red error banner because a reader deleted what they typed would be the
    // dashboard reporting its own timing as a fault.
    return ok(suggestFrom(snapshot, readFilter('q', query) ?? ''));
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
  @UseGuards(SessionGuard)
  async getEnrichment(): Promise<ApiEnvelope<EnrichmentSummaryView>> {
    return ok(await this.filings.getEnrichmentSummary());
  }

  /** Category breakdown across the whole collection, largest first. */
  @Get('api/categories')
  @Header('Cache-Control', 'no-store')
  @UseGuards(SessionGuard)
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
  @UseGuards(SessionGuard)
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
