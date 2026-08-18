// `defineConfig` comes from `vitest/config` RATHER THAN FROM `vite`, and the
// difference is not cosmetic. Vite's own `UserConfig` has no `test` key, so
// with the plain import the block below is an excess-property error and
// `npm run build` — which runs `tsc --noEmit` first — fails before Vite is
// reached. `vitest/config` re-exports Vite's `defineConfig` with the test
// options merged into the type, which is the only way to keep one config file
// for both without loosening the compiler.
import { defineConfig } from 'vitest/config';
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
  server: {
    // DEV ONLY — the production bundle is served from the dashboard's own
    // origin by Caddy (Plan 4), so `apiGet` asks for a relative `/api/...`.
    // In dev the bundle lives on Vite's port instead, and this proxy stands in
    // for Caddy, forwarding to the dashboard's default port. Cookies are
    // per-host rather than per-port, so the session cookie set by the
    // server-rendered sign-in rides along.
    proxy: {
      '/api': 'http://127.0.0.1:7717',
      // The share card's raster mark — same-origin in production, and
      // without this dev always falls back to the favicon branch.
      '/brand': 'http://127.0.0.1:7717',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
});
