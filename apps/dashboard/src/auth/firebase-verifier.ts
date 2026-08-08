import { Logger } from '@nestjs/common';
import {
  deleteApp,
  getApps,
  initializeApp,
  type App,
} from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { describeError } from '@app/common';
import type { FirebaseConfig } from '../config/auth-config';
import { ApiError } from './api-error';

/**
 * Checking that a Firebase ID token is real, and nothing else.
 *
 * ================================================================
 * WHY THIS IS AN INTERFACE WITH ONE PRODUCTION IMPLEMENTATION
 * ================================================================
 *
 * The same reason `PasswordHasher` is one: the tests must be able to drive every
 * branch of the sign-in path — a token for a brand new identity, a token whose
 * address already has a local account, an unverified address, a token with no
 * address at all — and none of those is reachable without either a live Firebase
 * project or a forged RS256 signature. A stub verifier makes the sign-in service
 * fully testable offline, and `firebase-sign-in.spec.ts` drives eleven cases
 * through it. The alternative is a service whose interesting behaviour is only
 * exercised by hand.
 *
 * ================================================================
 * WHAT THE ADMIN SDK CHECKS, AND WHY IT IS NOT HAND-ROLLED
 * ================================================================
 *
 * `verifyIdToken` checks the RS256 signature against Google's rotating x509
 * certificates, and the `aud`, `iss`, `exp`, `iat` and `sub` claims against the
 * project. Every one of those is a way in if it is skipped, and key rotation is
 * the one people forget. This is the piece of an authentication system with the
 * worst ratio of "looks simple" to "is subtle", so it uses the vendor's own
 * implementation.
 *
 * NO SERVICE-ACCOUNT CREDENTIAL IS INVOLVED, and no environment variable carries
 * one. Verification is a signature check against Google's public certificates
 * plus a project-id comparison; it calls no authenticated Google API. A service
 * account would buy `checkRevoked` and the user-management APIs, and this path
 * uses neither — so the founder configures two variables and no key file, and
 * there is no private key on this host to leak. `firebase-verifier.spec.ts`
 * constructs this with a project id alone and proves it refuses a token, which
 * is what keeps that claim from being an assumption.
 *
 * ================================================================
 * THE DEPENDENCY, MEASURED
 * ================================================================
 *
 * `firebase-admin` adds 120 packages. `npm audit --omit=dev` went from 15
 * advisories to 22 on this branch, measured before and after the install on
 * 2026-08-08. All seven of the new ones are inside `@google-cloud/firestore` and
 * `@google-cloud/storage`, which are OPTIONAL dependencies of `firebase-admin`
 * and are never imported here — the same posture `dashboard.module.ts` argues
 * for multer, and with the same mitigation available: `npm ci --omit=optional`
 * drops both trees and leaves token verification working, because it needs only
 * `jsonwebtoken` and `jwks-rsa`.
 */

/** Who a verified token says the caller is. The only three claims read. */
export interface FirebaseIdentity {
  /** The `sub` claim. Stable across an email change, which is why it is the key. */
  readonly uid: string;
  /** The `email` claim, as Firebase spells it. Normalised downstream. */
  readonly email: string;
  /** The `email_verified` claim. See `firebase-sign-in.ts` for what rests on it. */
  readonly emailVerified: boolean;
}

/** The one operation the sign-in path needs. Rejects rather than returning null. */
export interface FirebaseTokenVerifier {
  verify(idToken: string): Promise<FirebaseIdentity>;
}

/**
 * The refusal every bad token produces, whatever was wrong with it.
 *
 * ONE MESSAGE for an expired token, a token signed by another project, a
 * malformed token and a forged one — for the reason `auth.service.ts` gives at
 * length about passwords. A caller who is told WHICH check failed is being
 * handed a debugger for their forgery attempts.
 *
 * The real reason is logged, because an operator diagnosing "nobody can sign in
 * since the deploy" needs to see `aud` mismatch, and a reader must not.
 */
export const invalidIdToken = (): ApiError =>
  new ApiError(
    'INVALID_ID_TOKEN',
    'That sign-in could not be verified. Try again.',
    401,
  );

/** The mode is `firebase` and the keys never arrived. Stated, not guessed at. */
export const authNotConfigured = (missing: readonly string[]): ApiError =>
  new ApiError(
    'AUTH_NOT_CONFIGURED',
    'Sign-in is not configured on this server yet.',
    503,
    { missing },
  );

/**
 * The name this process gives its Firebase app.
 *
 * NAMED RATHER THAN DEFAULT, so a second instance in one process — which is what
 * a Jest suite booting the module twice is — does not collide with the first,
 * and so `close()` can delete exactly its own.
 */
export const FIREBASE_APP_NAME = 'disclosed-dashboard';

/**
 * The real verifier.
 *
 * The app is initialised in the CONSTRUCTOR rather than lazily on first use. A
 * misconfigured project should be a boot failure an operator sees in the startup
 * log, not a 500 the first person to press "Sign in with Google" discovers.
 */
export class AdminSdkVerifier implements FirebaseTokenVerifier {
  private readonly logger = new Logger('firebase');
  private readonly app: App;

  constructor(config: FirebaseConfig) {
    // Reused rather than re-initialised. `initializeApp` throws on a duplicate
    // name, and a hot-reload or a second test module is exactly that.
    const existing = getApps().find((app) => app.name === FIREBASE_APP_NAME);
    this.app =
      existing ??
      // THE PROJECT ID AND NOTHING ELSE. No `credential`, deliberately: see the
      // header. If this ever gains one, `verifyIdToken` still will not use it
      // and the reason to add it must be written down beside it.
      initializeApp({ projectId: config.projectId }, FIREBASE_APP_NAME);
  }

  async verify(idToken: string): Promise<FirebaseIdentity> {
    let decoded;
    try {
      decoded = await getAuth(this.app).verifyIdToken(idToken);
    } catch (error) {
      // LOGGED IN FULL, ANSWERED IN ONE SENTENCE. `aud` mismatch after a project
      // change and "expired 40 minutes ago" are the same refusal to a caller and
      // completely different facts to an operator.
      this.logger.warn(`Refused an ID token: ${describeError(error)}`);
      throw invalidIdToken();
    }

    // A token with no address is a real Firebase token for an identity this
    // product cannot use: anonymous and phone sign-in both produce one. Refused
    // here rather than downstream, so `FirebaseIdentity` never carries an empty
    // email and no caller has to wonder whether it might.
    if (typeof decoded.email !== 'string' || decoded.email.trim() === '') {
      this.logger.warn(
        `Refused an ID token with no email claim (uid ${decoded.uid}).`,
      );
      throw invalidIdToken();
    }

    return {
      uid: decoded.uid,
      email: decoded.email,
      emailVerified: decoded.email_verified === true,
    };
  }

  /** Releases the app. For the test that boots a module and tears it down. */
  async close(): Promise<void> {
    await deleteApp(this.app);
  }
}
