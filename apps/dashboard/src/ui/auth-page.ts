import type { AuthConfig } from '../config/auth-config';
import {
  AUTH_SCRIPT_FIREBASE,
  AUTH_SCRIPT_LOCAL,
  AUTH_SCRIPT_SHARED,
} from './auth-script';
import { AUTH_PAGE_STYLE } from './auth-page-style';
import { BRAND } from './brand';
import { jsonForScript, sdkModule } from './firebase-sdk';
import { escapeHtml } from './landing';
import { LANDING_STYLE } from './landing-style';
import { BRAND_FAVICON_LINK, BRAND_LOGO, BRAND_LOGO_STYLE } from './logo';

/**
 * The sign-in page.
 *
 * ================================================================
 * THE ONE PLACE THE SELF-CONTAINED RULE IS RELAXED, AND ITS BOUNDS
 * ================================================================
 *
 * CLAUDE.md says: "The dashboard is self-contained. No CDN, no external request,
 * no web font. Inline everything." That invariant is unchanged for the app and
 * for the landing page — `page.spec.ts` and `landing.spec.ts` both assert the
 * document contains no `https?://` at all.
 *
 * THIS PAGE, AND ONLY THIS PAGE, LOADS THE FIREBASE WEB SDK FROM `gstatic.com`,
 * and only when the mode is `firebase`. The relaxation is recorded here, in
 * CLAUDE.md, and in `auth-page.spec.ts`, which asserts that the ONLY external
 * origin on the page is gstatic and that a `local`-mode render has none at all.
 *
 * WHY IT IS ACCEPTED HERE:
 *
 *   - The alternative is implementing Google's OAuth dance and Firebase's
 *     password endpoints by hand — redirect state, PKCE, token refresh, popup
 *     recovery — which is a large amount of security-critical code written to
 *     avoid one script tag on one page.
 *   - The two reasons the app is self-contained do not apply here. The first is
 *     that a viewer of a local pipeline must work when the network is the
 *     suspect; sign-in against a cloud identity provider cannot work offline
 *     under any implementation. The second is that a third party must not have
 *     script access to a view of the database — and this page HAS NO DATABASE
 *     ACCESS. It renders no filing, calls no read route, and holds no session
 *     until the moment it navigates away.
 *   - The blast radius is one page whose entire content, in this mode, is one
 *     button, and gstatic is the origin Google serves the SDK from.
 *
 * WHAT IS STILL REFUSED HERE: a font, a stylesheet, an image, an analytics tag,
 * a Google logo file. The mark beside "Continue with Google" is drawn in CSS.
 * One exception, named, with a test on its boundary.
 *
 * ================================================================
 * THE KEY IN THE PAGE IS NOT A SECRET
 * ================================================================
 *
 * `FIREBASE_WEB_API_KEY` is printed into this document, and that is how Firebase
 * is designed: a web API key identifies a project to Google's endpoints and
 * authorises nothing on its own. What actually guards the project is the
 * authorised-domain list in the Firebase console. `describeAuthConfig` still
 * keeps it out of the startup log, because a key in a log file outlives the
 * process that wrote it and the habit is worth more than the exception.
 */

/**
 * The panel shown when somebody asked for Firebase and the keys never arrived.
 *
 * NAMES THE VARIABLES. "Sign-in is not configured" without saying what to set
 * sends the reader to the source, and the reader here is the founder on the
 * day they deploy this branch before creating the project.
 */
const missingPanel = (missing: readonly string[]): string => `
      <div class="authmissing" data-ui="auth-unconfigured">
        <strong>Sign-in is not configured on this server yet.</strong>
        This build is set to sign people in with Google, and these environment
        variables have not been set:
        <ul>
${missing.map((key) => `          <li><code>${escapeHtml(key)}</code></li>`).join('\n')}
        </ul>
      </div>
      <p class="authnote">
        Set them and restart, or run with <code>AUTH_MODE=local</code> to use an
        email address and a password instead.
      </p>`;

/** The two message lines, which both bodies end in. */
const MESSAGE_LINES = `
      <!-- Two lines, two elements. A refusal and a "check your inbox" are
           opposite outcomes and must not share a red box. -->
      <div id="auth-error" class="autherr" role="alert" hidden></div>
      <div id="auth-ok" class="authok" role="status" hidden></div>`;

/**
 * The Firebase mode's whole body: one button.
 *
 * ONE DOOR IN PRODUCTION. This page used to offer Google and a Firebase
 * email+password form side by side, and the second one earned nothing: Google
 * asserts an address, a Firebase password sign-up does not, so the password half
 * shipped a verification lane, an unverified-address wall and four error codes
 * that all have to collapse into one sentence to avoid becoming a
 * registered-address oracle. The routes behind it are untouched and
 * `AUTH_MODE=local` still renders the form below — this removes a form from one
 * mode, not a capability from the server.
 */
const googleButton = (): string => `
      <button id="auth-google" class="authbtn" type="button" data-ui="google">
        <span class="gmark" aria-hidden="true">G</span>
        Continue with Google
      </button>
${MESSAGE_LINES}

      <p class="authnote">
        Signing in for the first time creates your account. There is no password
        to choose — Google confirms your address.
      </p>`;

/**
 * The in-house form, which only `AUTH_MODE=local` renders.
 *
 * THE DEV AND TEST DOOR, and the door before an operator's Firebase keys
 * arrive. The browser suite signs in through it — `e2e/session.ts` registers a
 * throwaway account through the real register route, because there is
 * deliberately no test bypass in the server.
 */
const credentialsForm = (): string => `
      <form id="auth-form" data-ui="auth-form">
        <label class="authfield" for="auth-email">
          <span>Email</span>
          <input id="auth-email" name="email" type="email" autocomplete="email"
                 autocapitalize="none" spellcheck="false" required>
        </label>
        <label class="authfield" for="auth-password">
          <span>Password</span>
          <input id="auth-password" name="password" type="password"
                 autocomplete="current-password" required>
        </label>
        <button id="auth-go" class="authbtn primary" type="submit" data-ui="submit">Sign in</button>
        <div class="authrow">
          <button id="auth-alt" class="authalt" type="button" data-ui="switch-mode">Create an account</button>
        </div>
      </form>
${MESSAGE_LINES}

      <p class="authnote">
        No self-serve password reset yet: message the operator and it will be
        reset by hand.
      </p>`;

/**
 * The page.
 *
 * Takes the resolved `AuthConfig` and nothing else. Every branch — Google alone,
 * the in-house form alone, or the unconfigured panel — is decided here at render
 * time rather than by client code asking the server what mode it is in, so a
 * `local` host never ships a line of Firebase code and a visitor never sees a
 * button that cannot work.
 */
export const renderAuthPage = (auth: AuthConfig): string => {
  const live = auth.firebase;
  const firebaseMode = live !== null;

  const body = firebaseMode
    ? googleButton()
    : auth.mode === 'firebase'
      ? missingPanel(auth.missing)
      : credentialsForm();

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="dark">
<title>Sign in — ${BRAND}</title>
<!-- The icon travels in the attribute; nothing is fetched. See logo.ts. -->
${BRAND_FAVICON_LINK}
<style>${LANDING_STYLE}${AUTH_PAGE_STYLE}${BRAND_LOGO_STYLE}</style>
</head>
<body>
<div class="authshell">
  <div class="authpanel">
    <a class="authback" href="/">&larr; Back</a>
    ${BRAND_LOGO}
    <h1 id="auth-title" class="authtitle">Sign in</h1>
    <p id="auth-lead" class="authlead">Welcome back.</p>
${body}
  </div>
</div>
${
  firebaseMode
    ? `
<!--
  THE PROJECT'S KEYS, AS DATA RATHER THAN AS CODE.

  A JSON script element the fragment parses, rather than values interpolated
  into the script body. Interpolating into a fragment is the sharp edge
  CLAUDE.md records: the compiler consumes the substitution before a browser
  sees it and the page ships a 200 that throws on load. Reading configuration
  out of a JSON element has no such failure mode, and this element's type is not
  "text/javascript", so nothing executes it.
-->
<script type="application/json" id="firebase-config">${jsonForScript({
        apiKey: live.webApiKey,
        authDomain: live.authDomain,
        projectId: live.projectId,
      })}</script>
<script type="module">
import { initializeApp } from "${sdkModule('app')}";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  sendEmailVerification,
  signOut
} from "${sdkModule('auth')}";
(function () {
  'use strict';
${AUTH_SCRIPT_SHARED}${AUTH_SCRIPT_FIREBASE}
})();
</script>`
    : auth.mode === 'firebase'
      ? ''
      : `
<script>
(function () {
  'use strict';
${AUTH_SCRIPT_SHARED}${AUTH_SCRIPT_LOCAL}
})();
</script>`
}
</body>
</html>
`;
};
