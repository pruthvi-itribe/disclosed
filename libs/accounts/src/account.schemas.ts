import { Schema, type Document, type Types } from 'mongoose';
import { DEFAULT_CHANNELS, type AlertChannel } from './channel';

/**
 * The three collections accounts add: `users`, `sessions`, `watchlists`.
 *
 * THE `filings` COLLECTION IS NOT TOUCHED AND GAINS NO INDEX. Everything here
 * is new and empty on day one, which is what makes `assertAccountIndexes` able
 * to CREATE indexes when `FilingRepository.assertIndexes` deliberately refuses
 * to — see `account-indexes.ts` for that asymmetry.
 *
 * EVERY INDEX IS NAMED. An unnamed index gets a generated name that changes
 * when the key order does, and then a deploy builds a second copy of an index
 * that already exists — against a live collection.
 */

/**
 * The mongoose model names, which are also the Nest injection tokens.
 *
 * Prefixed, because `Filing` is already registered on the same connection and a
 * name collision between two schemas is a runtime overwrite rather than an
 * error.
 */
export const USER_MODEL = 'AccountUser';
export const SESSION_MODEL = 'AccountSession';
export const WATCHLIST_MODEL = 'AccountWatchlist';

// ============================== users ======================================

export interface UserRecord {
  /** Normalised: lowercase, trimmed. The identity, and the unique key. */
  readonly email: string;
  /**
   * Encoded argon2id string; carries its own parameters.
   *
   * NULL FOR AN ACCOUNT THAT HAS NEVER HAD A PASSWORD, which is every account
   * created through Firebase. It is not a sentinel hash and must not become
   * one: "this account has no password" and "this account has a password no
   * input matches" are different facts, and only the first can be told to a
   * reader honestly. `auth.service.ts` treats null as the no-such-user path,
   * timing equaliser included.
   */
  readonly passwordHash: string | null;
  /**
   * The Firebase `sub` claim, or null for a local account.
   *
   * THE IDENTITY THAT SURVIVES AN EMAIL CHANGE. Google is the authority on the
   * address, not on our row, so keying the lookup on the uid means a reader who
   * changes their Google address keeps their watchlist. The email is still the
   * unique key for the local path, and §linking below says when the two are
   * allowed to meet.
   */
  readonly firebaseUid: string | null;
  /**
   * When the address was proved to belong to whoever is signing in.
   *
   * Null for every locally registered account — there is still no verification
   * lane of our own. Firebase fills it in: the `email_verified` claim on a
   * Google sign-in is Google's own assertion, and it is the ONLY thing that
   * permits linking a federated sign-in to an existing local account.
   */
  readonly emailVerifiedAt: Date | null;
  readonly createdAt: Date;
  readonly lastLoginAt: Date | null;
  /** Consecutive failures. Reset to zero on any success. See `login-backoff`. */
  readonly failedLoginCount: number;
  readonly lockedUntil: Date | null;
  readonly alerts: {
    readonly channels: readonly AlertChannel[];
    readonly minTier: string | null;
    readonly mutedTopics: readonly string[];
    /** Drives the unread badge on the Watching tab. */
    readonly lastSeenWatchlistAt: Date | null;
  };
}

export type UserDocument = UserRecord & Document<Types.ObjectId>;

/**
 * One alert channel.
 *
 * `_id: false` because a channel is a value hanging off a user rather than an
 * entity — twelve bytes per channel per user bought for nothing.
 *
 * `config` is `Mixed`, which is what makes email, Telegram DM and web push
 * additions rather than migrations. Mixed means mongoose validates NOTHING, so
 * the validation is `channel.ts`'s parser and there is a spec on it.
 */
const ChannelSchema = new Schema(
  {
    kind: { type: String, required: true },
    enabled: { type: Boolean, default: false },
    config: { type: Schema.Types.Mixed, default: {} },
  },
  { _id: false },
);

export const UserSchema = new Schema<UserDocument>(
  {
    email: { type: String, required: true },
    // NOT `required`, and the change is deliberate rather than a relaxation: a
    // Firebase account has no password to store, and the alternative — writing
    // a hash nothing verifies against — would put a value in the column that
    // reads as a credential and is not one.
    passwordHash: { type: String, default: null },
    firebaseUid: { type: String, default: null },
    emailVerifiedAt: { type: Date, default: null },
    createdAt: { type: Date, required: true },
    lastLoginAt: { type: Date, default: null },
    failedLoginCount: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    alerts: {
      channels: { type: [ChannelSchema], default: () => [...DEFAULT_CHANNELS] },
      /** Account default. Null means no floor. Per-entry overrides are F3. */
      minTier: { type: String, default: null },
      mutedTopics: { type: [String], default: [] },
      lastSeenWatchlistAt: { type: Date, default: null },
    },
  },
  { collection: 'users', versionKey: false },
);

/** The identity. Unique, and the reason registration cannot race itself. */
UserSchema.index({ email: 1 }, { unique: true, name: 'email_1' });

/**
 * The Firebase identity, looked up on every federated sign-in.
 *
 * UNIQUE AND PARTIAL, and both halves are load-bearing.
 *
 * Unique, because two rows sharing a `firebaseUid` would be two accounts for one
 * Google identity — and which one a sign-in landed on would depend on document
 * order. It is the same guarantee `email_1` gives the local path, and for the
 * same reason: the index decides, not a preceding read, so two simultaneous
 * first sign-ins cannot both win.
 *
 * PARTIAL rather than sparse. A sparse unique index tolerates many documents
 * that OMIT the field, but every local account here stores `firebaseUid: null`
 * explicitly — the field is present, so sparse would not exclude it, and the
 * second local account ever created would collide on null. The partial filter
 * indexes only the rows where the value is a string, which is exactly the set
 * the uniqueness claim is about.
 */
UserSchema.index(
  { firebaseUid: 1 },
  {
    unique: true,
    name: 'firebaseUid_1',
    partialFilterExpression: { firebaseUid: { $type: 'string' } },
  },
);

/**
 * For the eventual per-channel fan-out.
 *
 * Queried with `$elemMatch`, never as two dotted paths — the house rule, and
 * here is why it bites: `{'alerts.channels.kind':'email',
 * 'alerts.channels.enabled':true}` matches a user whose EMAIL channel is
 * disabled and whose IN-APP channel is enabled, because the two conditions are
 * satisfied by two different array elements.
 */
UserSchema.index({ 'alerts.channels.kind': 1 }, { name: 'channels_kind_1' });

// ============================= sessions ====================================

export interface SessionRecord {
  /** `sha256(token)`, hex. The raw token is never stored. */
  readonly tokenHash: string;
  readonly userId: Types.ObjectId;
  readonly createdAt: Date;
  readonly lastSeenAt: Date;
  readonly expiresAt: Date;
}

export type SessionDocument = SessionRecord & Document<Types.ObjectId>;

export const SessionSchema = new Schema<SessionDocument>(
  {
    tokenHash: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, required: true },
    createdAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
  },
  { collection: 'sessions', versionKey: false },
);

/** The lookup every authenticated request performs. */
SessionSchema.index({ tokenHash: 1 }, { unique: true, name: 'tokenHash_1' });

/**
 * Expiry is the DATABASE's job.
 *
 * `expireAfterSeconds: 0` means "delete when `expiresAt` passes", so nothing in
 * this application has to run a sweep, and a process that is down for a week
 * does not come back to a collection of live sessions that should have died.
 * The guard still checks `expiresAt` on read: mongod's TTL monitor runs once a
 * minute, so a session is briefly present after it expires and must not be
 * honoured in that window.
 */
SessionSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, name: 'expiresAt_ttl' },
);

/** Log out everywhere, and the revocation after any password change. */
SessionSchema.index({ userId: 1 }, { name: 'userId_1' });

// ============================ watchlists ===================================

export interface WatchlistEntry {
  readonly symbol: string;
  readonly addedAt: Date;
  /** Reserved per-entry overrides (F3). Absent means "use the account default". */
  readonly minTier?: string | null;
  readonly mutedTopics?: readonly string[];
}

export interface WatchlistRecord {
  readonly userId: Types.ObjectId;
  readonly entries: readonly WatchlistEntry[];
  readonly updatedAt: Date;
}

export type WatchlistDocument = WatchlistRecord & Document<Types.ObjectId>;

/**
 * `_id: false`, like every other value subdocument here.
 *
 * `minTier` and `mutedTopics` are RESERVED and unset. §4.2 of the design: the
 * two knobs that mean anything to a reader today are confidence tier and claim
 * topic, they live on the USER, and offering per symbol what nobody has asked
 * for per account is configuration for a case that has never occurred. Naming
 * the fields costs nothing and is what makes adding the override later a UI
 * change and a two-line resolver rather than a migration.
 */
const WatchlistEntrySchema = new Schema(
  {
    symbol: { type: String, required: true },
    addedAt: { type: Date, required: true },
    minTier: { type: String },
    mutedTopics: { type: [String] },
  },
  { _id: false },
);

export const WatchlistSchema = new Schema<WatchlistDocument>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    entries: { type: [WatchlistEntrySchema], default: [] },
    updatedAt: { type: Date, required: true },
  },
  { collection: 'watchlists', versionKey: false },
);

/**
 * ONE DOCUMENT PER USER, and the unique index is what enforces it.
 *
 * The alternative shape — one document per (user, symbol) edge — grows without
 * bound and makes per-entry preferences natural, but turns "show me my
 * watchlist" into a multi-document query on every page load. The common read
 * should be the cheapest one, and the cap in `watchlist-cap.ts` is what makes
 * the bounded array safe.
 */
WatchlistSchema.index({ userId: 1 }, { unique: true, name: 'userId_1' });

/**
 * The fan-out's index: `find({'entries.symbol': S}, {userId: 1, _id: 0})`.
 *
 * WHAT IS CLAIMED HERE IS ONLY WHAT WAS MEASURED. The index SERVES the
 * predicate — that much is certain and is why it exists. Whether MongoDB
 * reports `PROJECTION_COVERED` for a multikey index with the predicate on the
 * array field is NOT claimed: the documented rule is that multikey indexes
 * cannot cover a query over the array field, and no `explain()` has been run
 * against a populated collection here. `filing.schema.ts`'s
 * `symbol_1_companyName_1` comment is the precedent for putting a measured plan
 * in a comment rather than a belief, and there is no fan-out yet to measure.
 *
 * Scale: 1,000 users x 50 symbols is 50,000 index keys. Trivial.
 */
WatchlistSchema.index(
  { 'entries.symbol': 1, userId: 1 },
  { name: 'entries_symbol_1_userId_1' },
);
