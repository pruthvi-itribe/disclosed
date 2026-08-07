import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Post,
  Req,
  Res,
  UseFilters,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { SkipThrottle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  MAX_WATCHED_SYMBOLS,
  parseChannels,
  UserRepository,
  WatchlistRepository,
} from '@app/accounts';
import { ok, type ApiEnvelope } from '../http/envelope';
import { FilingQueryService } from '../filings/filing-query.service';
import { ApiErrorFilter } from './api-error';
import { AuthService } from './auth.service';
import { ChangePasswordDto, CredentialsDto } from './auth.dto';
import { OriginGuard, SessionGuard, type AuthedRequest } from './session.guard';
import { SessionService } from './session.service';

/** What `api/me` answers. Signed out, only the first field is present. */
export interface MeView {
  readonly signedIn: boolean;
  readonly email?: string;
  readonly watchCount?: number;
  readonly watchCap?: number;
  readonly unread?: number;
  readonly channels?: ReadonlyArray<{ kind: string; enabled: boolean }>;
}

/**
 * Register, sign in, sign out, and "who am I".
 *
 * ================================================================
 * THE ONLY ROUTES ON THIS APPLICATION THAT READ A BODY
 * ================================================================
 *
 * A password cannot travel in a query string: query strings land in access
 * logs, in `Referer` headers and in browser history. So `express.json` is
 * mounted on `/api/auth` and nowhere else — see `dashboard.module.ts`, which
 * carries the argument and the 4 KB limit. Watchlist mutations take their
 * parameters in the path and the query string precisely so this stays the only
 * exception.
 *
 * ================================================================
 * EVERY MUTATION IS ORIGIN-GUARDED
 * ================================================================
 *
 * `SameSite=Lax` already withholds the cookie on a cross-site POST; the guard
 * is the second layer. `GET api/me` is not guarded, because it is a read and
 * because a GET cannot be the CSRF that matters here.
 */
@Controller('api')
// ON THIS CONTROLLER ONLY, so every pre-existing route's error body stays
// byte-identical. The filter adds the failure envelope and refuses to serialise
// anything an exception carried.
@UseFilters(ApiErrorFilter)
@UseGuards(ThrottlerGuard)
// The watchlist bucket is a different question and a different route set.
@SkipThrottle({ 'watchlist-minute': true })
/**
 * `whitelist` IS THE CLAUSE THAT MATTERS, and `forbidNonWhitelisted` is what
 * makes it audible. Together with `@IsString()` on every DTO field they are what
 * stops `{"email": {"$gt": ""}}` reaching `findOne({email})` as a Mongo
 * operator and matching the first user in the collection — the classic NoSQL
 * authentication bypass. Applied HERE rather than globally, so no existing
 * route's request handling changes.
 */
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }),
)
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly users: UserRepository,
    private readonly watchlists: WatchlistRepository,
    private readonly filings: FilingQueryService,
  ) {}

  /**
   * Registers and signs the user straight in.
   *
   * `201`. MVP day has no verification lane, so there is nothing to wait for —
   * and a "check your email" that never sends is worse than an honest signup.
   */
  @Post('auth/register')
  @Header('Cache-Control', 'no-store')
  @UseGuards(OriginGuard)
  @HttpCode(201)
  async register(
    @Body() body: CredentialsDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ApiEnvelope<{ signedIn: true; email: string }>> {
    const user = await this.auth.register(body.email, body.password);
    await this.sessions.open(user.id, request, response);
    return ok({ signedIn: true as const, email: user.email });
  }

  /**
   * Signs in, with a FRESH token every time.
   *
   * Whatever cookie the request presented is discarded rather than adopted: a
   * session token is minted at authentication and never reused across one.
   */
  @Post('auth/login')
  @Header('Cache-Control', 'no-store')
  @UseGuards(OriginGuard)
  @HttpCode(200)
  async login(
    @Body() body: CredentialsDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ApiEnvelope<{ signedIn: true; email: string }>> {
    const user = await this.auth.signIn(body.email, body.password);
    await this.sessions.open(user.id, request, response);
    return ok({ signedIn: true as const, email: user.email });
  }

  /** Ends this session and clears the cookie. */
  @Post('auth/logout')
  @Header('Cache-Control', 'no-store')
  @UseGuards(OriginGuard)
  @HttpCode(200)
  @SkipThrottle()
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ApiEnvelope<{ signedIn: false }>> {
    await this.sessions.close(request, response);
    return ok({ signedIn: false as const });
  }

  /** Ends every session this user has. */
  @Post('auth/logout-all')
  @Header('Cache-Control', 'no-store')
  @UseGuards(SessionGuard, OriginGuard)
  @HttpCode(200)
  @SkipThrottle()
  async logoutAll(
    @Req() request: AuthedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ApiEnvelope<{ signedIn: false; ended: number }>> {
    const ended = await this.sessions.closeAll(
      request.signedin!.userId,
      request,
      response,
    );
    return ok({ signedIn: false as const, ended });
  }

  /**
   * Changes the password, revokes every OTHER session, and re-mints this one.
   *
   * Both halves matter. Leaving other sessions alive makes "I changed my
   * password because I think someone has it" do nothing; keeping this session's
   * existing token would reuse a token across an authentication boundary.
   */
  @Post('auth/password')
  @Header('Cache-Control', 'no-store')
  @UseGuards(SessionGuard, OriginGuard)
  @HttpCode(200)
  async changePassword(
    @Body() body: ChangePasswordDto,
    @Req() request: AuthedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ApiEnvelope<{ signedIn: true; email: string }>> {
    const who = request.signedin!;
    await this.auth.changePassword(who.userId, body.current, body.next);
    await this.sessions.closeAll(who.userId, request, response);
    await this.sessions.open(who.userId, request, response);
    return ok({ signedIn: true as const, email: who.email });
  }

  /**
   * Who this browser is, and the two counts the header draws.
   *
   * SIGNED OUT IS A 200, NOT A 401. The page asks this on every load, and a 401
   * on the ordinary anonymous path is console noise that trains people to
   * ignore the real ones. It is also why this route has no `SessionGuard`: the
   * guard's job is to refuse, and this route's job is to answer.
   *
   * Not throttled. It is one read per page load, and the public-reads bucket
   * belongs to the exposure gate.
   */
  @Get('me')
  @Header('Cache-Control', 'no-store')
  @SkipThrottle()
  async me(@Req() request: Request): Promise<ApiEnvelope<MeView>> {
    const who = await this.sessions.resolve(request);
    if (who === null) return ok({ signedIn: false });

    const entries = await this.watchlists.entriesFor(who.userId);
    const symbols = entries.map((entry) => entry.symbol);

    return ok({
      signedIn: true,
      email: who.email,
      watchCount: entries.length,
      watchCap: MAX_WATCHED_SYMBOLS,
      unread: await this.filings.countWatchedSince(
        symbols,
        who.lastSeenWatchlistAt,
      ),
      // Parsed rather than passed through: `config` is `Mixed`, and the page
      // only ever needs the kind and the switch. Sending the config would put
      // an email address in a payload that draws two toggles.
      channels: parseChannels(await this.users.channelsFor(who.userId)).map(
        (channel) => ({ kind: channel.kind, enabled: channel.enabled }),
      ),
    });
  }
}
