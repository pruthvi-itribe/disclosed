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
  /** Null on an account that has never had a password. See `account.schemas.ts`. */
  readonly passwordHash: string | null;
  /** The Firebase `sub`, or null on a locally registered account. */
  readonly firebaseUid: string | null;
  readonly failedLoginCount: number;
  readonly lockedUntil: Date | null;
  readonly lastSeenWatchlistAt: Date | null;
}

const toStored = (
  document: UserDocument & { _id: Types.ObjectId },
): StoredUser => ({
  id: String(document._id),
  email: document.email,
  // `?? null` rather than passed through: a document written before this field
  // existed has `undefined` here, and `undefined` is not the value the caller
  // branches on.
  passwordHash: document.passwordHash ?? null,
  firebaseUid: document.firebaseUid ?? null,
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
   * The federated identity lookup, on the partial unique index.
   *
   * ASKED BEFORE THE EMAIL IS, on every Firebase sign-in. The uid is the stable
   * identity and the address is not: a reader who changes their Google address
   * must land on their own watchlist rather than on a new account.
   */
  async findByFirebaseUid(firebaseUid: string): Promise<StoredUser | null> {
    const found = await this.users
      .findOne({ firebaseUid })
      .lean<UserDocument>()
      .exec();
    return found === null
      ? null
      : toStored(found as UserDocument & { _id: Types.ObjectId });
  }

  /**
   * Creates an account for a Firebase identity, or returns null on a collision.
   *
   * NO PASSWORD HASH, and null rather than a sentinel — see `account.schemas.ts`
   * for why a hash nothing verifies against is the wrong shape.
   *
   * Null covers BOTH unique indexes: `email_1` when the address is already
   * registered, and `firebaseUid_1` when two first sign-ins race. The caller
   * re-reads and retries once, which is what makes the race a lookup rather than
   * an error a reader sees.
   */
  async createFederated(
    email: string,
    firebaseUid: string,
    now: Date,
    emailVerifiedAt: Date | null,
  ): Promise<StoredUser | null> {
    try {
      const created = await this.users.create({
        email,
        passwordHash: null,
        firebaseUid,
        emailVerifiedAt,
        createdAt: now,
        lastLoginAt: now,
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

  /**
   * Attaches a Firebase identity to an account that does not have one.
   *
   * ================================================================
   * THE FILTER IS THE SECURITY CONTROL, NOT THE CALLER'S CHECK
   * ================================================================
   *
   * `firebaseUid: null` in the PREDICATE, not merely in a preceding read. This
   * is the write that turns "somebody proved they hold this address at Google"
   * into "somebody may sign in as this row", and a read-then-write would leave a
   * window in which two federated identities both saw an unlinked account and
   * both linked to it — the second silently overwriting the first, which is an
   * account takeover performed by our own code.
   *
   * Returns false when nothing matched: the row is gone, or somebody else linked
   * it first. Both are refusals, and neither is an error to log.
   */
  async linkFirebaseUid(
    id: string,
    firebaseUid: string,
    emailVerifiedAt: Date,
  ): Promise<boolean> {
    try {
      const result = await this.users
        .updateOne(
          { _id: id, firebaseUid: null },
          { $set: { firebaseUid, emailVerifiedAt } },
        )
        .exec();
      return result.matchedCount === 1;
    } catch (error) {
      // The partial unique index refusing to give one Google identity a second
      // account. A refusal, not a fault.
      if (isDuplicateKey(error)) return false;
      throw error;
    }
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
        // Written explicitly rather than left to the schema default, so every
        // row this process creates carries the field and the partial index's
        // `$type: 'string'` filter is the only thing deciding what it covers.
        firebaseUid: null,
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

  /**
   * The stored channels, raw.
   *
   * Raw because `config` is `Mixed` and the only correct reader of it is
   * `parseChannels`; typing it here would be this layer claiming a validation
   * it does not perform.
   */
  async channelsFor(id: string): Promise<unknown> {
    const found = await this.users
      .findById(id, { 'alerts.channels': 1 })
      .lean<UserDocument>()
      .exec();
    return found?.alerts?.channels ?? [];
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
