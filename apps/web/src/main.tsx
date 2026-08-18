import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { createApiGet } from './shared/api/api-get';
import { createOriginFetcher } from './shared/api/api-origin';
import { createApiSend } from './shared/api/api-send';
import { createEtagStore } from './shared/api/etag-store';
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
if (capacitor?.isNativePlatform?.() === true) {
  document.documentElement.classList.add('native-shell');
  document
    .querySelector('meta[name="viewport"]')
    ?.setAttribute(
      'content',
      'width=device-width, initial-scale=1, viewport-fit=cover',
    );
}

// '' in the browser (same origin, no absolute URL in the bundle); the
// mobile shell's build injects the production origin here — see api-origin.ts.
const apiFetch = createOriginFetcher(
  (import.meta.env.VITE_API_ORIGIN as string | undefined) ?? '',
);
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

reactRoot.render(
  <StrictMode>
    <App
      apiGet={apiGet}
      apiSend={apiSend}
      onSessionEnded={() => {
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
