import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UseFilters,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  MAX_WATCHED_SYMBOLS,
  parseChannels,
  UserRepository,
  WatchlistRepository,
} from '@app/accounts';
import type { AuthConfig } from '../config/auth-config';
import { ok, type ApiEnvelope } from '../http/envelope';
import { FilingQueryService } from '../filings/filing-query.service';
import { ApiError, ApiErrorFilter } from './api-error';
import { JsonOnlyGuard } from './json-only.guard';
import { AuthService } from './auth.service';
import {
  ChangePasswordDto,
  CredentialsDto,
  FirebaseTokenDto,
} from './auth.dto';
import { AUTH_CONFIG, FIREBASE_SIGN_IN } from './auth.tokens';
import type { FirebaseSignInService } from './firebase-sign-in';
import { authNotConfigured } from './firebase-verifier';
import { OriginGuard, SessionGuard, type AuthedRequest } from './session.guard';
import { SessionService } from './session.service';
import { SkipEveryLimit, SkipWatchlistLimit } from './throttle';

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
@SkipWatchlistLimit()
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
    @Inject(AUTH_CONFIG) private readonly authConfig: AuthConfig,
    @Inject(FIREBASE_SIGN_IN)
    private readonly firebase: FirebaseSignInService | null,
  ) {}

  /**
   * Signs in a browser that has already proved who it is to Firebase.
   *
   * ================================================================
   * FIREBASE IS IDENTITY. THE SESSION IS STILL OURS.
   * ================================================================
   *
   * What comes in is a short-lived Google-signed ID token. What goes back is the
   * same opaque, revocable, `HttpOnly` cookie every other sign-in on this
   * application has ever set, pointing at a row in OUR sessions collection. The
   * ID token is verified, used once to decide which user this is, and dropped —
   * it is never stored, never refreshed and never presented to anything else.
   *
   * That is what keeps "log me out everywhere" working, keeps a session
   * revocable from our own database, and keeps every downstream guard unable to
   * tell which provider a session came from.
   *
   * Origin-guarded and throttled by the same two auth buckets as the password
   * routes, because it is the same door.
   */
  @Post('auth/firebase')
  @Header('Cache-Control', 'no-store')
  @UseGuards(JsonOnlyGuard, OriginGuard)
  @HttpCode(200)
  async firebaseSignIn(
    @Body() body: FirebaseTokenDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ApiEnvelope<{ signedIn: true; email: string }>> {
    if (this.firebase === null) {
      // Two different situations, and the message distinguishes them because
      // both are operator-facing rather than attacker-facing: the keys are
      // missing, or this host runs the in-house path on purpose.
      throw this.authConfig.mode === 'firebase'
        ? authNotConfigured(this.authConfig.missing)
        : new ApiError(
            'FIREBASE_DISABLED',
            'This server signs in with an email address and a password.',
            409,
          );
    }

    const user = await this.firebase.signIn(body.idToken);
    await this.sessions.open(user.id, request, response);
    return ok({ signedIn: true as const, email: user.email });
  }

  /**
   * Registers and signs the user straight in.
   *
   * `201`. MVP day has no verification lane, so there is nothing to wait for —
   * and a "check your email" that never sends is worse than an honest signup.
   */
  @Post('auth/register')
  @Header('Cache-Control', 'no-store')
  @UseGuards(JsonOnlyGuard, OriginGuard)
  @HttpCode(201)
  async register(
    @Body() body: CredentialsDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ApiEnvelope<{ signedIn: true; email: string }>> {
    this.requireLocalMode();
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
  @UseGuards(JsonOnlyGuard, OriginGuard)
  @HttpCode(200)
  async login(
    @Body() body: CredentialsDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ApiEnvelope<{ signedIn: true; email: string }>> {
    this.requireLocalMode();
    const user = await this.auth.signIn(body.email, body.password);
    await this.sessions.open(user.id, request, response);
    return ok({ signedIn: true as const, email: user.email });
  }

  /**
   * DORMANT, NOT DELETED, and this method is the whole of the dormancy.
   *
   * The in-house password path — argon2id, the persisted per-account backoff,
   * the one-message enumeration-resistant failure — is untouched and complete.
   * On a host running Firebase it simply has no open door, because two live
   * credential paths to one account is two attack surfaces and one of them
   * would never be watched.
   *
   * A 409 rather than a 404: the route exists and the caller is not wrong about
   * that, the server is configured the other way. It names the alternative,
   * because the person who sees this is an operator or a stale browser tab.
   *
   * `logout`, `logout-all` and `api/me` are deliberately NOT gated. They operate
   * on a session that already exists, and a session is provider-agnostic; a
   * mode flip must never strand a signed-in reader with no way to sign out.
   * `auth/password` gates itself: a Firebase account has no password hash, and
   * `AuthService.changePassword` refuses on that rather than on the mode.
   */
  private requireLocalMode(): void {
    if (this.authConfig.mode === 'local') return;
    throw new ApiError(
      'LOCAL_AUTH_DISABLED',
      'This server signs in with Google. Use the sign-in page.',
      409,
    );
  }

  /** Ends this session and clears the cookie. */
  @Post('auth/logout')
  @Header('Cache-Control', 'no-store')
  @UseGuards(JsonOnlyGuard, OriginGuard)
  @HttpCode(200)
  @SkipEveryLimit()
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
  @UseGuards(JsonOnlyGuard, SessionGuard, OriginGuard)
  @HttpCode(200)
  @SkipEveryLimit()
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
  @UseGuards(JsonOnlyGuard, SessionGuard, OriginGuard)
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
  @SkipEveryLimit()
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
