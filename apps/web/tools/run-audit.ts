import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { auditBundle } from './bundle-audit';

// NOT `import.meta.dirname`, which is Node 20.11+ and silently undefined on
// the Node 18 this repo still runs locally — join(undefined, ...) would throw
// with a message pointing nowhere near the cause.
const here = dirname(fileURLToPath(import.meta.url));

const violations = auditBundle(join(here, '..', 'dist'));

if (violations.length > 0) {
  for (const v of violations) {
    console.error(`${v.file}: ${v.rule}: ${v.detail}`);
  }
  // A NON-ZERO EXIT, so CI fails rather than printing into a green log.
  process.exit(1);
}
console.log('bundle audit: clean');
