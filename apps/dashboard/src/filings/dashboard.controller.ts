import {
  Controller,
  Get,
  Header,
  Inject,
  NotFoundException,
  Query,
  Req,
  Res,
  StreamableFile,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { createHash } from 'crypto';
import type { Request, Response } from 'express';
import { ok, okWith, type ApiEnvelope } from '../http/envelope';
import { CLAIM_TOPICS } from '@app/filings';
import { ApiErrorFilter } from '../auth/api-error';
import { ADMIN_ENABLED, AUTH_CONFIG } from '../auth/auth.tokens';
import { SessionGuard } from '../auth/session.guard';
import { SessionService } from '../auth/session.service';
import type { AuthConfig } from '../config/auth-config';
import {
  readBoundedInteger,
  readEnum,
  readFilter,
  type RawQuery,
} from '../http/query-params';
import { BRAND_RASTER } from '../ui/brand-raster';
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
  PLANS_FILTERS,
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
    /**
     * Whether this process was built with the operator panel — see
     * `config/configuration.ts` for the rule and why it is two signals.
     *
     * READ IN TWO PLACES AND THEY MUST AGREE: the page it renders, and the
     * three routes only that page reads. A document without the panel whose
     * routes still answered would be the surface removed and the data left.
     */
    @Inject(ADMIN_ENABLED) private readonly adminEnabled: boolean,
  ) {}

  /**
   * The front door, and the one route whose answer depends on who is asking.
   *
   * Signed in: the dashboard — one self-contained HTML document with its CSS and
   * JavaScript inline, no CDN, no external font, no build step.
   *
   * Signed out: the landing page, which performs no read at all. Not a trimmed
   * dashboard, not the feed with the data blanked: a different document, with no
   * read route in it to call. That is what makes "signed-out visitors read
   * nothing" a property of the routing table rather than a promise about what
   * the client asks for.
   *
   * Rendered from the resolved `AuthConfig`, like the sign-in page: in firebase
   * mode its buttons open Google's popup where the visitor already is, and a
   * `local` host ships no Firebase code at all. See `ui/landing.ts`.
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
    return who === null
      ? renderLandingPage(this.authConfig)
      : renderDashboardPage(this.adminEnabled);
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

  /**
   * The brand mark as artwork, for the share card to draw.
   *
   * THE ONE ROUTE HERE THAT IS NOT HTML OR JSON, and the only asset this
   * application serves. It exists because the share image is a picture that
   * leaves the product, where the mark is the part a stranger recognises, and
   * the page's inline SVG is a redrawing of the founder's file rather than the
   * file — see `ui/brand-raster.ts`.
   *
   * GUARDED LIKE EVERY READ. It is not one of the three public exceptions
   * enumerated above: it is drawn into a card built from filings, by a browser
   * that has already signed in, and there is no argument for handing the
   * artwork to a caller who cannot see anything it appears on.
   *
   * CACHED, WHICH THE JSON ROUTES ARE NOT. Those carry a view of the data and
   * a stale one is a wrong dashboard; this is 65 KB of unchanging artwork that
   * every page load would otherwise re-fetch. `private` because it sits behind
   * a session and a shared cache has no business holding it.
   */
  @Get('brand/logo.png')
  @Header('Cache-Control', 'private, max-age=86400')
  @UseGuards(SessionGuard)
  getBrandLogo(): StreamableFile {
    return new StreamableFile(BRAND_RASTER, { type: 'image/png' });
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
   * `claim`, `topic`, `plans`, `tier`,
   * `refusal`. Anything unparseable is a 400 rather than a silently applied
   * default — a filter that quietly did nothing is indistinguishable from one
   * that matched everything, and on the refusal filters that difference is the
   * whole point of the view.
   *
   * ================================================================
   * THE ONE ROUTE THAT CARRIES A VALIDATOR, AND WHY IT IS THIS ONE
   * ================================================================
   *
   * The page polls every four seconds and asks two questions a tick. Measured
   * against the local stack on 2026-08-14, signed in: `api/summary` answers in
   * 475 bytes, and this route in 104,478 for the ask the feed actually makes
   * (`limit=25&offset=0&tier=verified`, read off Chromium) — 213,403 once the
   * feed auto-grows to 50 rows. At 900 polls an hour that is ~94 MB an hour for
   * ONE open tab, nearly all of it re-sending rows the reader is already
   * looking at. Server time was never the problem — 9.3 to 12.6 ms a request,
   * five runs — and a 304 does not save it (the query still runs, and answers
   * in 8.2 to 8.6 ms). The bytes were the problem: the same revalidated ask is
   * 0 bytes of body and 191 of header.
   *
   * So this route answers a repeat ask with 304 and nothing else, and the
   * summary is left alone: 475 bytes does not repay a conditional request, and
   * its body carries `generatedAt` anyway, so no two answers are ever equal.
   *
   * THE VALIDATOR IS A HASH OF THE BYTES BELOW IT, which is the only definition
   * that is correct by construction. The tempting shortcut is the newest
   * arrival timestamp the summary already computes, and it is WRONG: enrichment
   * finishes on filings that are already in the window and rewrites their
   * claims, their state and their outcome without moving any arrival time. A
   * reader would sit on a 304 while the page silently went stale.
   *
   * WRITTEN THROUGH `@Res` RATHER THAN RETURNED, so the string that is hashed
   * IS the string that is sent. Handing the envelope back to Nest and hashing a
   * second serialisation of it would agree today and would be a hash of
   * something else the day an express `json replacer` is set.
   *
   * `Cache-Control: no-store` DOES NOT MOVE, and the two are not in tension.
   * `no-store` says no cache may keep this — it is an authenticated response —
   * and a browser therefore never has a validator of its own to revalidate
   * with. This is the APPLICATION revalidating explicitly: the page holds the
   * ETag in a JS variable for as long as the tab is open, and nothing is
   * stored. See `script-base.ts`.
   *
   * EXPRESS'S OWN FRESHNESS IS NOT WHAT IS RELIED ON. It tags every response it
   * sends `W/"..."` and would answer 304 by itself — except that `req.fresh` is
   * false whenever the REQUEST carries `Cache-Control: no-cache`, which is a
   * header the client did not choose to send (Node's fetch adds it to any
   * conditional request, and a browser adds it on a reload). A saving that
   * switches itself off on a header nobody wrote is not a mechanism; this
   * comparison is one line and says what it does.
   */
  @Get('api/filings')
  @Header('Cache-Control', 'no-store')
  @UseGuards(SessionGuard)
  async getFilings(
    @Query() query: RawQuery,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
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
      // One accepted value, allowlisted like the rest: `plans=guidance` is a
      // 400 rather than a filter that matches nothing, because the pair is what
      // the question means and half of it is the wrong answer.
      plans: readEnum('plans', query, PLANS_FILTERS),
      tier: readEnum('tier', query, TIER_FILTERS),
      refusal: readFilter('refusal', query),
    });

    // TYPED ON THE WAY OUT, THOUGH THE METHOD RETURNS NOTHING. Writing through
    // `@Res` costs this route its declared return type, and the envelope's
    // shape is a contract the page parses; stated here, it is still checked.
    const envelope: ApiEnvelope<readonly FilingView[], PageMeta> = okWith(
      page.items,
      page.meta,
    );
    const body = JSON.stringify(envelope);
    // STRONG — no `W/` prefix — because it is a hash of the whole body rather
    // than of a property of it, and because the page tells this validator apart
    // from express's automatic weak one by exactly that: it revalidates against
    // the tag a route meant to issue, not against every tag a framework added.
    const validator = `"${createHash('sha256').update(body).digest('base64url')}"`;

    // ON BOTH ANSWERS. A 304 without it leaves the reader holding a validator
    // they can no longer confirm, and the next poll would be a full page again.
    response.setHeader('ETag', validator);

    // Exact equality, and deliberately no list parsing: the one client that
    // sends this header sends back the one tag it was given. A comma-separated
    // list from something else is simply not a match, which is a full page —
    // the safe direction.
    if (request.headers['if-none-match'] === validator) {
      response.status(304).end();
      return;
    }

    response.type('application/json').send(body);
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
   * The three routes below exist only where the operator panel does.
   *
   * ================================================================
   * 404 RATHER THAN 403, AND THE DIFFERENCE IS THE WHOLE POINT
   * ================================================================
   *
   * A 403 says "this exists and you may not have it", which is an answer about
   * our machinery given to whoever asked. A 404 says what is true on this host:
   * there is no such route here. It is the same statement the page makes by not
   * containing the panel, and the two must not disagree — a document without the
   * tab whose routes still answered would be the surface removed and the data
   * left behind it.
   *
   * WHY THESE THREE AND NO OTHERS. They are exactly what the Admin fragment
   * reads and nothing else on the page touches: `api/enrichment` fills the
   * refusal, state and parse-route panels; `api/categories` fills Admin's
   * category select and its panel; `api/daily` fills the per-day bars. Checked
   * by grep at the call sites, not assumed — `api/summary` is on this list's
   * doorstep and stays off it, because the feed's hero reads it too.
   *
   * The guard stays. This is a second condition on top of the session, never a
   * replacement for one.
   */
  private refuseWithoutAdmin(): void {
    if (this.adminEnabled) return;
    throw new NotFoundException('Cannot GET this route on this host.');
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
    this.refuseWithoutAdmin();
    return ok(await this.filings.getEnrichmentSummary());
  }

  /** Category breakdown across the whole collection, largest first. */
  @Get('api/categories')
  @Header('Cache-Control', 'no-store')
  @UseGuards(SessionGuard)
  async getCategories(
    @Query() query: RawQuery,
  ): Promise<ApiEnvelope<readonly CategoryCount[]>> {
    this.refuseWithoutAdmin();
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
    this.refuseWithoutAdmin();
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
