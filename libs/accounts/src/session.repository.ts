import type { Model, Types } from 'mongoose';
import type { SessionDocument } from './account.schemas';

/** A session as the guard needs it. */
export interface StoredSession {
  readonly id: string;
  readonly userId: string;
  readonly lastSeenAt: Date;
  readonly expiresAt: Date;
}

/**
 * Every read and write against `sessions`.
 *
 * REVOCATION IS A DELETE, which is the entire argument for storing sessions
 * rather than signing JWTs: "log me out", "log me out everywhere", "I changed
 * my password" and "delete my account" are all one `deleteMany` and none of
 * them is expressible in a bearer token that is valid until it expires.
 */
export class SessionRepository {
  constructor(private readonly sessions: Model<SessionDocument>) {}

  async create(
    tokenHash: string,
    userId: string,
    now: Date,
    expiresAt: Date,
  ): Promise<void> {
    await this.sessions.create({
      tokenHash,
      userId,
      createdAt: now,
      lastSeenAt: now,
      expiresAt,
    });
  }

  /** The one indexed read every authenticated request performs. */
  async findByTokenHash(tokenHash: string): Promise<StoredSession | null> {
    const found = await this.sessions
      .findOne({ tokenHash })
      .lean<SessionDocument>()
      .exec();
    if (found === null) return null;

    const row = found as SessionDocument & { _id: Types.ObjectId };
    return {
      id: String(row._id),
      userId: String(row.userId),
      lastSeenAt: row.lastSeenAt,
      expiresAt: row.expiresAt,
    };
  }

  /**
   * Slides the expiry forward, at most once an hour (`needsRenewal` decides).
   *
   * The write is not awaited by the request path in the guard — see there for
   * why — so this must never reject for a reason the caller has to handle.
   */
  async touch(id: string, now: Date, expiresAt: Date): Promise<void> {
    await this.sessions
      .updateOne({ _id: id }, { $set: { lastSeenAt: now, expiresAt } })
      .exec();
  }

  /** Sign out: this session only. */
  async deleteByTokenHash(tokenHash: string): Promise<void> {
    await this.sessions.deleteOne({ tokenHash }).exec();
  }

  /** Sign out everywhere, and what a password change does to every other device. */
  async deleteAllForUser(userId: string): Promise<number> {
    const result = await this.sessions.deleteMany({ userId }).exec();
    return result.deletedCount ?? 0;
  }

  /**
   * Every session for a user except this one.
   *
   * The password-change path: the current device stays signed in with a
   * RE-MINTED token, and everything else is revoked. Keeping the current
   * session's own token across that boundary would violate the rule that a
   * token is minted at authentication and never reused across one.
   */
  async deleteOthersForUser(userId: string, keepId: string): Promise<number> {
    const result = await this.sessions
      .deleteMany({ userId, _id: { $ne: keepId } })
      .exec();
    return result.deletedCount ?? 0;
  }
}
