import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { createApiGet } from './shared/api/api-get';
import { createOriginFetcher } from './shared/api/api-origin';
import { createApiSend } from './shared/api/api-send';
import { createEtagStore } from './shared/api/etag-store';
import {
  clearShellToken,
  readShellToken,
  withBearer,
  writeShellToken,
} from './shared/api/shell-token';
import { SignInView } from './features/shell-auth/SignInView';
import { BrandLogo } from './app/BrandLogo';
// The four stylesheets the server concatenated into one <style> element,
// imported in the same order so the cascade resolves identically. All are
// verbatim ports (styles-mirror.spec.ts) and Vite emits them as the one
// stylesheet link the bundle audit budgets.
import './shared/ui/tokens.css';
import './shared/ui/page.css';
import './shared/ui/brief.css';
import './shared/ui/focus.css';
import './shared/ui/logo.css';
// The one non-ported rule: #root { display: contents } — see its header.
import './shared/ui/app.css';

const root = document.getElementById('root');
// A THROW RATHER THAN A SILENT RETURN. A missing mount point means the
// document was built wrong, and a blank page with no error is the hardest
// version of that to diagnose.
if (root === null) throw new Error('#root is missing from the document');

/**
 * THE SHELL'S ONE BOOT MARK. Capacitor injects `window.Capacitor` into the
 * WebView it owns; a browser never has it, so the web document never gains
 * the class and app.css's shell-feel rules never apply there. The viewport
 * is widened to the notch (`viewport-fit=cover`) HERE rather than in
 * index.html, because the meta is shared with the web build — where cover
 * would push content under a landscape notch that Safari otherwise
 * manages itself.
 */
const capacitor = (
  window as { Capacitor?: { isNativePlatform?: () => boolean } }
).Capacitor;
const isNativeShell = capacitor?.isNativePlatform?.() === true;
if (isNativeShell) {
  document.documentElement.classList.add('native-shell');
  // THE LOUDEST WEBVIEW TELL: focusing an input whose font is under 16px
  // makes iOS zoom the page and STAY zoomed (found live in the search
  // sheet, 2026-08-18). Native app UI does not pinch-zoom, so the shell
  // pins the scale; shell-chrome.css also raises inputs to 16px, killing
  // the trigger as well as the policy. Interaction policy reads the meta
  // at gesture time, so a runtime write is reliable here — unlike the
  // env() geometry, which needed the static viewport-fit in index.html.
  document
    .querySelector('meta[name="viewport"]')
    ?.setAttribute(
      'content',
      'width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1',
    );
}

// '' in the browser (same origin, no absolute URL in the bundle); the
// mobile shell's build injects the production origin here — see api-origin.ts.
const originFetch = createOriginFetcher(
  (import.meta.env.VITE_API_ORIGIN as string | undefined) ?? '',
);
// The shell rides bearer transport — its cookie is inert cross-scheme
// (shell-token.ts) — and the browser build never touches the token store.
const apiFetch = isNativeShell
  ? withBearer(originFetch, readShellToken)
  : originFetch;
const apiGet = createApiGet(createEtagStore(), apiFetch);
const apiSend = createApiSend(apiFetch);
const reactRoot = createRoot(root);

/**
 * DEV-ONLY loop breaker, read once at boot. In production a signed-out
 * reload lands on the server's front door, which answers with the landing
 * page — a page making no API call — and that ends the chain; the breaker
 * must not run there, or signing out twice inside ten seconds would wipe
 * the page to an unstyled dead sentence. The Vite dev server has no front
 * door: it serves this app to a signed-out browser too, and an unguarded
 * reload loops forever. The marker (not authenticated data — it says only
 * "that boot reloaded for being signed out") is REMOVED as it is read, so
 * a signed-in visit clears it and a later genuine sign-out reloads
 * normally. Storage can THROW (Safari's Block All Cookies) — then there
 * is no breaker, and the reload below still happens.
 */
const priorSignedOutReloadAt = ((): number | null => {
  if (!import.meta.env.DEV) return null;
  try {
    const marker = sessionStorage.getItem('signed-out-reload');
    sessionStorage.removeItem('signed-out-reload');
    return marker === null ? null : Number(marker);
  } catch {
    return null;
  }
})();

/**
 * THE NATIVE GOOGLE DOOR, reached through the bridge Capacitor injects
 * rather than through an import: the plugin's JS proxy arrives on
 * `window.Capacitor.Plugins` from the native side, so the web bundle
 * carries no Capacitor or Firebase dependency and the bundle audit stays
 * exactly as it was. Null in a browser and in a shell built without the
 * plugin — the door's button then explains itself instead of doing
 * nothing.
 */
const nativeGoogle = (): (() => Promise<string>) | null => {
  const plugin = (
    window as {
      Capacitor?: {
        Plugins?: {
          FirebaseAuthentication?: {
            signInWithGoogle: () => Promise<unknown>;
            getIdToken: () => Promise<{ token?: string }>;
          };
        };
      };
    }
  ).Capacitor?.Plugins?.FirebaseAuthentication;
  if (plugin === undefined) return null;
  return async () => {
    // TWO TOKENS COME OUT OF THE SHEET AND ONLY ONE IS OURS. The sign-in
    // result's credential.idToken is GOOGLE's (aud = the iOS OAuth client),
    // and the server's verifier checks aud against the FIREBASE project —
    // exchanging Google's answered "That sign-in could not be verified" on
    // the simulator (2026-08-18, 'incorrect aud' in the server log). The
    // FIREBASE ID token is what getIdToken() returns after the native
    // sign-in completes: the same token the web's user.getIdToken() sends.
    await plugin.signInWithGoogle();
    const { token } = await plugin.getIdToken();
    if (typeof token !== 'string' || token === '') {
      throw new Error('Google returned no token to exchange.');
    }
    return token;
  };
};

/**
 * THE SHELL'S FRONT DOOR. The web relies on the server's: a signed-out
 * reload lands on the landing page. The shell has no front door — its
 * first build painted a themed void and polled 401s forever — so a session
 * that is absent or ended swaps the app for the sign-in view instead of
 * reloading. Signing in reboots the shell, which comes up signed in.
 */
const showShellSignIn = (): void => {
  // A boot that landed here holds no living session, so whatever bearer is
  // stored is dead — dropped before the reader tries again.
  clearShellToken();
  reactRoot.render(
    <StrictMode>
      <SignInView
        brand={<BrandLogo />}
        authMode={
          (import.meta.env.VITE_AUTH_MODE as string | undefined) === 'local'
            ? 'local'
            : 'firebase'
        }
        apiSend={apiSend}
        onSignedIn={() => window.location.reload()}
        signInWithGoogle={nativeGoogle()}
        bearerSink={writeShellToken}
      />
    </StrictMode>,
  );
  // The door owns the viewport (body.shelldoor in shell-auth.css). Set
  // AFTER the render call: App's body-class effect clears className in its
  // unmount cleanup, which runs inside that call.
  document.body.className = 'shelldoor';
};

reactRoot.render(
  <StrictMode>
    <App
      apiGet={apiGet}
      apiSend={apiSend}
      onSessionEnded={() => {
        if (isNativeShell) {
          showShellSignIn();
          return;
        }
        if (
          priorSignedOutReloadAt !== null &&
          Date.now() - priorSignedOutReloadAt < 10_000
        ) {
          // Two signed-out answers across consecutive boots: stop with a
          // sentence instead of reloading forever. Unmount FIRST — a
          // wiped body does not clear React's four-second poll interval,
          // which would keep firing requests against the dead session.
          reactRoot.unmount();
          document.body.textContent =
            'Signed out. Open the dashboard origin to sign in.';
          return;
        }
        if (import.meta.env.DEV) {
          try {
            sessionStorage.setItem('signed-out-reload', String(Date.now()));
          } catch {
            // No storage, no breaker — the reload happens regardless.
          }
        }
        window.location.reload();
      }}
    />
  </StrictMode>,
);
