import { Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  clearedSessionCookie,
  hashSessionToken,
  mintSessionToken,
  needsRenewal,
  readSessionCookie,
  sessionCookie,
  sessionExpiry,
  type SessionRepository,
  type UserRepository,
} from '@app/accounts';
import { describeError, stackOf } from '@app/common';

/** Who a request is, once a session has been resolved. */
export interface Signedin {
  readonly userId: string;
  readonly email: string;
  readonly sessionId: string;
  readonly lastSeenWatchlistAt: Date | null;
}

/**
 * Minting, resolving and revoking sessions, and the cookie that carries them.
 *
 * ONE PLACE DECIDES WHETHER A REQUEST IS SIGNED IN. The guard calls this and
 * `api/me` calls this; two readers of the same cookie would be two chances to
 * disagree about what an expired session means.
 */
export class SessionService {
  private readonly logger = new Logger('session');

  constructor(
    private readonly sessions: SessionRepository,
    private readonly users: UserRepository,
    private readonly ttlDays: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Mints a session and sets the cookie.
   *
   * A TOKEN IS MINTED AT AUTHENTICATION AND NEVER REUSED ACROSS ONE. Whatever
   * cookie the request presented is discarded rather than adopted — there is no
   * pre-auth session in this design to fix, and stating the rule here is what
   * stops one appearing later.
   */
  async open(
    userId: string,
    request: Request,
    response: Response,
  ): Promise<void> {
    const at = this.now();
    const minted = mintSessionToken();

    await this.sessions.create(
      minted.tokenHash,
      userId,
      at,
      sessionExpiry(at, this.ttlDays),
    );

    response.setHeader(
      'Set-Cookie',
      sessionCookie(minted.token, {
        secure: isSecure(request),
        ttlDays: this.ttlDays,
      }),
    );
  }

  /**
   * Who this request is, or null.
   *
   * CHECKS `expiresAt` ITSELF rather than trusting the TTL index. mongod's TTL
   * monitor runs about once a minute, so an expired session is briefly still in
   * the collection — and honouring it for that minute would make the expiry a
   * suggestion.
   */
  async resolve(request: Request): Promise<Signedin | null> {
    const token = readSessionCookie(request.headers.cookie);
    if (token === null) return null;

    const tokenHash = hashSessionToken(token);
    const session = await this.sessions.findByTokenHash(tokenHash);
    if (session === null) return null;

    const at = this.now();
    if (session.expiresAt.getTime() <= at.getTime()) {
      // Deleted eagerly rather than left for the sweeper: the reader is here
      // now, and one delete costs less than leaving a row the guard will refuse
      // on every poll for the next minute.
      await this.sessions.deleteByTokenHash(tokenHash);
      return null;
    }

    const user = await this.users.findById(session.userId);
    // A session whose user is gone is not a session. This is what account
    // deletion (F8) will rely on, and it costs nothing to be right about now.
    if (user === null) {
      await this.sessions.deleteByTokenHash(tokenHash);
      return null;
    }

    this.slide(session.id, session.lastSeenAt, at);

    return {
      userId: user.id,
      email: user.email,
      sessionId: session.id,
      lastSeenWatchlistAt: user.lastSeenWatchlistAt,
    };
  }

  /** Sign out: this session, and the cookie. */
  async close(request: Request, response: Response): Promise<void> {
    const token = readSessionCookie(request.headers.cookie);
    if (token !== null) {
      await this.sessions.deleteByTokenHash(hashSessionToken(token));
    }
    this.clearCookie(request, response);
  }

  /** Sign out everywhere. Returns how many sessions ended. */
  async closeAll(
    userId: string,
    request: Request,
    response: Response,
  ): Promise<number> {
    const ended = await this.sessions.deleteAllForUser(userId);
    this.clearCookie(request, response);
    return ended;
  }

  private clearCookie(request: Request, response: Response): void {
    response.setHeader(
      'Set-Cookie',
      clearedSessionCookie({ secure: isSecure(request) }),
    );
  }

  /**
   * Slides the expiry forward, at most once an hour.
   *
   * NOT AWAITED, and that is deliberate rather than sloppy. This is a
   * housekeeping write on the read path of a page that polls every four
   * seconds; making every authenticated request wait on it would put a write's
   * latency in front of a read that did not need one. The rejection is caught
   * and logged, so it can never become an unhandled rejection — and a renewal
   * that fails costs a session that expires on its original schedule, which is
   * the safe direction.
   */
  private slide(sessionId: string, lastSeenAt: Date, at: Date): void {
    if (!needsRenewal(lastSeenAt, at)) return;

    void this.sessions
      .touch(sessionId, at, sessionExpiry(at, this.ttlDays))
      .catch((error: unknown) => {
        this.logger.error(
          `Could not slide a session's expiry: ${describeError(error)}`,
          stackOf(error),
        );
      });
  }
}

/**
 * Whether this request arrived over https.
 *
 * Reads `X-Forwarded-Proto` only through express's own `req.secure`, which
 * honours it only when `trust proxy` is set — so a client cannot claim https by
 * sending the header at a server that is not behind a proxy.
 *
 * WHICH IS STILL THE DEFAULT. `TRUST_PROXY` is unset unless a deployment sets
 * it (`config/configuration.ts`), and on the loopback deployment it is unset:
 * this is then false and the cookie ships without `Secure`, which is correct
 * rather than a shortfall — a `Secure` cookie over plain http is dropped by the
 * browser without a word, and the login presents as succeeding and immediately
 * forgetting you. Behind the production chain `TRUST_PROXY=2` makes this true,
 * and the argument for why the header cannot be forged into either answer is in
 * `main.ts` beside where the setting is applied.
 */
const isSecure = (request: Request): boolean => request.secure === true;
