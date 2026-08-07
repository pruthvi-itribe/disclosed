import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { isAllowedOrigin } from '@app/accounts';
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
  private readonly publicOrigin: string;

  /**
   * Reads the allowed origin ONCE, at construction.
   *
   * Through `ConfigService` rather than as an injected string because Nest
   * instantiates a route-level guard from its own class metadata — a custom
   * provider for the same class token is not consulted — so a primitive
   * constructor argument here is a container error at boot.
   */
  constructor(config: ConfigService) {
    this.publicOrigin = config.getOrThrow<string>('publicOrigin');
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    if (!isAllowedOrigin(request.headers.origin, this.publicOrigin)) {
      throw new ApiError(
        'BAD_ORIGIN',
        'This request did not come from this site.',
        403,
      );
    }

    return true;
  }
}
