import {
  Algorithm,
  hash as argonHash,
  verify as argonVerify,
} from '@node-rs/argon2';

/**
 * Password hashing: the interface, the argon2id implementation, and the
 * semaphore that stops it becoming a denial of service against the feed.
 *
 * ================================================================
 * THE PROFILE
 * ================================================================
 *
 * argon2id at OWASP's 2024 minimum: m = 19456 KiB, t = 2, p = 1, a 16-byte
 * random salt and a 32-byte output. The encoded string carries its own
 * parameters (`$argon2id$v=19$m=19456,t=2,p=1$...`), so raising them later is a
 * per-user upgrade on next login rather than a migration.
 *
 * ================================================================
 * WHY `@node-rs/argon2` AND NOT `argon2`
 * ================================================================
 *
 * The `argon2` package is node-gyp and needs a build toolchain on the deploy
 * host whose libc matches; the Rust package ships prebuilt binaries. The
 * alternative failure mode is a deploy that cannot install its own
 * authentication.
 *
 * ================================================================
 * THE ESCAPE HATCH IS WHY THIS IS AN INTERFACE
 * ================================================================
 *
 * If no prebuilt binary ever covers the deploy target, `crypto.scrypt` is in
 * the Node standard library, is memory-hard, and is OWASP's named fallback at
 * N = 2^17, r = 8, p = 1 — zero dependencies, which this codebase's dependency
 * hygiene would otherwise prefer outright. Two methods and one spec is what
 * makes swapping it a provider change rather than a rewrite, and writing the
 * interface first is what makes the escape hatch real rather than aspirational.
 */

/** The two operations anything downstream needs. Nothing else is exposed. */
export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(hash: string, password: string): Promise<boolean>;
}

/** OWASP 2024 minimum for argon2id. Stated as data so a spec can assert it. */
export const ARGON2_PROFILE = {
  /** KiB. 19 MiB per concurrent hash — see `HASH_CONCURRENCY`. */
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

/**
 * How many hashes may run at once.
 *
 * A CAP IS REQUIRED, NOT OPTIONAL. At 19 MiB a hash, fifty concurrent logins is
 * roughly a gigabyte of resident memory — in the process that also serves the
 * public feed, so a login flood becomes an OOM of the reader's dashboard. Four
 * bounds the hashing arena at ~78 MiB. Requests beyond it wait, and the per-IP
 * throttle in front of the auth routes bounds how long that queue can get.
 *
 * The same shape as the sender queue in `telegram.service.ts`: a small pure
 * queue in front of an expensive resource, rather than a library.
 */
export const HASH_CONCURRENCY = 4;

/**
 * A counting semaphore over promises.
 *
 * Small enough to own. The one property that is easy to get wrong and fatal is
 * in the `finally`: a REJECTED job must still release its permit, or the pool
 * leaks one slot per failed hash and the login route wedges permanently after
 * four bad passwords.
 */
export class Semaphore {
  private live = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) {
      // A zero limit is a queue nothing ever leaves, and it presents as a login
      // route that hangs rather than as an error.
      throw new Error(
        `Semaphore limit must be a whole number >= 1, but was ${limit}.`,
      );
    }
  }

  async run<T>(job: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await job();
    } finally {
      this.release();
    }
  }

  private async acquire(): Promise<void> {
    if (this.live < this.limit) {
      this.live += 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.live += 1;
  }

  private release(): void {
    this.live -= 1;
    const next = this.waiting.shift();
    if (next !== undefined) next();
  }
}

/** argon2id at the profile above, behind the semaphore. */
export class Argon2idHasher implements PasswordHasher {
  private readonly gate = new Semaphore(HASH_CONCURRENCY);

  async hash(password: string): Promise<string> {
    return this.gate.run(() => this.rawHash(password));
  }

  /**
   * Verifies, and answers FALSE for a stored value that is not a hash.
   *
   * A throw here would be both an outage and an oracle: a 500 for one address
   * and a 401 for every other one names the address whose record is broken.
   *
   * Behind the same semaphore as `hash`, because verification costs the same
   * 19 MiB — and verification is the operation an attacker can trigger without
   * an account.
   */
  async verify(hash: string, password: string): Promise<boolean> {
    if (typeof hash !== 'string' || hash === '') return false;
    return this.gate.run(async () => {
      try {
        return await argonVerify(hash, password);
      } catch {
        return false;
      }
    });
  }

  /**
   * The call itself, separated so a spec can count how many run at once
   * without paying 19 MiB a time to find out.
   */
  private async rawHash(password: string): Promise<string> {
    return argonHash(password, {
      algorithm: Algorithm.Argon2id,
      memoryCost: ARGON2_PROFILE.memoryCost,
      timeCost: ARGON2_PROFILE.timeCost,
      parallelism: ARGON2_PROFILE.parallelism,
      outputLen: ARGON2_PROFILE.outputLen,
    });
  }
}

/**
 * A hash of a value nobody can submit, verified against when no user exists.
 *
 * THE TIMING HALF OF THE NO-ENUMERATION RULE. Identical bodies and statuses for
 * "no such address" and "wrong password" are undone entirely if one path
 * returns in 1 ms and the other in 50: response time is then the oracle. So the
 * unknown-address path verifies the submitted password against this constant
 * and pays the same cost.
 *
 * A LITERAL RATHER THAN A HASH COMPUTED AT BOOT, for two reasons: computing one
 * at startup puts a 19 MiB argon2 call on the path that has to answer a health
 * check, and a per-boot value cannot be asserted by a spec. It is not a secret —
 * it is a hash of 32 random bytes that were never written down, so there is no
 * password anywhere that verifies against it.
 */
export const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$jpFhseHbit7VrTA+YE3nOg$TZEFuQ9JNeY7cre0B8tiNTah9OVoE1EK/IcwUG/gDxc';
