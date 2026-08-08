import { ApiError } from './api-error';
import {
  AdminSdkVerifier,
  authNotConfigured,
  FIREBASE_APP_NAME,
  invalidIdToken,
} from './firebase-verifier';

/**
 * What can be proved about the real verifier without a live Firebase project.
 *
 * Not much, and that is the point of the interface — `firebase-sign-in.spec.ts`
 * drives the branches that matter through a stub. What IS worth proving here is
 * the claim the configuration rests on and that nothing else checks: that this
 * constructs and refuses tokens WITH NO SERVICE-ACCOUNT CREDENTIAL AT ALL. If
 * that were wrong, the founder would supply two variables, the process would
 * boot, and the first sign-in would fail on a missing key file.
 *
 * NO NETWORK. A token that is not three base64 segments fails at the decode
 * step, before any certificate fetch, so this runs in Jest's offline suite.
 */

const CONFIG = {
  projectId: 'disclosed-test',
  webApiKey: 'AIza-not-a-secret',
  authDomain: 'disclosed-test.firebaseapp.com',
};

describe('AdminSdkVerifier', () => {
  let verifier: AdminSdkVerifier;

  beforeAll(() => {
    // NO `credential`. This line is the assertion: if verification needed a
    // service account, this would be where it complained.
    verifier = new AdminSdkVerifier(CONFIG);
  });

  afterAll(async () => {
    await verifier.close();
  });

  it('constructs from a project id alone', () => {
    expect(verifier).toBeInstanceOf(AdminSdkVerifier);
  });

  it('reuses its app rather than colliding on a second construction', async () => {
    // `initializeApp` throws on a duplicate name, and a second module boot in
    // one Jest process is exactly that. The named app is looked up first.
    const second = new AdminSdkVerifier(CONFIG);

    expect(FIREBASE_APP_NAME).toBe('disclosed-dashboard');
    await expect(second.verify('nonsense')).rejects.toThrow(ApiError);
  });

  it('refuses a token that is not a token, in one sentence', async () => {
    await expect(verifier.verify('nonsense')).rejects.toMatchObject({
      code: 'INVALID_ID_TOKEN',
      message: 'That sign-in could not be verified. Try again.',
    });
  });

  it('says nothing about WHICH check failed', async () => {
    // One message for expired, wrong-project, malformed and forged alike — the
    // argument `auth.service.ts` makes at length about passwords. A caller told
    // which check failed has been handed a debugger for their forgery.
    const junk = await verifier
      .verify('a.b.c')
      .catch((error: unknown) => error);
    const empty = await verifier.verify('').catch((error: unknown) => error);

    expect((junk as ApiError).message).toBe((empty as ApiError).message);
  });
});

describe('the two refusals this file owns', () => {
  it('answers a bad token with a 401', () => {
    expect(invalidIdToken().getStatus()).toBe(401);
  });

  it('answers an unconfigured server with a 503 naming the variables', () => {
    // 503 rather than 401: the caller did nothing wrong and retrying with a
    // better token will not help. The meta carries what an operator must set.
    const refusal = authNotConfigured(['FIREBASE_WEB_API_KEY']);

    expect(refusal.getStatus()).toBe(503);
    expect(refusal.meta).toEqual({ missing: ['FIREBASE_WEB_API_KEY'] });
  });
});
