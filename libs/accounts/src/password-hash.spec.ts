import {
  Argon2idHasher,
  ARGON2_PROFILE,
  DUMMY_PASSWORD_HASH,
  HASH_CONCURRENCY,
  Semaphore,
} from './password-hash';

/**
 * The hasher, its parameters, and the semaphore that stops it being a denial of
 * service against the feed.
 *
 * SLOW ON PURPOSE. Each `hash` here is ~19 MiB and tens of milliseconds; that
 * is the control working. The suite keeps the number of real hashes small and
 * generous on time rather than lowering the parameters, because a test that
 * measured a weaker profile than the one that ships would be testing nothing.
 */

jest.setTimeout(30_000);

describe('ARGON2_PROFILE', () => {
  it('is the OWASP 2024 minimum for argon2id', () => {
    // m=19456 KiB, t=2, p=1. Raising these later is a per-user upgrade on next
    // login rather than a migration, because the encoded string carries its own
    // parameters — which is the property the next test pins.
    expect(ARGON2_PROFILE).toEqual({
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
      outputLen: 32,
    });
  });
});

describe('Argon2idHasher', () => {
  const hasher = new Argon2idHasher();

  it('produces an encoded argon2id string carrying its own parameters', async () => {
    const hash = await hasher.hash('correct horse battery staple');

    expect(hash.startsWith('$argon2id$v=19$m=19456,t=2,p=1$')).toBe(true);
  });

  it('verifies the password it hashed', async () => {
    const hash = await hasher.hash('correct horse battery staple');

    expect(await hasher.verify(hash, 'correct horse battery staple')).toBe(
      true,
    );
  });

  it('refuses a wrong password', async () => {
    const hash = await hasher.hash('correct horse battery staple');

    expect(await hasher.verify(hash, 'correct horse battery stapl')).toBe(
      false,
    );
  });

  it('salts, so two users with the same password do not share a hash', async () => {
    const [a, b] = await Promise.all([
      hasher.hash('correct horse battery staple'),
      hasher.hash('correct horse battery staple'),
    ]);

    expect(a).not.toBe(b);
  });

  it('answers false rather than throwing on a stored value that is not a hash', async () => {
    // A pre-migration or hand-edited document. Throwing here would turn a bad
    // record into a 500 on the login route, which is both an outage and an
    // oracle: a 500 for one address and a 401 for every other one names the
    // address that exists.
    expect(await hasher.verify('not-a-hash', 'anything')).toBe(false);
    expect(await hasher.verify('', 'anything')).toBe(false);
  });
});

describe('DUMMY_PASSWORD_HASH', () => {
  it('is a real argon2id hash at the shipped profile', () => {
    // THE TIMING HALF OF THE NO-ENUMERATION RULE. When no user exists, login
    // verifies against this so the unknown-address path costs the same as the
    // wrong-password path. A cheaper constant here would make response time the
    // oracle that identical bodies and statuses were written to remove.
    expect(
      DUMMY_PASSWORD_HASH.startsWith('$argon2id$v=19$m=19456,t=2,p=1$'),
    ).toBe(true);
  });

  it('verifies against nothing anybody could submit', async () => {
    const hasher = new Argon2idHasher();

    expect(await hasher.verify(DUMMY_PASSWORD_HASH, '')).toBe(false);
    expect(await hasher.verify(DUMMY_PASSWORD_HASH, 'password')).toBe(false);
  });
});

describe('Semaphore', () => {
  it('runs up to its limit concurrently', async () => {
    const semaphore = new Semaphore(2);
    let live = 0;
    let peak = 0;

    const job = async (): Promise<void> => {
      live += 1;
      peak = Math.max(peak, live);
      await new Promise((resolve) => setTimeout(resolve, 5));
      live -= 1;
    };

    await Promise.all([1, 2, 3, 4, 5, 6].map(() => semaphore.run(job)));

    expect(peak).toBe(2);
  });

  it('lets a later caller through after an earlier one rejects', async () => {
    // A REJECTED JOB MUST STILL RELEASE ITS SLOT. Without this the semaphore
    // leaks a permit per failure and the login route wedges permanently after
    // four bad passwords — which is the worst possible way to discover it.
    const semaphore = new Semaphore(1);

    await expect(
      semaphore.run(() => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');

    await expect(semaphore.run(() => Promise.resolve('through'))).resolves.toBe(
      'through',
    );
  });

  it('returns each job its own result', async () => {
    const semaphore = new Semaphore(2);

    expect(
      await Promise.all(
        [1, 2, 3].map((n) => semaphore.run(() => Promise.resolve(n * 2))),
      ),
    ).toEqual([2, 4, 6]);
  });

  it('refuses a limit that is not a positive whole number', () => {
    // A zero limit is a queue nothing ever leaves, and the failure presents as
    // a login route that hangs rather than as an error.
    expect(() => new Semaphore(0)).toThrow();
    expect(() => new Semaphore(-1)).toThrow();
    expect(() => new Semaphore(1.5)).toThrow();
  });
});

describe('HASH_CONCURRENCY', () => {
  it('is four', () => {
    // argon2id at 19 MiB means 50 concurrent logins is ~1 GB resident, and this
    // process also serves the public feed. Four caps the hashing arena at
    // ~78 MiB; requests beyond it wait, and the per-IP throttle in front means
    // the wait is bounded.
    expect(HASH_CONCURRENCY).toBe(4);
  });
});

describe('the hasher behind the semaphore', () => {
  it('never runs more hashes at once than the cap', async () => {
    const hasher = new Argon2idHasher();
    const inner = jest.spyOn(
      hasher as unknown as { rawHash: (p: string) => Promise<string> },
      'rawHash',
    );

    let live = 0;
    let peak = 0;
    inner.mockImplementation(async () => {
      live += 1;
      peak = Math.max(peak, live);
      await new Promise((resolve) => setTimeout(resolve, 5));
      live -= 1;
      return 'hash';
    });

    await Promise.all(
      Array.from({ length: 12 }, () => hasher.hash('correct horse battery')),
    );

    expect(peak).toBe(HASH_CONCURRENCY);
  });
});
