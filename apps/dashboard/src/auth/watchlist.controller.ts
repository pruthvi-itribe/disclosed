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
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
import { istTimestamp } from '@app/common';
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
import { SkipAuthLimits, SkipEveryLimit } from './throttle';

/** One row of the watchlist, with what the directory already knows about it. */
export interface WatchedCompany {
  readonly symbol: string;
  readonly companyName: string;
  readonly addedAt: string;
  readonly filingsHeld: number;
  /**
   * The instant this company last filed anything held here, or null when
   * nothing is.
   *
   * NULL IS A REAL ANSWER AND IS RENDERED AS ONE — "nothing yet in our window",
   * not a date. `add` refuses a symbol the directory does not hold, so this is
   * rare rather than impossible: the directory snapshot is up to 60s old, so a
   * company added on the strength of it can still be ahead of what the filings
   * query sees.
   */
  readonly lastFiledAt: string | null;
  /** The same instant as IST text, because the server owns that formatting. */
  readonly lastFiledAtIst: string | null;
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
@SkipAuthLimits()
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
   * `companyName` and `filingsHeld` come from the directory SNAPSHOT, so those
   * two cost no database read at all. A company added to the watchlist within
   * the last minute may not be in the snapshot yet — it renders with its symbol
   * as its name and a zero count, which is late rather than wrong, and the next
   * refresh fixes it.
   *
   * `lastFiledAt` is the one read: a single `$group` bounded by the 50-symbol
   * cap. See `FilingQueryService.lastFiledFor` for why it is not folded into
   * the snapshot.
   */
  @Get()
  @Header('Cache-Control', 'no-store')
  @SkipEveryLimit()
  async list(
    @Req() request: AuthedRequest,
  ): Promise<ApiEnvelope<readonly WatchedCompany[], WatchlistMeta>> {
    const rows = await this.watchedRows(request.signedin!.userId);

    return okWith(rows, { used: rows.length, cap: MAX_WATCHED_SYMBOLS });
  }

  /**
   * Every watched company as a row, oldest entry first.
   *
   * ORDERED BY WHEN IT WAS ADDED, not by when it last filed. The Watching view
   * repaints every four seconds; ordering by activity would reshuffle the list
   * under a reader's cursor every time somebody filed.
   */
  private async watchedRows(
    userId: string,
  ): Promise<readonly WatchedCompany[]> {
    const entries = await this.watchlists.entriesFor(userId);
    const [snapshot, lastFiled] = await Promise.all([
      this.directory.snapshot(),
      this.filings.lastFiledFor(entries.map((entry) => entry.symbol)),
    ]);

    return entries.map((entry) => {
      const known = snapshot.companies.find(
        (company) => company.symbol === entry.symbol,
      );
      const last = lastFiled.get(entry.symbol) ?? null;
      return {
        symbol: entry.symbol,
        companyName: known?.companyName ?? entry.symbol,
        addedAt: entry.addedAt.toISOString(),
        filingsHeld: known?.filings ?? 0,
        lastFiledAt: last === null ? null : last.toISOString(),
        lastFiledAtIst: last === null ? null : istTimestamp(last),
      };
    });
  }

  /**
   * The v1 alert surface: this reader's symbols, newest first — and, beside it,
   * the watchlist itself.
   *
   * RETURNS THE SAME SHAPE `api/filings` DOES, so the page's `renderFeedInto`
   * draws it unchanged — which is the largest saving in the whole design.
   *
   * ================================================================
   * WHY THE WATCHLIST TRAVELS IN THIS RESPONSE'S META
   * ================================================================
   *
   * `data` is a PAGE OF FILINGS: the newest `limit` of them across the whole
   * watchlist. That is not the watchlist, and shipping only that is what the
   * founder reported — a company that files less often than the others than
   * appeared nowhere on the view, so watching it looked broken rather than
   * quiet. `meta.watching` is every watched company, unpaged and uncapped by
   * anything but `MAX_WATCHED_SYMBOLS`.
   *
   * In the SAME response rather than a second request, for two reasons. The
   * page polls this route every four seconds while the tab is open, and two
   * round trips per poll would double that; and a roster fetched separately
   * could disagree with the page of filings beside it — a card from a company
   * the roster had not listed yet. One response cannot disagree with itself.
   *
   * `meta.total` against `meta.returned` is what lets the page state the
   * narrowing in numbers instead of quietly showing a short list.
   *
   * It also STAMPS the watchlist as seen, which is what makes the unread badge
   * mean "since you last looked". Stamped on the way out rather than on the way
   * in, so a request that fails does not silently mark filings as read.
   */
  @Get('feed')
  @Header('Cache-Control', 'no-store')
  @SkipEveryLimit()
  async feed(
    @Req() request: AuthedRequest,
    @Query() query: RawQuery,
  ): Promise<
    ApiEnvelope<
      readonly FilingView[],
      PageMeta & { unread: number; watching: readonly WatchedCompany[] }
    >
  > {
    const who = request.signedin!;
    const entries = await this.watchlists.entriesFor(who.userId);
    const symbols = entries.map((entry) => entry.symbol);

    const [page, unread, watching] = await Promise.all([
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
      this.watchedRows(who.userId),
    ]);

    await this.users.markWatchlistSeen(who.userId, this.now());

    return okWith(page.items, { ...page.meta, unread, watching });
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
    @Res({ passthrough: true }) response: Response,
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

    // 201 for a CREATED entry, 200 for one that was already there. The bodies
    // are identical on purpose — a double-click is not an error, and the page
    // has nothing different to do — but the status still says which of the two
    // happened, which is what a status line is for.
    response.status(result.outcome === 'added' ? 201 : 200);

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
