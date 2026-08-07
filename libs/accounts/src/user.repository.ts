import type { Model, Types } from 'mongoose';
import { DEFAULT_CHANNELS } from './channel';
import type { UserDocument } from './account.schemas';

/**
 * Every read and write against `users`.
 *
 * NO QUERY HERE IS BUILT FROM CALLER TEXT. The email arrives already normalised
 * by `normaliseEmail` and reaches mongo as a field VALUE, never as a key and
 * never as an operator — which matters because `{"email": {"$gt": ""}}` in a
 * login body is the classic Mongo authentication bypass. The DTO's `whitelist`
 * plus `@IsString()` refuses that shape before it gets here; this layer's job
 * is not to be the second place it could work.
 */

/** A user as the auth path needs it. Lean, so nothing hands a document around. */
export interface StoredUser {
  readonly id: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly failedLoginCount: number;
  readonly lockedUntil: Date | null;
  readonly lastSeenWatchlistAt: Date | null;
}

const toStored = (
  document: UserDocument & { _id: Types.ObjectId },
): StoredUser => ({
  id: String(document._id),
  email: document.email,
  passwordHash: document.passwordHash,
  failedLoginCount: document.failedLoginCount ?? 0,
  lockedUntil: document.lockedUntil ?? null,
  lastSeenWatchlistAt: document.alerts?.lastSeenWatchlistAt ?? null,
});

export class UserRepository {
  constructor(private readonly users: Model<UserDocument>) {}

  /** The identity lookup, on the unique index. */
  async findByEmail(email: string): Promise<StoredUser | null> {
    const found = await this.users
      .findOne({ email })
      .lean<UserDocument>()
      .exec();
    return found === null
      ? null
      : toStored(found as UserDocument & { _id: Types.ObjectId });
  }

  async findById(id: string): Promise<StoredUser | null> {
    const found = await this.users.findById(id).lean<UserDocument>().exec();
    return found === null
      ? null
      : toStored(found as UserDocument & { _id: Types.ObjectId });
  }

  /**
   * Creates a user, or returns null when the address is already taken.
   *
   * THE UNIQUE INDEX DECIDES, not a preceding read. Two simultaneous
   * registrations for one address both pass a "does it exist" check and then
   * one of them loses at the index — so the duplicate-key error is the answer
   * rather than an unexpected failure, and there is no window in which two
   * accounts can exist for one email.
   */
  async create(
    email: string,
    passwordHash: string,
    now: Date,
  ): Promise<StoredUser | null> {
    try {
      const created = await this.users.create({
        email,
        passwordHash,
        emailVerifiedAt: null,
        createdAt: now,
        lastLoginAt: null,
        failedLoginCount: 0,
        lockedUntil: null,
        alerts: {
          channels: [...DEFAULT_CHANNELS],
          minTier: null,
          mutedTopics: [],
          lastSeenWatchlistAt: null,
        },
      });
      return toStored(created as UserDocument & { _id: Types.ObjectId });
    } catch (error) {
      if (isDuplicateKey(error)) return null;
      throw error;
    }
  }

  /** A successful sign-in: the failure ladder resets to zero. */
  async recordSuccess(id: string, now: Date): Promise<void> {
    await this.users
      .updateOne(
        { _id: id },
        { $set: { lastLoginAt: now, failedLoginCount: 0, lockedUntil: null } },
      )
      .exec();
  }

  /**
   * A failed sign-in: the count goes up and the backoff is written with it.
   *
   * `$inc` rather than read-modify-write, so concurrent guesses against one
   * account cannot both read 4 and both write 5.
   */
  async recordFailure(id: string, lockedUntil: Date | null): Promise<void> {
    await this.users
      .updateOne(
        { _id: id },
        { $inc: { failedLoginCount: 1 }, $set: { lockedUntil } },
      )
      .exec();
  }

  /** Re-hashes on a password change; the caller revokes the sessions. */
  async setPasswordHash(id: string, passwordHash: string): Promise<void> {
    await this.users
      .updateOne(
        { _id: id },
        { $set: { passwordHash, failedLoginCount: 0, lockedUntil: null } },
      )
      .exec();
  }

  /** Stamps the Watching tab as read, which is what the unread count counts from. */
  async markWatchlistSeen(id: string, now: Date): Promise<void> {
    await this.users
      .updateOne({ _id: id }, { $set: { 'alerts.lastSeenWatchlistAt': now } })
      .exec();
  }
}

/**
 * Whether this error is the unique index refusing a second account.
 *
 * Matched on the driver's numeric code rather than on the message, which is
 * localised and version-dependent.
 */
const isDuplicateKey = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: unknown }).code === 11000;
