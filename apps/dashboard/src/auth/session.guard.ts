import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { isAllowedOrigin, readSessionToken } from '@app/accounts';
import { ApiError } from './api-error';
import type { Signedin } from './session.service';
import { SessionService } from './session.service';

/**
 * A request with whoever it turned out to be attached.
 *
 * The guard writes this and the handlers read it. THE USER ID COMES FROM HERE
 * AND NEVER FROM A PARAMETER — there is no route on which one user can name
 * another, which is the whole of this application's authorisation model.
 */
export interface AuthedRequest extends Request {
  signedin?: Signedin;
}

/** ONE guard, on every route that needs a user. 401 when there is none. */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const signedin = await this.sessions.resolve(request);

    if (signedin === null) {
      throw new ApiError('UNAUTHENTICATED', 'Sign in to use this.', 401);
    }

    request.signedin = signedin;
    return true;
  }
}

/**
 * The CSRF guard, on every mutating route.
 *
 * The second layer after `SameSite=Lax`, and it is a separate guard from the
 * session one because the two answer different questions and apply to different
 * sets of routes: `POST /api/auth/login` needs this and has no session yet.
 *
 * A 403 rather than a 401: the caller is not unauthenticated, they are asking
 * from somewhere this application does not serve.
 */
@Injectable()
export class OriginGuard implements CanActivate {
  private readonly allowedOrigins: readonly string[];

  /**
   * Reads the allowed origins ONCE, at construction.
   *
   * Through `ConfigService` rather than as an injected string because Nest
   * instantiates a route-level guard from its own class metadata — a custom
   * provider for the same class token is not consulted — so a primitive
   * constructor argument here is a container error at boot.
   *
   * THE CREDENTIALED-CORS LIST IS PART OF THE ALLOWANCE, and that is one
   * trust decision rather than a loosening: an operator who lists an origin
   * in CORS_ALLOWED_ORIGINS (never `*` — the reader refuses one) has already
   * declared that origin may make cookie-carrying requests, and refusing its
   * mutations here while CORS accepts its credentials would be two rules
   * disagreeing about the same origin. In production the list is empty and
   * nothing changes; the mobile shell's fixed WebView origin is the case
   * this exists for.
   */
  constructor(config: ConfigService) {
    this.allowedOrigins = [
      config.getOrThrow<string>('publicOrigin'),
      ...config.getOrThrow<readonly string[]>('corsAllowedOrigins'),
    ];
  }

  /**
   * CSRF DEFENDS AMBIENT AUTHORITY, so this check keys on the TRANSPORT that
   * carried the credential rather than on the route.
   *
   * A browser attaches cookies by itself and never attaches an `Authorization`
   * header by itself. A forged cross-site request can therefore ride a cookie
   * and cannot ride a Bearer token, so a Bearer request has nothing for this
   * check to protect and is refused by it only spuriously — which is what a
   * phone, sending no `Origin` at all, would have hit on every mutation.
   *
   * `origin-guard.ts` justified refusing an absent `Origin` with "an absent one
   * on a mutation means a non-browser client — which holds no cookie this
   * design would honour anyway". That was true until Bearer existed, and it is
   * the sentence this change invalidates: a non-browser client now holds a
   * credential this design does honour. The refusal itself is unchanged and
   * still applies to every cookie-carried mutation; what changed is that the
   * caller now decides which requests it covers.
   *
   * WHAT COVERS A BEARER REQUEST INSTEAD is the browser's own cross-origin
   * rules. An `Authorization` header makes a request non-simple, so a
   * cross-site caller has to clear a CORS preflight before the real request is
   * sent — and this application enables no CORS, so the preflight goes
   * unanswered and the browser never sends it. An HTML form, which needs no
   * preflight, cannot set the header at all.
   *
   * READS THE HEADERS ITSELF rather than trusting anything `SessionGuard` left
   * on the request, because there is no ordering to depend on:
   * `POST /api/auth/login` carries this guard and no `SessionGuard`. Both call
   * `readSessionToken`, so the two cannot disagree about what a request is.
   */
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    const presented = readSessionToken(
      request.headers.authorization,
      request.headers.cookie,
    );
    if (presented?.transport === 'bearer') return true;

    const allowed = this.allowedOrigins.some((candidate) =>
      isAllowedOrigin(request.headers.origin, candidate),
    );
    if (!allowed) {
      throw new ApiError(
        'BAD_ORIGIN',
        'This request did not come from this site.',
        403,
      );
    }

    return true;
  }
}
