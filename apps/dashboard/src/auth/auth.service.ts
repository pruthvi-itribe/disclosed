import { Logger } from '@nestjs/common';
import {
  checkPassword,
  DUMMY_PASSWORD_HASH,
  isLockedOut,
  isPlausibleEmail,
  lockedUntilFor,
  normaliseEmail,
  type PasswordHasher,
  type StoredUser,
  type UserRepository,
} from '@app/accounts';
import { ApiError } from './api-error';

/**
 * Register, sign in, and change a password.
 *
 * ================================================================
 * WHAT THIS REFUSES TO TELL THE CALLER, AND WHY
 * ================================================================
 *
 * `signIn` has exactly ONE failure: `401 INVALID_CREDENTIALS`, "Email or
 * password is incorrect." — for an address nobody registered, for a wrong
 * password, and for an account in backoff alike. Three different situations,
 * one answer, because any difference between them is an oracle:
 *
 *   - a different MESSAGE says which addresses are registered;
 *   - a different STATUS says the same thing more quietly;
 *   - a different TIMING says it without any text at all, which is why the
 *     no-such-user path still pays for one argon2 verification against
 *     `DUMMY_PASSWORD_HASH`. Without that, "no user" returns in about a
 *     millisecond and "wrong password" in tens of them, and the response time
 *     is a login-name checker.
 *
 * A locked account is the sharpest case: reporting the lockout would tell an
 * attacker both that the address exists AND that they are hitting a real
 * account hard enough to matter.
 *
 * ================================================================
 * REGISTRATION ENUMERATES, KNOWINGLY, ON MVP DAY
 * ================================================================
 *
 * `409 EMAIL_IN_USE` says that an address is registered. With no email lane
 * there is no alternative that is not worse: the non-enumerating answer is
 * always-202 plus a message to the address ("someone tried to sign up with
 * your address"), and without email that becomes a registration that silently
 * does nothing. This is an accepted, time-boxed exposure on a loopback
 * deployment with invited testers, and it closes at the exposure gate before
 * any public signup. It is written here so it is a decision rather than an
 * oversight.
 */
export class AuthService {
  private readonly logger = new Logger('auth');

  constructor(
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Registers a user and returns them signed in.
   *
   * The password policy is checked BEFORE the address is looked up, so a weak
   * password costs no database read — and, more usefully, so the specific
   * `WEAK_PASSWORD` reason is about the secret rather than about the account.
   */
  async register(rawEmail: string, password: string): Promise<StoredUser> {
    const email = this.requireEmail(rawEmail);
    this.requireStrongPassword(password);

    const created = await this.users.create(
      email,
      await this.hasher.hash(password),
      this.now(),
    );

    if (created === null) {
      throw new ApiError(
        'EMAIL_IN_USE',
        'That address already has an account. Sign in instead.',
        409,
      );
    }

    // MASKED, NOT LOGGED IN FULL. An email address is personal data and a log
    // line outlives the process that wrote it.
    this.logger.log(`Registered ${mask(email)}`);
    return created;
  }

  /**
   * Verifies a password, or throws the one error there is.
   *
   * The whole method is written so that every path costs one verification and
   * ends in the same place.
   */
  async signIn(rawEmail: string, password: string): Promise<StoredUser> {
    const email = normaliseEmail(rawEmail);
    const at = this.now();
    const user = await this.users.findByEmail(email);

    if (user === null) {
      // The timing equaliser. The result is discarded — no password verifies
      // against this hash — and the ~50 ms is the entire point.
      await this.hasher.verify(DUMMY_PASSWORD_HASH, password);
      throw invalidCredentials();
    }

    if (isLockedOut(user.lockedUntil, at)) {
      // Still pays for a verification, so a backed-off account does not answer
      // FASTER than a wrong password and become an oracle in the other
      // direction.
      await this.hasher.verify(DUMMY_PASSWORD_HASH, password);
      throw invalidCredentials();
    }

    // AN ACCOUNT WITH NO PASSWORD IS NOT AN ACCOUNT THIS ROUTE CAN SIGN IN.
    //
    // Every Firebase account has `passwordHash: null`, and the temptation is to
    // answer "this address uses Google, try that instead" — which would be a
    // registered-address oracle bolted onto the one endpoint the whole of this
    // class's header is about not building. It takes the same path, the same
    // message and the same ~50 ms as an address nobody registered.
    if (user.passwordHash === null) {
      await this.hasher.verify(DUMMY_PASSWORD_HASH, password);
      throw invalidCredentials();
    }

    if (!(await this.hasher.verify(user.passwordHash, password))) {
      await this.users.recordFailure(
        user.id,
        lockedUntilFor(user.failedLoginCount + 1, at),
      );
      throw invalidCredentials();
    }

    await this.users.recordSuccess(user.id, at);
    return user;
  }

  /**
   * Changes a password, having verified the current one.
   *
   * The caller revokes every other session afterwards and re-mints this one —
   * see the controller. Both halves are required: leaving other sessions alive
   * makes "I changed my password because I think someone has it" do nothing,
   * and keeping the current token across the change reuses a token across an
   * authentication boundary.
   */
  async changePassword(
    userId: string,
    current: string,
    next: string,
  ): Promise<void> {
    const user = await this.users.findById(userId);
    if (user === null) throw invalidCredentials();

    // A Firebase account has no current password to verify, so there is nothing
    // here to change. Setting one would be this route inventing a second
    // credential for an identity somebody else owns.
    if (user.passwordHash === null) {
      throw new ApiError(
        'NO_LOCAL_PASSWORD',
        'This account signs in with Google. There is no password to change here.',
        409,
      );
    }

    if (!(await this.hasher.verify(user.passwordHash, current))) {
      throw invalidCredentials();
    }

    this.requireStrongPassword(next);
    await this.users.setPasswordHash(userId, await this.hasher.hash(next));
    this.logger.log(`Password changed for ${mask(user.email)}`);
  }

  private requireEmail(raw: string): string {
    if (!isPlausibleEmail(raw)) {
      throw new ApiError(
        'INVALID_EMAIL',
        'That does not look like an email address.',
        422,
      );
    }
    return normaliseEmail(raw);
  }

  private requireStrongPassword(password: string): void {
    const verdict = checkPassword(password);
    if (verdict.ok) return;
    throw new ApiError('WEAK_PASSWORD', verdict.message, 422);
  }
}

/** The one login failure. Built in one place so the three paths cannot drift. */
const invalidCredentials = (): ApiError =>
  new ApiError('INVALID_CREDENTIALS', 'Email or password is incorrect.', 401);

/**
 * `a***a@example.com`. Enough to correlate two log lines about one person,
 * not enough to be a list of this product's users.
 */
export const mask = (email: string): string => {
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  const local = email.slice(0, at);
  const head = local.slice(0, 1);
  const tail = local.length > 1 ? local.slice(-1) : '';
  return `${head}***${tail}${email.slice(at)}`;
};
