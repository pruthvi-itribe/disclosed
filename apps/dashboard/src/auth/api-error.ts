import {
  Catch,
  HttpException,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import { describeError, stackOf } from '@app/common';
import { failure, type ApiFailure } from '../http/envelope';

/**
 * The refusal type the account routes throw, and the filter that serialises it.
 *
 * REGISTERED ON THE NEW CONTROLLERS ONLY, with `@UseFilters` at controller
 * level rather than globally. Every existing route's error body stays
 * byte-identical, which matters because the page already parses them and
 * because `dashboard.controller.spec.ts` asserts several of them.
 */

/** A refusal with a stable code, a message a reader may see, and optional meta. */
export class ApiError extends HttpException {
  constructor(
    readonly code: string,
    message: string,
    status: number,
    readonly meta: unknown = null,
  ) {
    super(message, status);
  }
}

@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('api');

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof ApiError) {
      response
        .status(exception.getStatus())
        .json(failure(exception.code, exception.message, exception.meta));
      return;
    }

    // A `ValidationPipe` refusal, a 404, a throttler 429. Nest already chose a
    // status and a message; only the envelope is added, so the client has one
    // shape to parse rather than two.
    if (exception instanceof HttpException) {
      response.status(exception.getStatus()).json(fromHttpException(exception));
      return;
    }

    // ANYTHING ELSE IS A BUG OR A DATABASE, AND NEITHER IS THE CALLER'S
    // BUSINESS. A Mongo error carries the query it failed on, a driver stack
    // names the file layout, and a mail-provider body echoes an address. All of
    // it is logged; none of it is serialised.
    this.logger.error(
      `Unhandled failure on an account route: ${describeError(exception)}`,
      stackOf(exception),
    );
    response.status(500).json(failure('INTERNAL', 'Something went wrong.'));
  }
}

/** The stable code for a Nest-thrown exception, from its status. */
const CODE_FOR_STATUS: Readonly<Record<number, string>> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  413: 'PAYLOAD_TOO_LARGE',
  429: 'RATE_LIMITED',
};

const fromHttpException = (exception: HttpException): ApiFailure => {
  const status = exception.getStatus();
  const code = Object.prototype.hasOwnProperty.call(CODE_FOR_STATUS, status)
    ? CODE_FOR_STATUS[status]
    : 'REQUEST_REFUSED';

  const body: unknown = exception.getResponse();
  const message =
    typeof body === 'object' &&
    body !== null &&
    typeof (body as { message?: unknown }).message === 'string'
      ? (body as { message: string }).message
      : exception.message;

  return failure(code, message);
};
