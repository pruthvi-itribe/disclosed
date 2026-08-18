import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { createApiGet } from './shared/api/api-get';
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

const apiGet = createApiGet(createEtagStore());
const apiSend = createApiSend();

createRoot(root).render(
  <StrictMode>
    <App
      apiGet={apiGet}
      apiSend={apiSend}
      onSessionEnded={() => {
        // Reloading hands the decision back to the server, which answers
        // the front door with the landing page — a page making no API call,
        // which is what ends the chain in production. The Vite dev server
        // has no front door: it serves this app to a signed-out browser
        // too, and an unguarded reload loops forever. One timestamp in
        // sessionStorage (not authenticated data — it says only "a reload
        // just happened") breaks the loop: a second signed-out answer
        // within ten seconds stops with a sentence instead of a reload.
        const marker = sessionStorage.getItem('signed-out-reload');
        if (marker !== null && Date.now() - Number(marker) < 10_000) {
          document.body.textContent =
            'Signed out. Open the dashboard origin to sign in.';
          return;
        }
        sessionStorage.setItem('signed-out-reload', String(Date.now()));
        window.location.reload();
      }}
    />
  </StrictMode>,
);
