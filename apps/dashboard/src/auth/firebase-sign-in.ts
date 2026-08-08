import { Logger } from '@nestjs/common';
import {
  isPlausibleEmail,
  normaliseEmail,
  type StoredUser,
  type UserRepository,
} from '@app/accounts';
import { ApiError } from './api-error';
import { mask } from './auth.service';
import type { FirebaseTokenVerifier } from './firebase-verifier';

/**
 * Turning a verified Firebase identity into one of our user records.
 *
 * Firebase says who somebody is. This file decides which row that is, and it is
 * the only place in the application where an external identity is allowed to
 * become an internal one. Everything after it — the session, the cookie, the
 * guard, the watchlist — is the machinery that already existed and is unchanged.
 *
 * ================================================================
 * THE RULE THAT MATTERS: A VERIFIED ADDRESS, ALWAYS
 * ================================================================
 *
 * `email_verified` must be true. Not only when linking to an existing account —
 * ALWAYS — and the uniformity is the security property rather than strictness
 * for its own sake.
 *
 * The attack it closes is concrete. Firebase's email+password sign-up does NOT
 * verify the address: anyone may create a Firebase account claiming
 * `someone-else@example.com` and receive a perfectly valid ID token for it. If
 * this file linked such a token to the local account that already owns that
 * address, creating a Firebase account would be a way to take over a Disclosed
 * account. Google sign-in is fine — Google asserts the address — so the naive
 * design is "require verification only when linking".
 *
 * That version leaks. "Verify your address first" would then be said ONLY when
 * the address already has an account here, and never when it does not, which
 * makes the refusal itself a registered-address oracle — checkable by anyone who
 * can type an address into a Firebase sign-up form. `auth.service.ts` spends its
 * whole header refusing to build that oracle on the password path; this would be
 * the same oracle on a different door.
 *
 * So the requirement is unconditional and the sentence is the same either way.
 * The cost is that a reader who signs up with a Firebase password must click the
 * link Firebase emails them — which is a lane this product did not previously
 * have at all (see the design doc's §2.5: reset needed email, and email needed a
 * verified sending domain). Firebase supplies both.
 *
 * ================================================================
 * WHICH ROW, IN ORDER
 * ================================================================
 *
 *   1. `firebaseUid` matches → that row. Asked FIRST, because the uid is the
 *      stable identity and the address is not: somebody who changes their Google
 *      address must land on their own watchlist rather than on a new account.
 *   2. the address matches an existing row → LINK it, once, atomically. This is
 *      what makes the in-house accounts registered before this branch keep
 *      working when their owners next sign in with Google.
 *   3. neither → create.
 *
 * Steps 2 and 3 both race, and both resolve at an index rather than at a
 * preceding read — `linkFirebaseUid` puts `firebaseUid: null` in the update
 * filter and `createFederated` returns null on a duplicate key. A lost race is
 * re-read once and answered, so two simultaneous first sign-ins produce one
 * account and two successful responses rather than one 500.
 */
export class FirebaseSignInService {
  private readonly logger = new Logger('auth');

  constructor(
    private readonly verifier: FirebaseTokenVerifier,
    private readonly users: UserRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Verifies the token and answers with the user it belongs to. */
  async signIn(idToken: string): Promise<StoredUser> {
    const identity = await this.verifier.verify(idToken);

    // UNCONDITIONAL, and the header says why at length. The message names the
    // reader's own next action and says nothing about our database.
    if (!identity.emailVerified) {
      throw new ApiError(
        'EMAIL_NOT_VERIFIED',
        'Confirm your email address first — check your inbox for the link, ' +
          'then sign in again.',
        403,
      );
    }

    // Normalised through the SAME function the password path uses, or the two
    // would disagree about whether `Asha@Example.com` is `asha@example.com` and
    // one address would become two accounts.
    const email = normaliseEmail(identity.email);
    if (!isPlausibleEmail(email)) {
      // A verified address that this application cannot store is a Firebase
      // project misconfiguration, not a caller error. Loud, and refused.
      this.logger.error(
        `Firebase returned a verified address this application will not store ` +
          `(uid ${identity.uid}).`,
      );
      throw new ApiError(
        'INVALID_EMAIL',
        'That account has no usable email address.',
        422,
      );
    }

    const known = await this.users.findByFirebaseUid(identity.uid);
    if (known !== null) return known;

    return this.attach(identity.uid, email);
  }

  /**
   * Links or creates, and re-reads once if it lost a race.
   *
   * The retry is bounded at one deliberately. Exactly one writer can win each
   * index, so after a single loss the winner's row exists and a re-read finds
   * it; a loop would be a loop around a condition that cannot recur.
   */
  private async attach(uid: string, email: string): Promise<StoredUser> {
    const at = this.now();
    const existing = await this.users.findByEmail(email);

    if (existing !== null) {
      if (await this.users.linkFirebaseUid(existing.id, uid, at)) {
        this.logger.log(`Linked ${mask(email)} to a Firebase identity`);
        return { ...existing, firebaseUid: uid };
      }
      // The row gained an identity between the read and the write. Whose?
      return this.reread(uid, email);
    }

    const created = await this.users.createFederated(email, uid, at, at);
    if (created !== null) {
      this.logger.log(`Registered ${mask(email)} through Firebase`);
      return created;
    }

    return this.reread(uid, email);
  }

  /**
   * Who won the race, or a refusal.
   *
   * THE SECOND LOOKUP IS BY UID, NOT BY EMAIL, and the difference is a security
   * boundary. Answering with whatever row holds the address would hand this
   * caller an account that a DIFFERENT Firebase identity just linked — the
   * takeover the update filter exists to prevent, reintroduced in the error
   * path. Only a row that carries THIS uid is this caller's.
   */
  private async reread(uid: string, email: string): Promise<StoredUser> {
    const settled = await this.users.findByFirebaseUid(uid);
    if (settled !== null) return settled;

    this.logger.warn(
      `Could not attach a Firebase identity to ${mask(email)}: the address is ` +
        'held by a different identity.',
    );
    throw new ApiError(
      'ACCOUNT_CONFLICT',
      'That email address is already in use by another sign-in method. ' +
        'Contact the operator.',
      409,
    );
  }
}
