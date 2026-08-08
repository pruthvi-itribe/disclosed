import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { type Connection, type Model } from 'mongoose';
import {
  assertAccountIndexes,
  USER_MODEL,
  UserRepository,
  UserSchema,
  type UserDocument,
} from '@app/accounts';
import { ApiError } from './api-error';
import { FirebaseSignInService } from './firebase-sign-in';
import type {
  FirebaseIdentity,
  FirebaseTokenVerifier,
} from './firebase-verifier';

/**
 * Which row a Firebase identity becomes, against a real mongod.
 *
 * REAL DATABASE, STUBBED VERIFIER, and both halves are deliberate. The
 * interesting behaviour here is what two unique indexes do to two racing
 * writers, which a mock repository cannot have; the token check is Google's
 * code and cannot be exercised offline at all. So the seam is the verifier
 * interface, and the eleven cases below are the ones a live project would take
 * a fortnight to produce by hand.
 */

jest.setTimeout(120_000);

let mongo: MongoMemoryServer;
let connection: Connection;
let users: Model<UserDocument>;
let repo: UserRepository;

const now = new Date('2026-08-08T04:00:00.000Z');

/** A verifier that answers with whatever the test wants, or throws. */
const verifierFor = (
  answer: FirebaseIdentity | Error,
): FirebaseTokenVerifier => ({
  verify: () =>
    answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer),
});

const identity = (over: Partial<FirebaseIdentity> = {}): FirebaseIdentity => ({
  uid: 'uid-asha',
  email: 'asha@example.com',
  emailVerified: true,
  ...over,
});

const serviceFor = (answer: FirebaseIdentity | Error): FirebaseSignInService =>
  new FirebaseSignInService(verifierFor(answer), repo, () => now);

/** The code on a refusal, or the string 'resolved' if there was not one. */
const codeOf = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
    return 'resolved';
  } catch (error) {
    return error instanceof ApiError ? error.code : String(error);
  }
};

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  connection = mongoose.createConnection(mongo.getUri('turret'), {
    autoIndex: false,
  });
  await connection.asPromise();
  users = connection.model<UserDocument>(USER_MODEL, UserSchema);
  await assertAccountIndexes([users]);
  repo = new UserRepository(users);
}, 120_000);

afterAll(async () => {
  await connection.close();
  await mongo.stop();
}, 60_000);

beforeEach(async () => {
  await users.deleteMany({}).exec();
});

describe('a first sign-in', () => {
  it('creates an account with no password and the firebase identity on it', async () => {
    const user = await serviceFor(identity()).signIn('token');

    expect(user.email).toBe('asha@example.com');
    expect(user.firebaseUid).toBe('uid-asha');
    expect(user.passwordHash).toBeNull();
  });

  it('normalises the address the same way the password path does', async () => {
    // Through the SAME `normaliseEmail`, or `Asha@Example.com` and
    // `asha@example.com` become two accounts for one person.
    const user = await serviceFor(
      identity({ email: '  Asha@Example.COM ' }),
    ).signIn('token');

    expect(user.email).toBe('asha@example.com');
  });

  it('is idempotent: the second visit finds the same row', async () => {
    const first = await serviceFor(identity()).signIn('token');
    const second = await serviceFor(identity()).signIn('token');

    expect(second.id).toBe(first.id);
    expect(await users.countDocuments({}).exec()).toBe(1);
  });

  it('follows the uid, not the address, when the address changes upstream', async () => {
    // Google is the authority on the address and we are not. Somebody who
    // changes their Google email must land on their own watchlist rather than
    // on a new account, which is why the uid lookup comes first.
    const first = await serviceFor(identity()).signIn('token');
    const later = await serviceFor(
      identity({ email: 'asha@newjob.example' }),
    ).signIn('token');

    expect(later.id).toBe(first.id);
    expect(later.email).toBe('asha@example.com');
    expect(await users.countDocuments({}).exec()).toBe(1);
  });
});

describe('the verified-address rule', () => {
  it('refuses an unverified address even when nothing else is wrong', async () => {
    // UNCONDITIONAL. Firebase's email+password sign-up does not verify the
    // address, so anyone can hold a valid token claiming somebody else's.
    expect(
      await codeOf(serviceFor(identity({ emailVerified: false })).signIn('t')),
    ).toBe('EMAIL_NOT_VERIFIED');
    expect(await users.countDocuments({}).exec()).toBe(0);
  });

  it('refuses an unverified address that matches an existing account', async () => {
    await repo.create('asha@example.com', '$argon2id$x', now);

    expect(
      await codeOf(serviceFor(identity({ emailVerified: false })).signIn('t')),
    ).toBe('EMAIL_NOT_VERIFIED');
    // NOT LINKED. This is the takeover the rule exists for: a Firebase account
    // claiming an address the attacker does not own must not reach the row that
    // does.
    expect(
      (await repo.findByEmail('asha@example.com'))?.firebaseUid,
    ).toBeNull();
  });

  it('says the same sentence whether or not the address is registered here', async () => {
    // THE ORACLE TEST. If the refusal differed between these two, the message
    // would be a registered-address checker usable by anyone who can type an
    // address into a Firebase sign-up form.
    const stranger = await codeOf(
      serviceFor(
        identity({ emailVerified: false, email: 'nobody@example.com' }),
      ).signIn('t'),
    );
    await repo.create('asha@example.com', '$x', now);
    const known = await codeOf(
      serviceFor(identity({ emailVerified: false })).signIn('t'),
    );

    expect(stranger).toBe(known);
  });
});

describe('linking an account that already existed', () => {
  it('attaches the identity to the local account with that address', async () => {
    // The accounts registered before this branch keep working: their owners
    // sign in with Google and land on their own watchlist.
    const local = await repo.create('asha@example.com', '$argon2id$x', now);

    const signedIn = await serviceFor(identity()).signIn('token');

    expect(signedIn.id).toBe(local!.id);
    expect(signedIn.firebaseUid).toBe('uid-asha');
    expect(await users.countDocuments({}).exec()).toBe(1);
  });

  it('leaves the password in place, so both ways in keep working', async () => {
    const local = await repo.create('asha@example.com', '$argon2id$x', now);
    await serviceFor(identity()).signIn('token');

    expect((await repo.findById(local!.id))?.passwordHash).toBe('$argon2id$x');
  });

  it('refuses when the address is held by a DIFFERENT firebase identity', async () => {
    await repo.createFederated('asha@example.com', 'uid-first', now, now);

    expect(
      await codeOf(serviceFor(identity({ uid: 'uid-second' })).signIn('t')),
    ).toBe('ACCOUNT_CONFLICT');
    expect(await users.countDocuments({}).exec()).toBe(1);
  });
});

describe('two sign-ins at once', () => {
  it('produces one account and two answers, not one 500', async () => {
    // Both writers lose or win at an index rather than at a preceding read, and
    // the loser re-reads once. A race that surfaced as an error would be a
    // 500 on the most ordinary event there is: somebody double-clicking.
    const both = await Promise.all([
      serviceFor(identity()).signIn('token'),
      serviceFor(identity()).signIn('token'),
    ]);

    expect(both[0].id).toBe(both[1].id);
    expect(await users.countDocuments({}).exec()).toBe(1);
  });

  it('re-reads by uid rather than by address after losing a link race', async () => {
    // THE ERROR PATH IS A SECURITY BOUNDARY. Answering with whatever row holds
    // the address would hand this caller an account another identity had just
    // linked — the takeover the update filter prevents, reintroduced in the
    // recovery. Here identity B loses to A, and must be refused rather than
    // handed A's row.
    await repo.create('asha@example.com', '$x', now);

    const [, second] = await Promise.allSettled([
      serviceFor(identity({ uid: 'uid-a' })).signIn('token'),
      serviceFor(identity({ uid: 'uid-b' })).signIn('token'),
    ]);

    const winner = await repo.findByEmail('asha@example.com');
    expect(['uid-a', 'uid-b']).toContain(winner?.firebaseUid);
    if (second.status === 'fulfilled') {
      // Whichever one succeeded got the row it is entitled to.
      expect(second.value.firebaseUid).toBe(winner?.firebaseUid);
    } else {
      expect((second.reason as ApiError).code).toBe('ACCOUNT_CONFLICT');
    }
  });
});

describe('a token the verifier refuses', () => {
  it('propagates the refusal and writes nothing', async () => {
    const refusal = new ApiError('INVALID_ID_TOKEN', 'no', 401);

    expect(await codeOf(serviceFor(refusal).signIn('forged'))).toBe(
      'INVALID_ID_TOKEN',
    );
    expect(await users.countDocuments({}).exec()).toBe(0);
  });

  it('refuses a verified address this application would not store', async () => {
    // A Firebase project misconfiguration rather than a caller error: loud,
    // logged, and never written.
    expect(
      await codeOf(
        serviceFor(identity({ email: 'not-an-address' })).signIn('t'),
      ),
    ).toBe('INVALID_EMAIL');
    expect(await users.countDocuments({}).exec()).toBe(0);
  });
});
