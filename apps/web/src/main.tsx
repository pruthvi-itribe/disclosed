import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

const root = document.getElementById('root');
// A THROW RATHER THAN A SILENT RETURN. A missing mount point means the
// document was built wrong, and a blank page with no error is the hardest
// version of that to diagnose.
if (root === null) throw new Error('#root is missing from the document');

createRoot(root).render(<StrictMode />);
