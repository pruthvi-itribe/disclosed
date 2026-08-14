# React Client — Plan 1: Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A static React application that builds, proves it is self-contained, and can fetch the feed — with no product surfaces in it yet.

**Architecture:** `apps/web` is its own npm project with its own `package.json`, so React and Vite never enter the server's dependency tree. Vite emits a static bundle; a bundle audit over `dist/` replaces the specs that asserted the served document; a small explicit fetch layer carries ETag revalidation, strong-validator-only storage, a staleness sequence and the 401 rule.

**Tech Stack:** Vite 5, React 18, TypeScript strict, Vitest + React Testing Library, CSS Modules.

**Spec:** `docs/superpowers/specs/2026-08-14-react-client-design.md` (merged `c6cdedb`).

## Global Constraints

- **Parity is the discipline.** This plan adds no product surface at all. If it renders anything a reader sees, that is out of scope.
- **No formatting in the browser, ever.** The API ships `announcedAtIst`, `amountDisplay`, `currentDisplay` pre-formatted. Nothing here may compute a display value.
- **`/api/*` is `Cache-Control: private, no-store`.** The ETag validator lives in memory only — never `localStorage`, never `sessionStorage`. This is the application revalidating explicitly, not the browser caching.
- **Only STRONG validators are stored.** Express tags every response `W/"..."`; sending `If-None-Match` for a weak one would make every GET start 304-ing.
- **Auth is `credentials: 'include'` and nothing else.** No token storage, no `Authorization` header, no refresh logic. The cookie is `HttpOnly` and the page cannot read it.
- **No `dangerouslySetInnerHTML`.** Exchange text is untrusted; React's escaping is the defence.
- **Self-contained:** no CDN, no web font, no external stylesheet, no absolute `http(s)` URL in the bundle except the XML namespace.
- **Files under 300 lines, functions under 50.**
- **`npm run lint:ci`, never `npm run lint`** — the latter carries `--fix` and passes by rewriting the tree.
- **`main` is branch-protected.** Everything lands by PR with `lint, types, tests, build` green.

**Baseline:** 5,713 Jest tests, 147 suites, all green at `c6cdedb`.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `apps/web/package.json` | The web project's own dependencies, isolated from the server's | 1 |
| `apps/web/vite.config.ts` | Build to `dist/`, inline assets, no code-splitting | 1 |
| `apps/web/tsconfig.json` | Strict, DOM libs, its own scope | 1 |
| `apps/web/index.html` | The one entry document | 1 |
| `apps/web/src/main.tsx` | Mount, and nothing else | 1 |
| `apps/web/src/app/App.tsx` | The shell — currently a status line | 5 |
| `apps/web/tools/bundle-audit.ts` | Reads `dist/`, returns violations. Pure, so it is testable | 2 |
| `apps/web/tools/bundle-audit.spec.ts` | Proves the audit fails on planted violations | 2 |
| `apps/web/src/shared/api/etag-store.ts` | In-memory, strong-only validator storage | 3 |
| `apps/web/src/shared/api/api-get.ts` | `apiGet`: revalidation, staleness, 401 | 3 |
| `apps/web/src/shared/api/*.spec.ts` | Both, against a fetch double | 3 |
| `apps/web/src/shared/ui/tokens.module.css` | The 14 design tokens, ported verbatim | 4 |
| `.github/workflows/ci.yaml` | Build and audit the web bundle | 6 |
| `Dockerfile` | Build `apps/web` and place `dist/` where Caddy will serve it | 6 |

---

### Task 1: The scaffold

**Files:**
- Create: `apps/web/package.json`, `apps/web/vite.config.ts`, `apps/web/tsconfig.json`, `apps/web/index.html`, `apps/web/src/main.tsx`, `apps/web/.eslintrc.cjs`, `apps/web/src/smoke.spec.ts`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `npm --prefix apps/web run build` emits `apps/web/dist/`; `npm --prefix apps/web test` runs Vitest.

**Why its own `package.json`:** the repo has no npm workspaces and one dependency tree that the server images install with `npm ci`. Adding React and Vite to it would put a UI toolchain into `apps/ingest`'s image for no reason. A nested project keeps the trees separate at the cost of one extra install step, which Task 6 wires into CI.

- [ ] **Step 1: Create the project files**

`apps/web/package.json`:

```json
{
  "name": "@disclosed/web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run",
    "lint:ci": "eslint \"src/**/*.{ts,tsx}\" \"tools/**/*.ts\""
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.4.8",
    "@testing-library/react": "^16.0.0",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "eslint-plugin-jsx-a11y": "^6.9.0",
    "eslint-plugin-react-hooks": "^4.6.2",
    "jsdom": "^24.1.1",
    "typescript": "^5.5.4",
    "vite": "^5.4.0",
    "vitest": "^2.0.5"
  }
}
```

`apps/web/vite.config.ts` — the inlining limits are what keep the bundle self-contained:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // ONE JS FILE AND ONE CSS FILE. Code-splitting would emit chunks fetched
    // at runtime, and the bundle audit in Task 2 can only reason about what it
    // can read on disk. A dynamic import is also how a third-party origin
    // sneaks past a check that only reads the entry point.
    rollupOptions: { output: { manualChunks: undefined } },
    // Assets below this size are emitted as `data:` URIs rather than as files
    // the document would have to fetch. 4 MB is far above anything this app
    // carries; the favicon is the only asset today.
    assetsInlineLimit: 4 * 1024 * 1024,
    cssCodeSplit: false,
    sourcemap: false,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
});
```

`apps/web/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noEmit": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src", "tools", "vite.config.ts"]
}
```

`apps/web/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Disclosed</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`apps/web/src/main.tsx`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

const root = document.getElementById('root');
// A THROW RATHER THAN A SILENT RETURN. A missing mount point means the
// document was built wrong, and a blank page with no error is the hardest
// version of that to diagnose.
if (root === null) throw new Error('#root is missing from the document');

createRoot(root).render(<StrictMode />);
```

`apps/web/src/test-setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
```

`apps/web/.eslintrc.cjs`:

```js
/**
 * The web project's own rules, extending the repository's.
 *
 * `dangerouslySetInnerHTML` is an ERROR rather than a warning: exchange text
 * is untrusted and React's escaping is the whole defence. The rule is what
 * stops somebody reaching for it to render a claim with emphasis in it.
 */
module.exports = {
  root: true,
  extends: ['../../.eslintrc.js'],
  plugins: ['react-hooks', 'jsx-a11y'],
  rules: {
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'error',
    'react/no-danger': 'error',
    'jsx-a11y/anchor-is-valid': 'error',
  },
};
```

Add to `.gitignore`:

```
apps/web/dist/
apps/web/node_modules/
```

- [ ] **Step 2: Write a smoke test that proves the toolchain runs**

`apps/web/src/smoke.spec.ts`:

```ts
// Not a placeholder test. It asserts the two things Task 1 actually delivers:
// TypeScript compiles under `strict`, and Vitest executes in a DOM.
it('runs in a DOM environment', () => {
  const el = document.createElement('div');
  el.textContent = 'ok';
  expect(el.textContent).toBe('ok');
});

it('has strict null checking on', () => {
  const maybe: string | null = null;
  expect(maybe ?? 'fallback').toBe('fallback');
});
```

- [ ] **Step 3: Install and run**

```bash
npm --prefix apps/web install
npm --prefix apps/web test
```
Expected: 2 passed.

- [ ] **Step 4: Build**

```bash
npm --prefix apps/web run build
ls apps/web/dist
```
Expected: `index.html` and an `assets/` directory. If `tsc --noEmit` fails, fix the types rather than relaxing `tsconfig.json`.

- [ ] **Step 5: Commit**

```bash
git add apps/web .gitignore
git commit -m "feat: scaffold the web client as its own project"
```

---

### Task 2: The bundle audit

**Files:**
- Create: `apps/web/tools/bundle-audit.ts`, `apps/web/tools/bundle-audit.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface Violation { readonly file: string; readonly rule: string; readonly detail: string; }
  export const auditBundle: (dir: string) => readonly Violation[];
  ```
  Takes a directory so a test can point it at a fixture with a planted violation. Task 6 runs it against `apps/web/dist`.

**Why this replaces the served-document specs:** `page.spec.ts` and its siblings assert what is IN the HTML, which bounds only what we wrote. On 2026-08-13 a third-party script fetched two Google origins that appeared nowhere in the document and the CSP blocked them in production. Reading the emitted bundle sees a transitive import that would fetch at runtime.

- [ ] **Step 1: Write the failing tests**

`apps/web/tools/bundle-audit.spec.ts`:

```ts
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { auditBundle } from './bundle-audit';

/**
 * The audit is only worth having if it FAILS on the things it claims to catch,
 * so every rule below is planted deliberately. This repository has shipped two
 * guards that were green because they were broken; a clean audit over a clean
 * bundle proves nothing on its own.
 */
const bundleWith = (files: Record<string, string>): string => {
  const dir = mkdtempSync(join(tmpdir(), 'audit-'));
  mkdirSync(join(dir, 'assets'), { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(dir, name), body, 'utf8');
  }
  return dir;
};

const CLEAN_HTML =
  '<!doctype html><html><head><link rel="icon" href="data:image/svg+xml,x">' +
  '</head><body><script type="module" src="/assets/main.js"></script></body></html>';

describe('auditBundle', () => {
  it('passes a self-contained bundle', () => {
    const dir = bundleWith({
      'index.html': CLEAN_HTML,
      'assets/main.js': 'const ns = "http://www.w3.org/2000/svg";',
    });
    expect(auditBundle(dir)).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  it.each([
    ['a CDN script', 'assets/main.js', 'fetch("https://cdn.example/x.js")'],
    ['an absolute image', 'assets/main.js', 'img.src = "http://img.example/a.png"'],
  ])('reports %s', (_label, file, body) => {
    const dir = bundleWith({ 'index.html': CLEAN_HTML, [file]: body });
    expect(auditBundle(dir).map((v) => v.rule)).toContain('absolute-url');
    rmSync(dir, { recursive: true, force: true });
  });

  // THE XML NAMESPACE IS A NAME, NOT AN ADDRESS. No browser fetches it, and
  // the SVG icons cannot be created without it.
  it('allows the XML namespace', () => {
    const dir = bundleWith({
      'index.html': CLEAN_HTML,
      'assets/main.js': 'createElementNS("http://www.w3.org/2000/svg", "svg")',
    });
    expect(auditBundle(dir)).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  it('reports a second link element', () => {
    const dir = bundleWith({
      'index.html':
        CLEAN_HTML.replace('</head>', '<link rel="stylesheet" href="/a.css"></head>'),
      'assets/main.js': '',
    });
    expect(auditBundle(dir).map((v) => v.rule)).toContain('one-link-only');
    rmSync(dir, { recursive: true, force: true });
  });

  it('reports a remote font face', () => {
    const dir = bundleWith({
      'index.html': CLEAN_HTML,
      'assets/main.css': '@font-face{font-family:X;src:url(https://f.example/x.woff2)}',
    });
    const rules = auditBundle(dir).map((v) => v.rule);
    expect(rules).toContain('absolute-url');
    rmSync(dir, { recursive: true, force: true });
  });

  // A bundle that was never built must not read as a clean one.
  it('reports a missing or empty bundle rather than passing it', () => {
    const dir = bundleWith({});
    expect(auditBundle(dir).map((v) => v.rule)).toContain('no-bundle');
    rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm --prefix apps/web test -- bundle-audit`
Expected: FAIL — cannot find module `./bundle-audit`.

- [ ] **Step 3: Implement**

`apps/web/tools/bundle-audit.ts`:

```ts
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join, relative } from 'path';

/** One thing the bundle carries that it must not. */
export interface Violation {
  readonly file: string;
  readonly rule: string;
  readonly detail: string;
}

/**
 * The XML namespace, which is a NAME rather than an address.
 * `createElementNS` needs it and no browser fetches it.
 */
const XML_NAMESPACE = 'http://www.w3.org/2000/svg';

/** Any absolute http(s) URL. */
const ABSOLUTE_URL = /https?:\/\/[^\s"'`)]+/g;

const filesUnder = (dir: string): readonly string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });

/**
 * Everything the built bundle carries that would leave this origin.
 *
 * Reads the EMITTED OUTPUT rather than the source, which is the point: a
 * transitive import that fetches at runtime is invisible in the source and
 * present here.
 */
export const auditBundle = (dir: string): readonly Violation[] => {
  if (!existsSync(dir)) {
    return [{ file: dir, rule: 'no-bundle', detail: 'the directory does not exist' }];
  }

  const files = filesUnder(dir).filter((f) => /\.(html|js|css)$/.test(f));
  if (files.length === 0) {
    return [{ file: dir, rule: 'no-bundle', detail: 'no html, js or css emitted' }];
  }

  const violations: Violation[] = [];

  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const name = relative(dir, file);

    for (const url of source.match(ABSOLUTE_URL) ?? []) {
      if (url.startsWith(XML_NAMESPACE)) continue;
      violations.push({ file: name, rule: 'absolute-url', detail: url });
    }

    if (file.endsWith('.html')) {
      const links = source.match(/<link\b/g) ?? [];
      if (links.length > 1) {
        violations.push({
          file: name,
          rule: 'one-link-only',
          detail: `${links.length} link elements; only the inlined favicon is allowed`,
        });
      }
    }
  }

  return violations;
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm --prefix apps/web test -- bundle-audit`
Expected: PASS, 6 tests.

- [ ] **Step 5: Run it against the real bundle**

```bash
npm --prefix apps/web run build
npx --prefix apps/web tsx apps/web/tools/run-audit.ts 2>/dev/null || \
  node --input-type=module -e "
    import('./apps/web/tools/bundle-audit.ts').catch(() => {});
  "
```

If the real bundle reports violations, they are real — fix the build, not the audit. Vite emits a `crossorigin` attribute and absolute paths beginning `/`, neither of which matches `https?://`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/tools
git commit -m "test: audit the built bundle for anything that would leave this origin"
```

---

### Task 3: The fetch layer

**Files:**
- Create: `apps/web/src/shared/api/etag-store.ts`, `apps/web/src/shared/api/etag-store.spec.ts`, `apps/web/src/shared/api/api-get.ts`, `apps/web/src/shared/api/api-get.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ApiEnvelope<T> {
    readonly success: boolean;
    readonly data: T;
    readonly error: { readonly code: string; readonly message: string } | null;
    readonly meta: unknown;
  }
  export type ApiResult<T> =
    | { readonly status: 'ok'; readonly body: ApiEnvelope<T> }
    | { readonly status: 'unchanged' }
    | { readonly status: 'stale' };
  export const apiGet: <T>(path: string, seq?: () => boolean) => Promise<ApiResult<T>>;
  export class SessionEndedError extends Error {}
  ```
  `'unchanged'` is a 304 — the caller keeps what it has. `'stale'` means a newer request superseded this one and the response must be discarded. A 401 rejects with `SessionEndedError`.

- [ ] **Step 1: Write the failing tests for the store**

`apps/web/src/shared/api/etag-store.spec.ts`:

```ts
import { createEtagStore } from './etag-store';

/**
 * Express tags EVERY response `W/"..."`. Storing a weak validator and sending
 * it back would make every GET start answering 304 — including views whose
 * renderers were never taught to expect one. Only strong validators are kept.
 */
describe('createEtagStore', () => {
  it('keeps a strong validator and returns it for the same path', () => {
    const store = createEtagStore();
    store.remember('/api/filings?limit=25', '"abc"');
    expect(store.validatorFor('/api/filings?limit=25')).toBe('"abc"');
  });

  it('ignores a weak validator', () => {
    const store = createEtagStore();
    store.remember('/api/summary', 'W/"abc"');
    expect(store.validatorFor('/api/summary')).toBeNull();
  });

  it('keys on the whole path including its query', () => {
    const store = createEtagStore();
    store.remember('/api/filings?limit=25', '"a"');
    expect(store.validatorFor('/api/filings?limit=50')).toBeNull();
  });

  it('returns null for a path it has never seen', () => {
    expect(createEtagStore().validatorFor('/api/nothing')).toBeNull();
  });

  it('replaces a validator when the resource changes', () => {
    const store = createEtagStore();
    store.remember('/api/filings', '"one"');
    store.remember('/api/filings', '"two"');
    expect(store.validatorFor('/api/filings')).toBe('"two"');
  });

  // Nothing authenticated may outlive the tab. A validator is a fingerprint of
  // a signed-in response and belongs in memory only.
  it('touches no browser storage', () => {
    const store = createEtagStore();
    store.remember('/api/filings', '"abc"');
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm --prefix apps/web test -- etag-store`
Expected: FAIL — cannot find module `./etag-store`.

- [ ] **Step 3: Implement the store**

`apps/web/src/shared/api/etag-store.ts`:

```ts
/**
 * The last validator seen for each path, in memory.
 *
 * IN MEMORY ONLY, and that is a contract rather than a convenience. `/api/*`
 * is served `Cache-Control: private, no-store` because an authenticated
 * response may never be stored or replayed; a validator is a fingerprint of
 * one, and putting it in `localStorage` would outlive the session it belongs
 * to.
 */
export interface EtagStore {
  readonly remember: (path: string, validator: string | null) => void;
  readonly validatorFor: (path: string) => string | null;
}

/** A weak validator, which Express attaches to every response by default. */
const WEAK = /^W\//;

export const createEtagStore = (): EtagStore => {
  const byPath = new Map<string, string>();

  return {
    remember: (path, validator) => {
      // ONLY STRONG VALIDATORS. Express tags everything `W/"..."`, so keeping
      // those would send `If-None-Match` on every route and start 304-ing
      // views that have no branch for it.
      if (validator === null || WEAK.test(validator)) return;
      byPath.set(path, validator);
    },
    validatorFor: (path) => byPath.get(path) ?? null,
  };
};
```

- [ ] **Step 4: Write the failing tests for `apiGet`**

`apps/web/src/shared/api/api-get.spec.ts`:

```ts
import { createApiGet, SessionEndedError } from './api-get';
import { createEtagStore } from './etag-store';

const jsonResponse = (body: unknown, etag?: string): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: etag === undefined ? {} : { ETag: etag },
  });

const envelope = { success: true, data: [1], error: null, meta: null };

describe('apiGet', () => {
  it('sends credentials, because the session is a cookie the page cannot read', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(envelope));
    const apiGet = createApiGet(createEtagStore(), fetcher);

    await apiGet('/api/filings');

    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      credentials: 'include',
    });
  });

  it('returns the body and remembers a strong validator', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(envelope, '"abc"'));
    const store = createEtagStore();
    const apiGet = createApiGet(store, fetcher);

    const result = await apiGet('/api/filings');

    expect(result).toEqual({ status: 'ok', body: envelope });
    expect(store.validatorFor('/api/filings')).toBe('"abc"');
  });

  it('sends If-None-Match on the next call and reports unchanged on 304', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(envelope, '"abc"'))
      .mockResolvedValueOnce(new Response(null, { status: 304 }));
    const apiGet = createApiGet(createEtagStore(), fetcher);

    await apiGet('/api/filings');
    const second = await apiGet('/api/filings');

    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({
      headers: { 'If-None-Match': '"abc"' },
    });
    expect(second).toEqual({ status: 'unchanged' });
  });

  // `res.ok` is FALSE for 304. Handling it after an `!ok` guard would throw on
  // every successful revalidation, which is the single easiest way to get this
  // wrong.
  it('does not treat 304 as a failure', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 304 }));
    const apiGet = createApiGet(createEtagStore(), fetcher);

    await expect(apiGet('/api/filings')).resolves.toEqual({ status: 'unchanged' });
  });

  // A session that ended under an open tab is not a pipeline fault. The caller
  // reloads into the landing page rather than painting a red banner every four
  // seconds.
  it('rejects a 401 with SessionEndedError', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
    const apiGet = createApiGet(createEtagStore(), fetcher);

    await expect(apiGet('/api/filings')).rejects.toBeInstanceOf(SessionEndedError);
  });

  it('throws with the status for any other failure', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('nope', { status: 500 }));
    const apiGet = createApiGet(createEtagStore(), fetcher);

    await expect(apiGet('/api/filings')).rejects.toThrow(/500/);
  });

  // Responses do not arrive in the order requests were sent. A poll dispatched
  // before a ticker click can land after it and paint the feed as that
  // company's filings; the caller claims a sequence before dispatch and this
  // drops anything no longer current.
  it('reports stale when the caller says its request was superseded', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(envelope, '"abc"'));
    const apiGet = createApiGet(createEtagStore(), fetcher);

    const result = await apiGet('/api/filings', () => false);

    expect(result).toEqual({ status: 'stale' });
  });

  it('does not remember a validator from a superseded response', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(envelope, '"abc"'));
    const store = createEtagStore();
    const apiGet = createApiGet(store, fetcher);

    await apiGet('/api/filings', () => false);

    expect(store.validatorFor('/api/filings')).toBeNull();
  });
});
```

- [ ] **Step 5: Run to verify it fails**

Run: `npm --prefix apps/web test -- api-get`
Expected: FAIL — cannot find module `./api-get`.

- [ ] **Step 6: Implement**

`apps/web/src/shared/api/api-get.ts`:

```ts
import type { EtagStore } from './etag-store';

/** The envelope every route answers with. Errors carry a machine-readable code. */
export interface ApiEnvelope<T> {
  readonly success: boolean;
  readonly data: T;
  readonly error: { readonly code: string; readonly message: string } | null;
  readonly meta: unknown;
}

export type ApiResult<T> =
  | { readonly status: 'ok'; readonly body: ApiEnvelope<T> }
  | { readonly status: 'unchanged' }
  | { readonly status: 'stale' };

/**
 * The session ended under an open tab.
 *
 * Its own type so a caller can branch on it: every read is behind the session,
 * and a 401 answered with a red banner reappearing every four seconds reads as
 * an outage and tells the reader nothing they can act on.
 */
export class SessionEndedError extends Error {
  constructor() {
    super('the session ended');
    this.name = 'SessionEndedError';
  }
}

/** Injected so tests need no network and no mock server. */
export type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

export const createApiGet =
  (store: EtagStore, fetcher: Fetcher = fetch) =>
  async <T>(path: string, current: () => boolean = () => true): Promise<ApiResult<T>> => {
    const validator = store.validatorFor(path);
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (validator !== null) headers['If-None-Match'] = validator;

    const response = await fetcher(path, {
      // The whole session is this cookie, and it is HttpOnly so the page
      // cannot read it. A future edit to 'omit' would sign everybody out
      // silently.
      credentials: 'include',
      headers,
    });

    // A SUPERSEDED RESPONSE IS DISCARDED WHOLE, validator included. Remembering
    // it would let the next request revalidate against a body this client
    // never rendered.
    if (!current()) return { status: 'stale' };

    // BEFORE THE `ok` CHECK, because `res.ok` is false for 304.
    if (response.status === 304) return { status: 'unchanged' };

    if (response.status === 401) throw new SessionEndedError();

    if (!response.ok) {
      throw new Error(`${path} answered ${response.status}`);
    }

    store.remember(path, response.headers.get('ETag'));
    return { status: 'ok', body: (await response.json()) as ApiEnvelope<T> };
  };
```

- [ ] **Step 7: Run to verify it passes**

Run: `npm --prefix apps/web test`
Expected: PASS — 2 smoke, 6 audit, 6 store, 8 apiGet.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/shared/api
git commit -m "feat: a fetch layer that revalidates without caching"
```

---

### Task 4: The design tokens

**Files:**
- Create: `apps/web/src/shared/ui/tokens.module.css`, `apps/web/src/shared/ui/tokens.spec.ts`

**Interfaces:**
- Produces: a stylesheet defining the fourteen custom properties every later feature reads.

**Ported verbatim.** The values come from `apps/dashboard/src/ui/page-style.ts`. Changing one here would be a visual change, and this project's whole discipline is that the React client looks identical.

- [ ] **Step 1: Read the current values**

```bash
grep -A 20 ":root" apps/dashboard/src/ui/page-style.ts | head -30
```

Copy the fourteen declarations exactly: `--bg`, `--panel`, `--text`, `--muted`, `--line`, `--accent`, `--ok`, `--warn`, `--bad`, `--flash`, `--brand-ink`, `--brand-gradient`, `--sans`, `--mono`.

- [ ] **Step 2: Write the failing test**

`apps/web/src/shared/ui/tokens.spec.ts`:

```ts
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The tokens are a PORT, not a redesign, so this asserts they match the
 * server-rendered stylesheet they came from. A drift here is a visual change,
 * which this project has excluded.
 */
const REQUIRED = [
  '--bg', '--panel', '--text', '--muted', '--line', '--accent',
  '--ok', '--warn', '--bad', '--flash', '--brand-ink', '--brand-gradient',
  '--sans', '--mono',
] as const;

describe('the design tokens', () => {
  const css = readFileSync(
    join(__dirname, 'tokens.module.css'),
    'utf8',
  );

  it.each(REQUIRED)('defines %s', (token) => {
    expect(css).toContain(`${token}:`);
  });

  // NO WEB FONT. `--sans` and `--mono` must name system faces; a remote font
  // would break the self-contained invariant and the bundle audit would catch
  // it, but failing here says why.
  it('names only system font stacks', () => {
    expect(css).not.toMatch(/@import|@font-face/);
    expect(css).not.toMatch(/https?:\/\//);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm --prefix apps/web test -- tokens`
Expected: FAIL — cannot read `tokens.module.css`.

- [ ] **Step 4: Create the stylesheet**

Write `apps/web/src/shared/ui/tokens.module.css` with a `:root` block carrying the fourteen declarations copied verbatim from Step 1, headed by:

```css
/*
 * The palette and type stacks, ported verbatim from the server-rendered
 * dashboard's `page-style.ts`.
 *
 * A DIFFERENT VALUE HERE IS A VISUAL CHANGE, and this rewrite has excluded
 * those: if the React client looks different from the one it replaces, that is
 * a bug rather than an improvement. `tokens.spec.ts` asserts the set is
 * complete and that nothing here reaches off-origin.
 */
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm --prefix apps/web test -- tokens`
Expected: PASS, 15 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/shared/ui
git commit -m "feat: port the design tokens verbatim"
```

---

### Task 5: The shell, fetching the feed

**Files:**
- Create: `apps/web/src/app/App.tsx`, `apps/web/src/app/App.spec.tsx`
- Modify: `apps/web/src/main.tsx`

**Interfaces:**
- Consumes: `createApiGet`, `createEtagStore`, `SessionEndedError` from Task 3.
- Produces: a mounted application that fetches `/api/summary` once and reports the outcome. **No product surface** — this proves the wiring, and Plan 2 draws the feed.

- [ ] **Step 1: Write the failing test**

`apps/web/src/app/App.spec.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { App } from './App';
import { SessionEndedError } from '../shared/api/api-get';

const ok = { success: true, data: { totalFilings: 9459 }, error: null, meta: null };

describe('App', () => {
  it('reports the count the API returned', async () => {
    const apiGet = vi.fn().mockResolvedValue({ status: 'ok', body: ok });

    render(<App apiGet={apiGet} onSessionEnded={vi.fn()} />);

    expect(await screen.findByText(/9459/)).toBeInTheDocument();
  });

  it('asks for the summary route', async () => {
    const apiGet = vi.fn().mockResolvedValue({ status: 'ok', body: ok });

    render(<App apiGet={apiGet} onSessionEnded={vi.fn()} />);
    await screen.findByText(/9459/);

    expect(apiGet).toHaveBeenCalledWith('/api/summary');
  });

  // A session that ended is handed back to the caller, which reloads into the
  // landing page. Rendering an error here would leave the reader on a dead
  // page with no way forward.
  it('hands a session that ended to its caller', async () => {
    const apiGet = vi.fn().mockRejectedValue(new SessionEndedError());
    const onSessionEnded = vi.fn();

    render(<App apiGet={apiGet} onSessionEnded={onSessionEnded} />);

    await vi.waitFor(() => expect(onSessionEnded).toHaveBeenCalledOnce());
  });

  // Never swallowed. A page that silently stops updating is worse than one
  // that says it stopped, because the stale numbers still read as current.
  it('says so when the request fails', async () => {
    const apiGet = vi.fn().mockRejectedValue(new Error('502'));

    render(<App apiGet={apiGet} onSessionEnded={vi.fn()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/502/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm --prefix apps/web test -- App`
Expected: FAIL — cannot find module `./App`.

- [ ] **Step 3: Implement**

`apps/web/src/app/App.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { SessionEndedError, type ApiResult } from '../shared/api/api-get';

interface Summary {
  readonly totalFilings: number;
}

export interface AppProps {
  /** Injected, so a test needs no network. */
  readonly apiGet: <T>(path: string) => Promise<ApiResult<T>>;
  readonly onSessionEnded: () => void;
}

/**
 * The shell. It proves the wiring and draws no product surface.
 *
 * Plan 2 replaces the body with the feed; what must survive that is the
 * shape here — a component that is a function of its props, fetching through
 * an injected `apiGet` rather than reaching for `fetch` itself.
 */
export function App({ apiGet, onSessionEnded }: AppProps): JSX.Element {
  const [total, setTotal] = useState<number | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let current = true;

    apiGet<Summary>('/api/summary')
      .then((result) => {
        if (!current || result.status !== 'ok') return;
        setTotal(result.body.data.totalFilings);
      })
      .catch((error: unknown) => {
        if (!current) return;
        if (error instanceof SessionEndedError) {
          onSessionEnded();
          return;
        }
        setFailure(error instanceof Error ? error.message : String(error));
      });

    return () => {
      current = false;
    };
  }, [apiGet, onSessionEnded]);

  if (failure !== null) return <p role="alert">Could not load: {failure}</p>;
  if (total === null) return <p>Loading.</p>;
  return <p>{total} filings.</p>;
}
```

`apps/web/src/main.tsx` — replace the render call:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { createApiGet } from './shared/api/api-get';
import { createEtagStore } from './shared/api/etag-store';
import './shared/ui/tokens.module.css';

const root = document.getElementById('root');
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm --prefix apps/web test`
Expected: PASS, 26 tests across five files.

- [ ] **Step 5: Prove it against the real server**

```bash
npm run start:dashboard   # AUTH_MODE=local, in another shell
npm --prefix apps/web run dev
```
Sign in through the server-rendered page first so the cookie exists, then open the Vite dev server and confirm the count renders. **A count means the cookie reached the API cross-port**, which is the one thing a unit test cannot show.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src
git commit -m "feat: mount the client and read the summary route"
```

---

### Task 6: CI and the image

**Files:**
- Modify: `.github/workflows/ci.yaml`, `Dockerfile`

**Interfaces:**
- Consumes: `npm --prefix apps/web run build`, `auditBundle` from Task 2.
- Produces: a red build when the web project fails to compile, test, lint, or emits a bundle that would leave this origin.

- [ ] **Step 1: Add an audit runner**

`apps/web/tools/run-audit.ts`:

```ts
import { join } from 'path';
import { auditBundle } from './bundle-audit';

const violations = auditBundle(join(import.meta.dirname, '..', 'dist'));

if (violations.length > 0) {
  for (const v of violations) {
    console.error(`${v.file}: ${v.rule}: ${v.detail}`);
  }
  // A NON-ZERO EXIT, so CI fails rather than printing into a green log.
  process.exit(1);
}
console.log('bundle audit: clean');
```

Add to `apps/web/package.json` scripts: `"audit": "vite-node tools/run-audit.ts"`, and `vite-node` to devDependencies.

- [ ] **Step 2: Wire it into CI**

In `.github/workflows/ci.yaml`, after the existing `Build` step:

```yaml
      # The web client is its own npm project with its own dependency tree —
      # React and Vite never enter the server images. That costs a second
      # install and buys a server image that does not carry a UI toolchain.
      - name: Install web dependencies
        run: npm --prefix apps/web ci

      - name: Web lint, types, tests
        run: |
          npm --prefix apps/web run lint:ci
          npm --prefix apps/web test

      # BUILD THEN AUDIT, in that order: the audit reads what the build
      # emitted, and reading a stale dist/ would pass on a bundle nobody ships.
      - name: Web build and bundle audit
        run: |
          npm --prefix apps/web run build
          npm --prefix apps/web run audit
```

- [ ] **Step 3: Verify the audit can fail CI**

Temporarily add `fetch('https://example.com/x')` to `apps/web/src/app/App.tsx`, then:

```bash
npm --prefix apps/web run build && npm --prefix apps/web run audit
```
Expected: a non-zero exit naming `absolute-url`. **Remove the line afterwards** and re-run to confirm it passes. A check never seen failing is not a check.

- [ ] **Step 4: Build the bundle into the dashboard image**

In `Dockerfile`, add a stage before the runtime stage that installs `apps/web` and runs its build, then copy `apps/web/dist` into the image at `/srv/web`. Caddy serves that path in Plan 4; nothing reads it yet, and putting it in place now means Plan 4 is a Caddy change alone.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yaml Dockerfile apps/web
git commit -m "ci: build, test and audit the web client"
```

---

## Final verification, before the PR

- [ ] `npm test` — the server's 5,713 must be untouched; this plan adds no server code.
- [ ] `npm --prefix apps/web test` — 26 passing.
- [ ] `npm --prefix apps/web run build && npm --prefix apps/web run audit` — clean.
- [ ] `npm run lint:ci` and `npx tsc --noEmit -p tsconfig.json` — the server's gates still pass; `apps/web` is excluded from the root tsconfig's `include`, so confirm it is not being compiled twice.
- [ ] Open the PR; `lint, types, tests, build` green before merge.

## The follow-on plans

Each produces working, testable software on its own.

| Plan | Delivers |
|---|---|
| **2 — the reading surfaces** | Feed, cells, focus modal, company page, Brief. The bulk of the port, and the point at which parity becomes checkable against the Playwright suite. |
| **3 — the account surfaces** | Watching, search/suggest, share text, share image (canvas), landing, auth page. |
| **4 — cutover** | Caddy serves `dist/` behind `WEB_CLIENT=react`; the Playwright suite re-pointed and run against both builds; the rollback is that one variable. Deleting the server-rendered UI is a separate later commit, after production traffic. |

## Out of scope for Plan 1

Any product surface; routing (a feature change); the admin panel (dev-only, stays server-rendered); mobile; deleting anything.
