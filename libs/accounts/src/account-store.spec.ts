import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { type Connection, type Model } from 'mongoose';
import { assertAccountIndexes } from './account-indexes';
import { parseChannels } from './channel';
import {
  SESSION_MODEL,
  SessionSchema,
  USER_MODEL,
  UserSchema,
  WATCHLIST_MODEL,
  WatchlistSchema,
  type SessionDocument,
  type UserDocument,
  type WatchlistDocument,
} from './account.schemas';
import { SessionRepository } from './session.repository';
import { UserRepository } from './user.repository';
import { MAX_WATCHED_SYMBOLS } from './watchlist-cap';
import { WatchlistRepository } from './watchlist.repository';

/**
 * The three collections against a real mongod.
 *
 * AGAINST A REAL DATABASE, not a mock, because everything asserted below is a
 * property of MongoDB rather than of this code: a unique index refusing a
 * second registration, a TTL index existing with `expireAfterSeconds: 0`, and
 * `$push` under a `$expr` size filter enforcing a cap atomically. A mock would
 * assert that the calls were made, which is the one thing that was never in
 * doubt.
 */

jest.setTimeout(120_000);

let mongo: MongoMemoryServer;
let connection: Connection;
let users: Model<UserDocument>;
let sessions: Model<SessionDocument>;
let watchlists: Model<WatchlistDocument>;
let userRepo: UserRepository;
let sessionRepo: SessionRepository;
let watchRepo: WatchlistRepository;

const now = new Date('2026-08-08T04:00:00.000Z');

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  connection = mongoose.createConnection(mongo.getUri('turret'), {
    // The same posture the dashboard connects with: this process may never
    // build an index it did not ask for by name.
    autoIndex: false,
  });
  await connection.asPromise();

  users = connection.model<UserDocument>(USER_MODEL, UserSchema);
  sessions = connection.model<SessionDocument>(SESSION_MODEL, SessionSchema);
  watchlists = connection.model<WatchlistDocument>(
    WATCHLIST_MODEL,
    WatchlistSchema,
  );

  await assertAccountIndexes([users, sessions, watchlists]);

  userRepo = new UserRepository(users);
  sessionRepo = new SessionRepository(sessions);
  watchRepo = new WatchlistRepository(watchlists);
}, 120_000);

afterAll(async () => {
  await connection.close();
  await mongo.stop();
}, 60_000);

beforeEach(async () => {
  await Promise.all([
    users.deleteMany({}).exec(),
    sessions.deleteMany({}).exec(),
    watchlists.deleteMany({}).exec(),
  ]);
});

describe('assertAccountIndexes', () => {
  const indexNames = async (model: Model<never>): Promise<string[]> =>
    (await model.collection.indexes())
      .map((index) => String(index.name))
      .sort();

  it('builds exactly the indexes the design names on users', async () => {
    expect(await indexNames(users as unknown as Model<never>)).toEqual([
      '_id_',
      'channels_kind_1',
      'email_1',
    ]);
  });

  it('builds exactly the indexes the design names on sessions', async () => {
    expect(await indexNames(sessions as unknown as Model<never>)).toEqual([
      '_id_',
      'expiresAt_ttl',
      'tokenHash_1',
      'userId_1',
    ]);
  });

  it('builds exactly the indexes the design names on watchlists', async () => {
    expect(await indexNames(watchlists as unknown as Model<never>)).toEqual([
      '_id_',
      'entries_symbol_1_userId_1',
      'userId_1',
    ]);
  });

  it("makes the session expiry the DATABASE's job", async () => {
    // `expireAfterSeconds: 0` is what "delete when expiresAt passes" means.
    // Without it nothing in this application ever deletes a session, and a
    // process down for a week comes back to a collection of live ones.
    const ttl = (await sessions.collection.indexes()).find(
      (index) => index.name === 'expiresAt_ttl',
    );

    expect(ttl?.expireAfterSeconds).toBe(0);
  });

  it('is idempotent, so a restart is not an index build', async () => {
    await expect(
      assertAccountIndexes([users, sessions, watchlists]),
    ).resolves.toBeUndefined();
  });

  it('rejects naming the collection when a build fails', async () => {
    const broken = {
      modelName: 'AccountUser',
      createIndexes: () => Promise.reject(new Error('no permission')),
    };

    await expect(assertAccountIndexes([broken as never])).rejects.toThrow(
      /AccountUser/,
    );
  });
});

describe('UserRepository', () => {
  it('creates and finds a user by the normalised address', async () => {
    const created = await userRepo.create(
      'asha@example.com',
      '$argon2id$x',
      now,
    );

    expect(created?.email).toBe('asha@example.com');
    expect((await userRepo.findByEmail('asha@example.com'))?.id).toBe(
      created?.id,
    );
  });

  it('gives a new user the in-app channel and nothing else', async () => {
    const created = await userRepo.create('asha@example.com', '$x', now);
    const stored = await users
      .findById(created?.id)
      .lean<UserDocument>()
      .exec();

    // Read back through the parser rather than compared raw, because that is
    // how every consumer reads it — and because mongoose's `minimize` drops an
    // empty `config` on the way in, which the parser restores. Asserting the
    // raw document would pin a storage detail; asserting this pins the contract.
    expect(parseChannels(stored?.alerts.channels)).toEqual([
      { kind: 'inapp', enabled: true, config: {} },
    ]);
  });

  it('refuses a second account for one address, at the index', async () => {
    // NOT AT A PRECEDING READ. Two simultaneous registrations both pass a "does
    // it exist" check; only a unique index can decide.
    await userRepo.create('asha@example.com', '$a', now);

    expect(await userRepo.create('asha@example.com', '$b', now)).toBeNull();
    expect(await users.countDocuments({}).exec()).toBe(1);
  });

  it('resolves exactly one winner when two registrations race', async () => {
    const both = await Promise.all([
      userRepo.create('race@example.com', '$a', now),
      userRepo.create('race@example.com', '$b', now),
    ]);

    expect(both.filter((result) => result !== null)).toHaveLength(1);
    expect(await users.countDocuments({}).exec()).toBe(1);
  });

  it('counts failures with $inc, so concurrent guesses cannot both write 5', async () => {
    const created = await userRepo.create('asha@example.com', '$a', now);

    await Promise.all([
      userRepo.recordFailure(created!.id, null),
      userRepo.recordFailure(created!.id, null),
      userRepo.recordFailure(created!.id, null),
    ]);

    expect((await userRepo.findById(created!.id))?.failedLoginCount).toBe(3);
  });

  it('clears the ladder on a successful sign-in', async () => {
    const created = await userRepo.create('asha@example.com', '$a', now);
    await userRepo.recordFailure(created!.id, new Date(now.getTime() + 1_000));

    await userRepo.recordSuccess(created!.id, now);

    const after = await userRepo.findById(created!.id);
    expect(after?.failedLoginCount).toBe(0);
    expect(after?.lockedUntil).toBeNull();
  });

  it('stamps the Watching tab as seen', async () => {
    const created = await userRepo.create('asha@example.com', '$a', now);

    await userRepo.markWatchlistSeen(created!.id, now);

    expect((await userRepo.findById(created!.id))?.lastSeenWatchlistAt).toEqual(
      now,
    );
  });

  it('answers null for an address nobody registered', async () => {
    expect(await userRepo.findByEmail('nobody@example.com')).toBeNull();
  });
});

describe('SessionRepository', () => {
  const userId = new mongoose.Types.ObjectId().toString();

  it('stores a session and finds it by its hash', async () => {
    await sessionRepo.create('hash-a', userId, now, new Date('2026-09-07'));

    expect((await sessionRepo.findByTokenHash('hash-a'))?.userId).toBe(userId);
  });

  it('never stores anything but the hash', async () => {
    await sessionRepo.create('hash-a', userId, now, new Date('2026-09-07'));

    // The whole document, so a field added later that carries the raw token
    // fails this rather than shipping.
    const stored = await sessions.findOne({}).lean<SessionDocument>().exec();
    expect(Object.keys(stored ?? {}).sort()).toEqual([
      '_id',
      'createdAt',
      'expiresAt',
      'lastSeenAt',
      'tokenHash',
      'userId',
    ]);
  });

  it('refuses two sessions on one token hash', async () => {
    await sessionRepo.create('hash-a', userId, now, new Date('2026-09-07'));

    await expect(
      sessionRepo.create('hash-a', userId, now, new Date('2026-09-07')),
    ).rejects.toThrow();
  });

  it('slides the expiry forward on a touch', async () => {
    await sessionRepo.create('hash-a', userId, now, new Date('2026-09-07'));
    const later = new Date('2026-08-09T04:00:00.000Z');

    await sessionRepo.touch(
      (await sessionRepo.findByTokenHash('hash-a'))!.id,
      later,
      new Date('2026-09-08'),
    );

    expect((await sessionRepo.findByTokenHash('hash-a'))?.lastSeenAt).toEqual(
      later,
    );
  });

  it('revokes one session', async () => {
    await sessionRepo.create('hash-a', userId, now, new Date('2026-09-07'));

    await sessionRepo.deleteByTokenHash('hash-a');

    expect(await sessionRepo.findByTokenHash('hash-a')).toBeNull();
  });

  it('revokes every session for a user, which is what log-out-everywhere is', async () => {
    const other = new mongoose.Types.ObjectId().toString();
    await sessionRepo.create('hash-a', userId, now, new Date('2026-09-07'));
    await sessionRepo.create('hash-b', userId, now, new Date('2026-09-07'));
    await sessionRepo.create('hash-c', other, now, new Date('2026-09-07'));

    expect(await sessionRepo.deleteAllForUser(userId)).toBe(2);
    expect(await sessionRepo.findByTokenHash('hash-c')).not.toBeNull();
  });

  it('revokes every OTHER session, which is what a password change is', async () => {
    await sessionRepo.create('hash-a', userId, now, new Date('2026-09-07'));
    await sessionRepo.create('hash-b', userId, now, new Date('2026-09-07'));
    const keep = (await sessionRepo.findByTokenHash('hash-a'))!.id;

    expect(await sessionRepo.deleteOthersForUser(userId, keep)).toBe(1);
    expect(await sessionRepo.findByTokenHash('hash-a')).not.toBeNull();
  });
});

describe('WatchlistRepository', () => {
  const userId = new mongoose.Types.ObjectId().toString();

  it('starts empty rather than absent', async () => {
    expect(await watchRepo.entriesFor(userId)).toEqual([]);
  });

  it('adds a symbol and reports the new size', async () => {
    expect(await watchRepo.add(userId, 'RELIANCE', now)).toEqual({
      outcome: 'added',
      used: 1,
    });
  });

  it('is idempotent, because a double-click is not an error', async () => {
    await watchRepo.add(userId, 'RELIANCE', now);
    const later = new Date(now.getTime() + 60_000);

    expect(await watchRepo.add(userId, 'RELIANCE', later)).toEqual({
      outcome: 'already-present',
      used: 1,
    });
  });

  it('does not move addedAt when a symbol is re-added', async () => {
    await watchRepo.add(userId, 'RELIANCE', now);
    await watchRepo.add(userId, 'RELIANCE', new Date(now.getTime() + 60_000));

    expect((await watchRepo.entriesFor(userId))[0].addedAt).toEqual(now);
  });

  it('keeps only one document per user', async () => {
    await watchRepo.add(userId, 'RELIANCE', now);
    await watchRepo.add(userId, 'TCS', now);

    expect(await watchlists.countDocuments({ userId }).exec()).toBe(1);
  });

  it('enforces the cap in the update filter, not in a preceding read', async () => {
    for (let i = 0; i < MAX_WATCHED_SYMBOLS; i += 1) {
      await watchRepo.add(userId, `SYM${i}`, now);
    }

    expect(await watchRepo.add(userId, 'ONEMORE', now)).toEqual({
      outcome: 'full',
      used: MAX_WATCHED_SYMBOLS,
    });
  });

  it('cannot be raced past the cap', async () => {
    // THE REASON THE SIZE CHECK IS IN THE FILTER. Ten concurrent adds against a
    // watchlist one short of the cap all read the same length; only a
    // server-side `$expr` can refuse nine of them.
    for (let i = 0; i < MAX_WATCHED_SYMBOLS - 1; i += 1) {
      await watchRepo.add(userId, `SYM${i}`, now);
    }

    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        watchRepo.add(userId, `RACE${i}`, now),
      ),
    );

    expect(await watchRepo.entriesFor(userId)).toHaveLength(
      MAX_WATCHED_SYMBOLS,
    );
  });

  it('removes a symbol', async () => {
    await watchRepo.add(userId, 'RELIANCE', now);
    await watchRepo.add(userId, 'TCS', now);

    expect(await watchRepo.remove(userId, 'RELIANCE', now)).toEqual({
      used: 1,
    });
    expect(
      (await watchRepo.entriesFor(userId)).map((entry) => entry.symbol),
    ).toEqual(['TCS']);
  });

  it('removes a symbol that was never there without complaining', async () => {
    await watchRepo.add(userId, 'RELIANCE', now);

    expect(await watchRepo.remove(userId, 'INFY', now)).toEqual({ used: 1 });
  });

  it('scopes every operation to one user', async () => {
    const other = new mongoose.Types.ObjectId().toString();
    await watchRepo.add(userId, 'RELIANCE', now);
    await watchRepo.add(other, 'TCS', now);

    await watchRepo.remove(userId, 'RELIANCE', now);

    expect(
      (await watchRepo.entriesFor(other)).map((entry) => entry.symbol),
    ).toEqual(['TCS']);
  });
});
