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
  /** Encoded argon2id string; carries its own parameters. */
  readonly passwordHash: string;
  /** Null for everyone on MVP day — there is no verification lane yet. */
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
    passwordHash: { type: String, required: true },
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
