import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiError } from './api-error';

/**
 * Every mutating route must be asked in JSON.
 *
 * THIS IS A CSRF CONTROL, not a tidiness rule, and it is what lets
 * `OriginGuard` skip the origin check for a Bearer request. An HTML form can
 * emit only `application/x-www-form-urlencoded`, `multipart/form-data` or
 * `text/plain` — never `application/json` — so a cross-origin form POST cannot
 * reach a handler here. Everything else cross-origin is then a preflighted
 * request, which the CORS allowlist answers before the real one is sent.
 *
 * IT APPLIES TO BODYLESS MUTATIONS TOO. `POST /api/watchlist?symbol=X` takes
 * its argument from the query string, so a form whose `action` carries the
 * query needs no body — exempting bodyless requests would leave the hole open
 * on the route most worth attacking.
 *
 * A 415 rather than a 400: the request is well-formed and the media type is the
 * thing being refused, which is what 415 means.
 */
@Injectable()
export class JsonOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers['content-type'];

    // Compared on the media type alone: `application/json; charset=utf-8` is
    // the same type, and a suffixed type like `application/json-patch+json` is
    // a DIFFERENT one that must not pass on a prefix match.
    const mediaType =
      typeof header === 'string'
        ? header.split(';')[0].trim().toLowerCase()
        : '';

    if (mediaType !== 'application/json') {
      throw new ApiError(
        'UNSUPPORTED_MEDIA_TYPE',
        'Send this request as application/json.',
        415,
      );
    }

    return true;
  }
}
