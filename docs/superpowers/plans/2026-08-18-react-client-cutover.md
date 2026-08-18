# React Client — Plan 4: The Cutover

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** a signed-in reader is served the React bundle when `WEB_CLIENT=react`,
and the server-rendered page otherwise. The switch is one environment variable,
the rollback is the same variable, and neither is a code change or an image
build. Nothing a signed-out visitor sees changes in either mode.

**Spec:** `docs/superpowers/specs/2026-08-14-react-client-design.md`.
**Builds on:** Plans 1–3 (merged): the bundle exists, is audited, and renders
every signed-in surface at parity; PRs #19–#20 fixed everything the device
sweep and the independent review confirmed.

## One correction to the spec's Decision 5, and it closes a reload loop

The spec sketched the Caddy sidecar serving `dist/` when `WEB_CLIENT=react`.
That detail is superseded — **the server serves the bundle, and Caddy is not
touched** — for three reasons, the first of which is a correctness hole:

- **Caddy can see cookie presence, not session validity.** A reader holding a
  dead cookie who opens `/` would be handed the React app; its first poll
  answers signed-out, the app reloads, the dead cookie is still there, and the
  loop never ends — in production, where the reload breaker deliberately does
  not run (it is dev-only; two signed-out answers there end in a sentence, not
  a loop). Only the process that resolves sessions can branch correctly, and
  it already does: `GET /` in `dashboard.controller.ts` is the front door, and
  Plan 3 recorded that the cutover "leaves the front door's branch where it
  is".
- **The front door's invariant lives in one file.** "`GET /` serves the
  landing page to a signed-out browser and reads nothing" is enumerated in
  `dashboard.controller.ts`. Splitting the branch across the app and a
  sidecar's config file recreates the exact drift that cost a production
  outage once already (the CSP lived in `Caddyfile`, the specs could not see
  it, and the first production sign-in failed).
- **The rollback property is identical either way.** The dist ships inside the
  dashboard image at `/srv/web` since Plan 1, so `WEB_CLIENT` read by Nest is
  exactly as much "one env var, no image build" as `WEB_CLIENT` read by Caddy.

What Decision 5 actually commits to — both UIs coexist, one variable switches,
the old UI is deleted in a separate later commit after production traffic —
holds unchanged.

## Shape

- **`WEB_CLIENT`** — `server` (the default, and what an unset variable means)
  or `react`. Any other value stops the process at boot with a sentence; a
  typo must not silently serve the wrong client.
- **`WEB_DIST_DIR`** — where the bundle lives. Defaults to `apps/web/dist`
  (the laptop layout); the Dockerfile sets `/srv/web` (where the image already
  copies it), so deployments configure nothing.
- **The bundle is read once at boot, into memory.** `index.html` plus the two
  hashed assets total ~240 KB — memory is cheaper than runtime filesystem
  reads, and serving only from a boot-time map makes path traversal a
  non-question. In react mode a missing or unreadable bundle **stops the
  process at boot** (an operator flips the flag and the failure is in the
  startup log, not the first reader's browser). In server mode the disk is
  never touched.
- **`GET /` signed-in** returns the bundle's `index.html` when react,
  `renderDashboardPage` otherwise. The signed-out branch is byte-identical in
  both modes, and `GET /auth` does not change at all.
- **`GET /assets/:file`** — session-guarded like `brand/logo.png`, answering
  only names present in the boot-time map (404 otherwise), content type from
  the extension. `Cache-Control: private, max-age=31536000, immutable`: the
  name carries the content hash, a new deploy is a new name, and `private`
  keeps shared caches out — the same argument as the logo's header, stronger
  because the name is immutable.
- **CSP holds without edits.** The bundle's one stylesheet link and one script
  are same-origin, covered by `'self'` in both Caddyfiles. The React document
  still requests no foreign origin — the bundle audit's rule from Plan 1.

## Tasks

- [x] **Config.** `readWebClient(env)` and `readWebDistDir(env)` in
  `configuration.ts`; `webClient` + `webDistDir` on `DashboardConfig`;
  `describeDashboardConfig` prints `web=server|react` so the startup line
  answers "which client is this host serving". Tests: default, both values,
  garbage throws with the sentence.
- [x] **Bundle loader.** `ui/web-bundle.ts`: `loadWebBundle(distDir)` returns
  `{ indexHtml, assets }` read eagerly, throwing a sentence naming the
  directory when react mode cannot be served; a `WEB_BUNDLE` provider in
  `dashboard.module.ts` that resolves to `null` in server mode (never touching
  disk) and to the loaded bundle in react mode. Tests against a temp dir:
  loads, lists only real files, throws on absence.
- [x] **Front door + assets route.** The react branch in `getPage`; the
  guarded `/assets/:file` route serving from the map. Tests: signed-in react
  mode gets the dist document; signed-out gets the landing byte-identically in
  both modes; assets 401 signed-out, 404 unknown name, correct types and the
  immutable header signed-in.
- [x] **Dockerfile.** `ENV WEB_DIST_DIR=/srv/web` on the dashboard target —
  the copy already exists; this names it for the config.
- [x] **Manifests + docs.** `WEB_CLIENT` documented as the optional cutover
  variable in `docker-compose.deploy.yml`, `k8s/30-dashboard.yaml` and
  `docs/deploy-kubernetes.md` — what it does, what rollback is. No live
  identifiers, per the hygiene rule.
- [x] **The parity run, and it is the load-bearing task.** The full Playwright
  suite against `AUTH_MODE=local` twice: once with `WEB_CLIENT` unset, once
  `=react`, same assertions. Record both counts here when the runs have
  actually happened — a number written before the run poisons the record. A
  divergence is either a React bug (fix it) or a spec of server markup rather
  than behaviour (re-point it at `data-ui`/`data-seq` and say so in the
  commit).
  - Measured 2026-08-18 (PR #23), full suite, `AUTH_MODE=local`, same data:
    server mode **125 passed / 1 skipped / 0 failed**; react mode **118
    passed / 8 skipped / 0 failed**, run twice. The skip delta is five
    admin-surface tests (the panel stays server-rendered; they skip with a
    printed reason) plus two data-honest precondition skips that float with
    the live collection. The run caught three real parity gaps, each fixed
    test-first before the counts above: the `#company-feed`/`#watch-feed`
    ids were missing, the Watching section (and `#watch-count`) was not
    mounted from sign-in, and the brief card's Copy control had never been
    ported. Two specs were re-pointed at behaviour rather than server
    markup (focus-close may unmount; admin specs skip against the React
    document), with the reasons written into the specs.

## Out of scope, restated from the spec

- Deleting the server-rendered UI — a separate, later commit, once the React
  client has served production traffic.
- Deep links, the admin panel (stays server-rendered), mobile, any visual
  change.
- Flipping `WEB_CLIENT=react` on the production host — deploying stays a
  separate manual act; this plan makes the flip possible, not performed.
