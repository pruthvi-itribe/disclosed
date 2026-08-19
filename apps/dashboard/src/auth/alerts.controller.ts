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
import { ThrottlerGuard } from '@nestjs/throttler';
import { UserRepository, WatchlistRepository } from '@app/accounts';
import { CLAIM_TOPICS } from '@app/filings';
import { ok, okWith, type ApiEnvelope } from '../http/envelope';
import { FilingQueryService } from '../filings/filing-query.service';
import type { FilingView, PageMeta } from '../filings/dashboard.types';
import {
  readBoundedInteger,
  readSingle,
  type RawQuery,
} from '../http/query-params';
import { ApiError, ApiErrorFilter } from './api-error';
import { JsonOnlyGuard } from './json-only.guard';
import { OriginGuard, SessionGuard, type AuthedRequest } from './session.guard';
import { SkipAuthLimits, SkipEveryLimit } from './throttle';

/** The alerts feed's own page bounds — the same numbers the watchlist uses. */
const DEFAULT_ALERT_LIMIT = 25;
const MAX_ALERT_LIMIT = 200;
const MAX_ALERT_OFFSET = 10_000;

/**
 * Topic subscriptions, and the one feed every alert channel reads.
 *
 * THE VOCABULARY IS OURS AND CLOSED. A subscription names a CLAIM_TOPICS
 * member — the chip row's own list, decided by our claim extractor — and an
 * unknown topic is a 400, never a silently stored string that will never
 * match anything ("nothing was found" and "nothing was looked for" must not
 * render the same). Deliberately NOT NSE's category names: the fail-open
 * rule forbids keying any gate on names the exchange controls.
 *
 * THE FEED IS THE PREDICATE, COMPUTED ONCE: verified filings from watched
 * companies OR subscribed topics (`getAlertPage`). The desktop notifier
 * reads this route today and Phase B's push fan-out reads the same query
 * method, so the channels cannot drift. Which arm matched is presentation,
 * decided by the caller from the row's own symbol and topics.
 */
@Controller('api/alerts')
@UseFilters(ApiErrorFilter)
@UseGuards(SessionGuard, ThrottlerGuard)
// The auth buckets are for the routes an attacker attacks without an account.
@SkipAuthLimits()
export class AlertsController {
  constructor(
    private readonly users: UserRepository,
    private readonly watchlists: WatchlistRepository,
    private readonly filings: FilingQueryService,
  ) {}

  /** The allowlist, applied identically on the way in and the way out. */
  private requireKnownTopic(raw: string | undefined): string {
    const topic = (raw ?? '').trim().toLowerCase();
    if (!(CLAIM_TOPICS as readonly string[]).includes(topic)) {
      throw new ApiError(
        'UNKNOWN_TOPIC',
        'That is not a topic this product classifies claims into.',
        400,
      );
    }
    return topic;
  }

  /**
   * Subscribes to a topic. Idempotent — a double-tap is not an error — and
   * the answer is the whole list, so the panel never has to guess.
   */
  @Post('topics')
  @Header('Cache-Control', 'no-store')
  // 200 always: subscribing twice is not a creation event twice.
  @HttpCode(200)
  @UseGuards(JsonOnlyGuard, OriginGuard)
  async subscribe(
    @Req() request: AuthedRequest,
    @Query() query: RawQuery,
  ): Promise<ApiEnvelope<{ topics: readonly string[] }>> {
    const topic = this.requireKnownTopic(readSingle('topic', query));
    const userId = request.signedin!.userId;
    await this.users.addAlertTopic(userId, topic);
    return ok({ topics: await this.users.alertTopicsFor(userId) });
  }

  @Delete('topics/:topic')
  @Header('Cache-Control', 'no-store')
  @UseGuards(JsonOnlyGuard, OriginGuard)
  async unsubscribe(
    @Req() request: AuthedRequest,
    @Param('topic') raw: string,
  ): Promise<ApiEnvelope<{ topics: readonly string[] }>> {
    const topic = this.requireKnownTopic(raw);
    const userId = request.signedin!.userId;
    await this.users.removeAlertTopic(userId, topic);
    return ok({ topics: await this.users.alertTopicsFor(userId) });
  }

  /**
   * The watched-companies arm's switch, in the topics' own idiom: POST is
   * on, DELETE is off, both idempotent, both answering the stored state.
   */
  @Post('watchlist')
  @Header('Cache-Control', 'no-store')
  @HttpCode(200)
  @UseGuards(JsonOnlyGuard, OriginGuard)
  async watchlistOn(
    @Req() request: AuthedRequest,
  ): Promise<ApiEnvelope<{ watchlist: boolean }>> {
    const userId = request.signedin!.userId;
    await this.users.setAlertWatchlist(userId, true);
    return ok({ watchlist: true });
  }

  @Delete('watchlist')
  @Header('Cache-Control', 'no-store')
  @UseGuards(JsonOnlyGuard, OriginGuard)
  async watchlistOff(
    @Req() request: AuthedRequest,
  ): Promise<ApiEnvelope<{ watchlist: boolean }>> {
    const userId = request.signedin!.userId;
    await this.users.setAlertWatchlist(userId, false);
    return ok({ watchlist: false });
  }

  /**
   * What deserves this reader's attention, newest first. Meta carries the
   * subscriptions the union was computed from, so a caller can attribute
   * each row without a second read.
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
      PageMeta & {
        topics: readonly string[];
        watched: readonly string[];
      }
    >
  > {
    const userId = request.signedin!.userId;
    const [entries, topics, watchlistOn] = await Promise.all([
      this.watchlists.entriesFor(userId),
      this.users.alertTopicsFor(userId),
      this.users.alertWatchlistFor(userId),
    ]);
    // The switch silences the ARM, not the banner: an off watchlist
    // contributes no symbols to the predicate at all.
    const symbols = watchlistOn ? entries.map((entry) => entry.symbol) : [];

    const page = await this.filings.getAlertPage(
      symbols,
      topics,
      readBoundedInteger('limit', query, {
        fallback: DEFAULT_ALERT_LIMIT,
        min: 1,
        max: MAX_ALERT_LIMIT,
      }),
      readBoundedInteger('offset', query, {
        fallback: 0,
        min: 0,
        max: MAX_ALERT_OFFSET,
      }),
    );

    return okWith(page.items, { ...page.meta, topics, watched: symbols });
  }
}
