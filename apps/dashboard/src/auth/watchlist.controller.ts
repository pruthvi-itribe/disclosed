import {
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle, ThrottlerGuard } from '@nestjs/throttler';
import {
  isPlausibleSymbol,
  MAX_WATCHED_SYMBOLS,
  normaliseWatchSymbol,
  UserRepository,
  WatchlistRepository,
} from '@app/accounts';
import { okWith, type ApiEnvelope } from '../http/envelope';
import { FilingQueryService } from '../filings/filing-query.service';
import type { FilingView, PageMeta } from '../filings/dashboard.types';
import {
  readBoundedInteger,
  readSingle,
  type RawQuery,
} from '../http/query-params';
import { CompanyDirectory } from '../search/company-directory';
import { ApiError, ApiErrorFilter } from './api-error';
import { OriginGuard, SessionGuard, type AuthedRequest } from './session.guard';

/** One row of the watchlist, with what the directory already knows about it. */
export interface WatchedCompany {
  readonly symbol: string;
  readonly companyName: string;
  readonly addedAt: string;
  readonly filingsHeld: number;
}

/** `{used, cap}` on every response, so the page can always draw the counter. */
export interface WatchlistMeta {
  readonly used: number;
  readonly cap: number;
}

/** Rows returned by the Watching feed when `limit` is absent. */
export const DEFAULT_WATCH_LIMIT = 25;
export const MAX_WATCH_LIMIT = 200;
export const MAX_WATCH_OFFSET = 100_000;

/**
 * The watchlist, and the feed over it.
 *
 * ================================================================
 * NO BODY IS READ ON ANY ROUTE HERE
 * ================================================================
 *
 * The mutations carry their one parameter in the query string and the path, and
 * that is what keeps body parsing scoped to `/api/auth`. It is not a
 * workaround: `readSingle` in `http/query-params.ts` already refuses the array
 * and object query shapes — "the object form is the shape a NoSQL-injection
 * attempt takes" — so the mutation input goes through the same hardened reader
 * as every existing filter, and a ticker in an access log is public data.
 *
 * ================================================================
 * THE USER ID COMES FROM THE SESSION, NEVER FROM A PARAMETER
 * ================================================================
 *
 * There is no route here on which one user can name another. That is the whole
 * of the authorisation model, and it is enforced by there being nowhere to put
 * somebody else's id.
 */
@Controller('api/watchlist')
@UseFilters(ApiErrorFilter)
@UseGuards(SessionGuard, ThrottlerGuard)
// The auth buckets are for the routes an attacker attacks without an account.
@SkipThrottle({ 'auth-minute': true, 'auth-hour': true })
export class WatchlistController {
  constructor(
    private readonly watchlists: WatchlistRepository,
    private readonly users: UserRepository,
    private readonly filings: FilingQueryService,
    private readonly directory: CompanyDirectory,
  ) {}

  /**
   * The clock.
   *
   * A method rather than an injected `() => Date`, unlike `FilingQueryService`:
   * a controller's constructor parameters are what Nest injects, and a
   * defaulted function parameter there is a container error at boot. Nothing
   * here does date ARITHMETIC — it stamps `addedAt` and `lastSeenWatchlistAt` —
   * so there is no calculation a fixed clock would need to pin.
   */
  private now(): Date {
    return new Date();
  }

  /**
   * The watchlist, oldest entry first.
   *
   * `companyName` and `filingsHeld` come from the directory SNAPSHOT, so this
   * route costs zero database reads beyond the one watchlist document. A
   * company added to the watchlist within the last minute may not be in the
   * snapshot yet — it renders with its symbol as its name and a zero count,
   * which is late rather than wrong, and the next refresh fixes it.
   */
  @Get()
  @Header('Cache-Control', 'no-store')
  @SkipThrottle()
  async list(
    @Req() request: AuthedRequest,
  ): Promise<ApiEnvelope<readonly WatchedCompany[], WatchlistMeta>> {
    const entries = await this.watchlists.entriesFor(request.signedin!.userId);
    const snapshot = await this.directory.snapshot();

    const rows = entries.map((entry) => {
      const known = snapshot.companies.find(
        (company) => company.symbol === entry.symbol,
      );
      return {
        symbol: entry.symbol,
        companyName: known?.companyName ?? entry.symbol,
        addedAt: entry.addedAt.toISOString(),
        filingsHeld: known?.filings ?? 0,
      };
    });

    return okWith(rows, { used: rows.length, cap: MAX_WATCHED_SYMBOLS });
  }

  /**
   * The v1 alert surface: this reader's symbols, newest first.
   *
   * RETURNS THE SAME SHAPE `api/filings` DOES, so the page's `renderFeedInto`
   * draws it unchanged — which is the largest saving in the whole design.
   *
   * It also STAMPS the watchlist as seen, which is what makes the unread badge
   * mean "since you last looked". Stamped on the way out rather than on the way
   * in, so a request that fails does not silently mark filings as read.
   */
  @Get('feed')
  @Header('Cache-Control', 'no-store')
  @SkipThrottle()
  async feed(
    @Req() request: AuthedRequest,
    @Query() query: RawQuery,
  ): Promise<
    ApiEnvelope<readonly FilingView[], PageMeta & { unread: number }>
  > {
    const who = request.signedin!;
    const entries = await this.watchlists.entriesFor(who.userId);
    const symbols = entries.map((entry) => entry.symbol);

    const [page, unread] = await Promise.all([
      this.filings.getWatchedPage(
        symbols,
        readBoundedInteger('limit', query, {
          fallback: DEFAULT_WATCH_LIMIT,
          min: 1,
          max: MAX_WATCH_LIMIT,
        }),
        readBoundedInteger('offset', query, {
          fallback: 0,
          min: 0,
          max: MAX_WATCH_OFFSET,
        }),
      ),
      this.filings.countWatchedSince(symbols, who.lastSeenWatchlistAt),
    ]);

    await this.users.markWatchlistSeen(who.userId, this.now());

    return okWith(page.items, { ...page.meta, unread });
  }

  /**
   * Adds a symbol.
   *
   * `200` rather than `201` when it was already there, with the same body:
   * idempotent, because a double-click is not an error.
   *
   * `422 UNKNOWN_SYMBOL` when the directory does not hold it. REFUSED, NOT
   * ACCEPTED — a silently accepted typo is a watchlist entry that will never
   * alert and that the reader believes is working, and "nothing was found" and
   * "nothing was looked for" must not render the same. The known cost of that
   * strictness is a reader who cannot watch a company before it has ever filed;
   * a real NSE symbol master is follow-on F9.
   */
  @Post()
  @Header('Cache-Control', 'no-store')
  @UseGuards(OriginGuard)
  async add(
    @Req() request: AuthedRequest,
    @Query() query: RawQuery,
  ): Promise<ApiEnvelope<{ symbol: string; addedAt: string }, WatchlistMeta>> {
    const symbol = await this.requireKnownSymbol(query);
    const result = await this.watchlists.add(
      request.signedin!.userId,
      symbol,
      this.now(),
    );

    if (result.outcome === 'full') {
      throw new ApiError(
        'WATCHLIST_FULL',
        `You are watching ${result.used} companies, which is the limit. ` +
          'Remove one to add another.',
        409,
        { used: result.used, cap: MAX_WATCHED_SYMBOLS },
      );
    }

    const entries = await this.watchlists.entriesFor(request.signedin!.userId);
    const stored = entries.find((entry) => entry.symbol === symbol);

    return okWith(
      { symbol, addedAt: (stored?.addedAt ?? this.now()).toISOString() },
      { used: result.used, cap: MAX_WATCHED_SYMBOLS },
    );
  }

  /** Removes a symbol. `200` even when it was not there, for the same reason. */
  @Delete(':symbol')
  @Header('Cache-Control', 'no-store')
  @UseGuards(OriginGuard)
  @HttpCode(200)
  async remove(
    @Req() request: AuthedRequest,
    @Param('symbol') raw: string,
  ): Promise<ApiEnvelope<{ removed: true }, WatchlistMeta>> {
    const symbol = normaliseWatchSymbol(raw);
    if (!isPlausibleSymbol(symbol)) {
      throw new ApiError('INVALID_SYMBOL', 'That is not a ticker.', 422);
    }

    const result = await this.watchlists.remove(
      request.signedin!.userId,
      symbol,
      this.now(),
    );

    return okWith(
      { removed: true as const },
      { used: result.used, cap: MAX_WATCHED_SYMBOLS },
    );
  }

  /**
   * The symbol, if the directory holds it.
   *
   * Two gates in order, cheapest first: the shape check refuses a paste without
   * touching anything, and the directory check refuses a well-formed ticker
   * nobody has filed under.
   */
  private async requireKnownSymbol(query: RawQuery): Promise<string> {
    const raw = readSingle('symbol', query);
    if (raw === undefined) {
      throw new ApiError('INVALID_SYMBOL', 'Name a company to watch.', 422);
    }

    const symbol = normaliseWatchSymbol(raw);
    if (!isPlausibleSymbol(symbol)) {
      throw new ApiError('INVALID_SYMBOL', 'That is not a ticker.', 422);
    }

    const snapshot = await this.directory.snapshot();
    if (!snapshot.companies.some((company) => company.symbol === symbol)) {
      throw new ApiError(
        'UNKNOWN_SYMBOL',
        `No filings are held for ${symbol}.`,
        422,
      );
    }

    return symbol;
  }
}
