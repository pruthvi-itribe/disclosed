# Disclosed — project instructions

An NSE/BSE corporate-filings pipeline. Every published claim is matched
character-for-character against a verbatim span of the source document; a claim
that cannot be checked is a claim that does not ship.

## Karpathy guidelines (how code gets written here)

These override any habit of writing more, sooner, or cleverer.

1. **Think before coding.** State the problem, the assumption, and the smallest
   change that solves it — in the commit message or a comment — before writing
   the change. If two readings of a request differ materially, say so and pick
   one explicitly.
2. **Simplicity first.** The minimum code that solves the actual problem. No
   speculative generality, no abstraction with one caller, no configuration for
   a case that has never occurred. A parameterised helper that saves eleven
   lines is worse than the eleven lines.
3. **Surgical changes.** Touch only what the task needs. Match the surrounding
   style. A diff that "also tidied" three unrelated things is three unreviewed
   changes hiding in a reviewed one.
4. **No unrequested features.** Scope is the deliverable. Ideas discovered
   mid-task become task-list entries, not code.
5. **Prove it works.** Run the tests, run the browser, read the output. "Should
   work" is not a state of the world. A number in a comment or commit message
   must come from a measurement that actually ran — this repo's comments cite
   measured distributions, and a guessed number poisons that record.
6. **Measure before deciding.** Thresholds, floors and bounds are placed by
   sweeping real data, and the sweep is written into the comment beside the
   constant so the next editor re-measures instead of re-guessing.
7. **Fail loudly.** No silent fallbacks, no swallowed errors, no defaults that
   hide an absence. "Nothing was found" and "nothing was looked for" are
   different facts and must not render the same.
8. **Boring and explicit beats clever.** Prefer the obvious loop over the smart
   one-liner. Delete dead code rather than commenting it out.
9. **Small units.** Functions under ~50 code lines, files under 800 total.
   When a function is a pipeline of stages, name the stages.
10. **When stuck, surface it.** Say what was tried and what is unknown rather
    than papering over with a plausible-looking guess.

## Non-negotiable invariants

- **The verbatim gate.** Nothing reaches a reader that was not string-matched
  against the source document. No derived arithmetic (no computed margins or
  growth rates the filing did not print).
- **Attribution before publication.** A span being *in* a document does not
  make it *about* the filer — see `shared-page.ts`. Multi-company documents are
  refused, not guessed at.
- **IST is server-owned.** UTC+05:30, day rolls at 18:30 UTC. The browser never
  formats a timestamp.
- **Exchange text is untrusted.** No `innerHTML`, ever; DOM via
  `createElement`/`textContent`; links only through `safeHref`.
- **No access without sign-in.** Every page and every `/api/*` read is behind
  the session guard. The four exceptions are `GET /` (which serves the landing
  page to a signed-out browser and reads nothing), `GET /auth`, `GET
  /api/health` and `GET /api/me` — enumerated in `dashboard.controller.ts` so an
  addition has to argue with the list.
- **The dashboard is self-contained.** No CDN, no external request, no web
  font. Inline everything. Same-origin is not external: the share card loads
  `GET /brand/logo.png` (session-guarded, served from our own process) —
  `page.spec.ts` asserts no absolute URL rather than no request at all. The one
  absolute URL the document carries is the **XML namespace**
  (`createElementNS`, for the card's icons): a name rather than an address,
  which no browser fetches. `page.spec.ts` bounds it — one occurrence, as that
  call's argument — and everything else must still be absent.
  - **The one relaxation is the two signed-out surfaces — the landing page and
    `/auth` — in firebase mode only.** Both load the Firebase Web SDK from
    `gstatic.com` at one pinned version (`ui/firebase-sdk.ts`): the landing
    page's sign-in buttons open Google's popup where the visitor already is,
    and `/auth` does the same behind a deep link and a blocked-popup fallback.
    The app is unchanged — `page.spec.ts` asserts the signed-in document
    contains no `https?://` but the XML namespace above — and
    `landing.spec.ts` and `auth-page.spec.ts` each assert the set of external
    origins **in the document** is exactly `[gstatic]` in firebase mode and
    exactly `[]` in the other two.
    - **The document is not the whole story, and saying it was cost a
      production outage.** Once running, the SDK fetches
      `apis.google.com/js/api.js` for the popup's iframe transport and frames
      `<project>.firebaseapp.com/__/auth/iframe`. Neither appears in the HTML,
      so the specs above stayed green while the **CSP** — which lives in
      `Caddyfile`, not the app — blocked both, and the first production
      sign-in failed saying only "That sign-in did not work". The policy now
      names four Google origins and each is listed there with the thing it
      unblocks. So: what a spec asserts about the *document* bounds what we
      wrote; it does not bound what a third-party script fetches at runtime. The argument is in `ui/auth-page.ts`'s header and holds for both pages
    for the same reason: neither renders a filing, calls a read route or has
    database access, and the alternative is hand-writing Google's OAuth dance.
    A font, a stylesheet, an image or an analytics tag on either is still
    refused; the Google mark is CSS.
- **Fail open on categories.** Never key a fail-closed gate on a category name
  NSE controls (`claim-eligibility.ts` records why).

## Sharp edges (each has shipped a real breakage)

- `apps/dashboard/src/ui/script/*.ts`, `auth-script.ts`, `landing-script.ts`,
  `page-style*.ts` and `landing-style.ts` are **TypeScript template literals**: a backtick or `${` inside the string body — including in
  a comment — is consumed by the compiler and breaks the page while serving
  200. `script-fragments.spec.ts` guards this; keep fragments free of both.
- Client-script regexes need **doubled backslashes** (`\\d`), because the
  template literal eats single ones. The served page is what must be asserted,
  not the source.
- Python edit scripts must **assert the anchor exists before writing**; a
  replace that matched nothing "succeeds" silently.
- Playwright locators re-resolve on the repaint every 4s: pin cards by
  `data-seq`, never by position.
- Mongo array fields: `$elemMatch` for existence, never `$ne: null` (matches
  empty arrays).

## Commands

- `npm test` — Jest, no network, ~10s. `npx tsc --noEmit -p tsconfig.json`,
  `npm run lint`.
- `npm run test:e2e` / `npx playwright test` — needs the dashboard running;
  `DASHBOARD_URL` overrides the default `http://127.0.0.1:7717`. **It requires
  `AUTH_MODE=local`**, which is what an environment with no `FIREBASE_*` keys
  resolves to: global setup registers one throwaway account through the real
  register route and deletes it afterwards. There is deliberately no test bypass
  in the server — see `e2e/session.ts`.
- `npm run start:dashboard` (port from `DASHBOARD_PORT`, default 7717).
- Component names for the UI: `docs/ui-components.md`.

## Conventions

- Comments explain **why**, cite measurements, and are kept truthful when the
  measurement changes — a stale number is corrected, not deleted.
- One logical change per commit; the commit message carries the evidence.
- Tools in `tools/` are measurement/backfill scripts: no model calls unless
  stated, report-then-skip rather than silently fetching.

- The one `<link>` element allowed on any page is the favicon, an inlined `data:` SVG — a second link (stylesheet, font) must fail the specs.
