import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { createApiGet } from './shared/api/api-get';
import { createEtagStore } from './shared/api/etag-store';
import './shared/ui/tokens.css';

const root = document.getElementById('root');
// A THROW RATHER THAN A SILENT RETURN. A missing mount point means the
// document was built wrong, and a blank page with no error is the hardest
// version of that to diagnose.
if (root === null) throw new Error('#root is missing from the document');

const apiGet = createApiGet(createEtagStore());

createRoot(root).render(
  <StrictMode>
    <App
      apiGet={apiGet}
      onSessionEnded={() => {
        // Reloading hands the decision back to the server, which answers the
        // front door with the landing page. Guarded against a loop by the
        // fact that a signed-out reload lands on a page making no API call.
        window.location.reload();
      }}
    />
  </StrictMode>,
);
