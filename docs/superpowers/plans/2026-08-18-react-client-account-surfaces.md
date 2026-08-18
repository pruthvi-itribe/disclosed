# React Client — Plan 3: The Account Surfaces

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** `api/me`, the watch star and the Watching view, search/suggest, and
share text + image, in the React client at parity. After this plan the client
renders every surface a signed-in reader can reach, and Plan 4 is the cutover
alone.

**Spec:** `docs/superpowers/specs/2026-08-14-react-client-design.md`.
**Builds on:** Plans 1–2 (merged): scaffold, audit, fetch layer, tokens, and
the reading surfaces.

## Two corrections to the spec's surface table, found by survey

**1. There is no in-document auth panel to port.** The spec's map of
`script-account.ts` predates its own removal: `page.ts` carries a comment
block where the panel used to be, and the gate is the reason — a signed-out
browser never receives the dashboard document, so an in-document sign-in
modal was unreachable code. The sign-in surface is the separate `/auth`
document. Porting a modal would recreate exactly the second-sign-in-form
drift the removal comment documents.

**2. The landing page and `/auth` stay server-rendered, permanently — like
admin.** The spec's table says they port; the survey says porting them buys
nothing and costs three real things:

- **They are not part of the problem being solved.** The rewrite exists
  because 11,900 lines of template-literal UI rebuild a live dashboard every
  four seconds. The landing page performs **no read** (its spec asserts a
  signed-out visitor triggers zero API calls; its cards are invented
  samples), and `/auth` is a form. Neither polls, neither renders a filing,
  neither shares a component with the app.
- **Their correctness properties die in a static bundle.** `AUTH_MODE` is a
  per-host runtime decision; a Vite build bakes it in at build time (one
  artifact per host — refused) or injects config into "static" HTML
  server-side (no longer static). `landing.spec.ts`'s strongest assertions —
  local mode contains **no script element at all**, the firebase document
  minus its two script elements is **byte-identical** to the local one,
  external origins are exactly `[gstatic]` or `[]` — are properties of a
  server-side branch, and a React port destroys them for zero reader benefit.
- **The front door is a server decision.** `GET /` answers the landing to a
  signed-out browser and the dashboard to a signed-in one via a Mongo-backed
  session resolve; `GET /auth` 302s a signed-in visitor to `/`. A static
  file cannot make either decision, and a client-side `api/me`-then-redirect
  boot is precisely the signed-out first-paint-that-calls-an-API the gate
  exists to prevent.

So the two signed-out documents remain Nest-rendered, exactly as they are,
after the dashboard UI is deleted — recorded here so nobody reads it as an
oversight. Plan 4's cutover serves the React bundle to **signed-in**
readers and leaves the front door's branch where it is. The bundle audit
therefore keeps its **zero-external-origins** rule for the app document —
the firebase/gstatic allowance the spec sketched for "landing and auth
entry points" is never needed, which is a stronger invariant, not a
weaker one.

## Source of truth

| Fragment / module | What it owns |
|---|---|
| `apps/dashboard/src/ui/script/script-account.ts` | me, watch star, Watching, sign out |
| `apps/dashboard/src/ui/script/script-suggest.ts` | the type-ahead |
| `apps/dashboard/src/ui/script/script-share.ts` (+ its spec) | share text; the spec is the reference |
| `apps/dashboard/src/ui/script/script-share-image.ts` | the canvas card |
| `apps/dashboard/src/auth/auth.controller.ts`, `watchlist.controller.ts` | the API contract |
| `apps/dashboard/src/ui/page.ts` | the Watching/account/search markup |

## Global constraints (Plans 1–2's, plus this plan's own)

- **The server's sentence is the reader's sentence.** `WATCHLIST_FULL`,
  `UNKNOWN_SYMBOL`, `INVALID_CREDENTIALS` — the message in the error
  envelope is shown as-is; callers branch on `code`, never on prose.
- **Bodyless mutations still send `Content-Type: application/json`.** The
  415 guard is a CSRF control (an HTML form cannot emit that type), not
  tidiness, and it applies to watch add, watch remove and sign out.
- **`credentials: 'same-origin'`** stated explicitly on every write.
- **`state.me` is three-state.** `undefined` = "we do not know yet" and the
  header renders neither signed state through it; `{signedIn:false}` is a
  latched reload, not a repaint.
- **The watch toggle is confirmed, not optimistic.** The only immediate
  feedback is `disabled`; `state.watched` always equals what the server last
  said, and every Watching poll overwrites it wholesale.
- **Share composition reads the filing, not the rendered card** — echoes
  included, spans never, nothing computed. The verbatim gate binds the
  share surfaces hardest of all.
- Files under 300 lines, functions under 50; mirror specs for every ported
  constant table; all four gates locally before every push.

**Baseline:** 5,713 server tests, 232 web tests, green at Plan 2's merge.

---

## File structure

| File | Responsibility | Task |
|---|---|---|
| `src/shared/api/api-send.ts` | postJson's port: writes + the ETag-free GET | 1 |
| `src/shared/api/use-me.ts` | api/me, three-state, the latched reload | 2 |
| `src/app/TopBar.tsx` (extend) | Sign out, the Watching tab + unread badge | 2 |
| `src/features/watch/watch-state.ts` | the watched set, derived from responses | 3 |
| `src/features/watch/WatchButton.tsx` | the star: aria-pressed, filled by CSS | 3 |
| `src/features/watch/use-toggle-watch.ts` | the confirmed toggle | 3 |
| `src/features/watching/WatchingView.tsx`, `Roster.tsx` | the view: roster + feed halves | 4 |
| `src/features/search/use-suggest.ts` | debounce + seq, the api/suggest read | 5 |
| `src/features/search/SearchBox.tsx`, `SearchNote.tsx` | the combobox, the note | 5 |
| `src/features/share/share-text.ts` | shareText, ported against the reference spec | 6 |
| `src/shared/ui/ReportingIconButton.tsx` | aria-live + iconsaid: the visible and audible report from one call | 6 |
| `src/features/share/share-plan.ts` | the pure canvas planner (blocks, wrap, figures) | 7 |
| `src/features/share/share-paint.ts`, `share-deliver.ts` | the painter and the clipboard/download delivery | 7 |
| `src/features/share/share-marks.ts` | the favicon + logo.png marks, module-scope singletons | 7 |

---

### Task 1: `apiSend` — the write path

**Files:** `src/shared/api/api-send.ts` + spec

postJson's port, a deliberate sibling of `apiGet` rather than a flag on it: a
failed read is "refresh failed", a failed write carries a sentence the reader
is waiting for.

- [x] Failing tests:
  - method + path + JSON body for auth writes; **query-string/path params
    and NO body** for watchlist writes (json parsing is mounted on
    `/api/auth` only — a password cannot travel in a query string, a ticker
    in an access log is public data).
  - `Content-Type: application/json` on EVERY non-GET **including bodyless**
    ones — making it conditional is what would 415 the live product.
  - `credentials: 'same-origin'`.
  - rejection carries `.status`, `.code`, `.meta` and the server's
    `.message`; unparseable body → `That did not work (STATUS).`.
  - the `'GET'` variant: no Content-Type, **no ETag store and no 304
    branch** — the Watching renderer must always receive a real body
    (routing it through `apiGet` would hand it a NOT_MODIFIED sentinel it
    has no branch for).
- [x] Implement. Commit: `feat: the write path, and the ETag-free read`

### Task 2: `api/me` and the header

**Files:** `src/shared/api/use-me.ts`, `TopBar.tsx` extension, `App.tsx` wiring + specs

- [x] Failing tests:
  - `me` is `undefined` until the answer lands; the Sign out button and the
    Watching tab render NOTHING through that state (the flicker the old
    `hidden` attributes prevent).
  - `GET /api/me` answers 200 signed-out (`{signedIn:false}`) — never 401;
    signed-out → `onSessionEnded` once, latched in a ref (concurrent polls
    must not loop the reload).
  - signed in → Sign out visible (`#signout`, `.tab`, a SIBLING of
    `nav.tabs` — a non-tab child of a tablist is an ARIA violation);
    Watching tab visible with the unread badge as a CHILD
    (`#tab-watching-count`, absent at zero — never a `0` — capped `99+`).
  - Sign out: `POST /api/auth/logout` (bodyless) → latched reload; failure →
    the alert with the server's sentence, then a fresh `api/me`.
  - me errors are shown (`Could not read your account: ...`), never
    swallowed.
- [x] The view switch gains `watching`; no tab lit on company still holds.
- [x] Commit: `feat: api/me, the header controls and the unread badge`

### Task 3: The watch star

**Files:** `watch-state.ts`, `WatchButton.tsx`, `use-toggle-watch.ts` + specs; foot wiring in `FeedCard`/`FocusDialog`/`CompanyView`

- [x] Failing tests:
  - the star is `button.iconbtn.watch[data-ui="watch"][data-symbol]` with
    `aria-pressed`, label `Watch SYM` / `Stop watching SYM` feeding
    aria-label AND title from one string; `.on` when watched — the fill is
    the stylesheet's (`.watch.on svg { fill: currentColor }`), already in
    the ported page.css.
  - **absent when signed out**, on every surface — a permanently disabled
    control reads as a broken page.
  - the toggle: disable → `POST /api/watchlist?symbol=` or
    `DELETE /api/watchlist/:symbol` (encoded, bodyless) → on success update
    the set from the response meta and re-enable; on failure show the
    server's sentence (`WATCHLIST_FULL` carries `{used, cap}` in meta) and
    re-enable. NOT optimistic — the set always equals what the server last
    said.
  - a toggle from a roster row while Watching is open triggers an immediate
    poll refresh — the poll owns that list, and the unwatched row must not
    sit there for four seconds.
  - `stopPropagation` — a star click must not open the card behind it.
  - the watched set is a `Set<string>` keyed by symbol (one company files
    repeatedly; the star belongs to the company), rebuilt wholesale from
    every Watching response.
- [x] Wire into the three foots (card, focus, company head) in the order the
  old page draws: star, then the share controls (Task 6), then source.
- [x] Commit: `feat: the watch star, confirmed not optimistic`

### Task 4: The Watching view

**Files:** `WatchingView.tsx`, `Roster.tsx` + specs; poll extension

- [x] Failing tests:
  - while the Watching tab is open the poll asks
    `GET /api/watchlist/feed?limit=N&offset=0` through the ETag-free path —
    **one authenticated read per poll, both halves from one response** so
    the roster and the page beside it cannot disagree.
  - the roster: one `watching-row` per watched company keyed by symbol,
    ticker button → company page, name (truncates), `last filed
    relativeTime` with the IST string in the title — or **`nothing yet in
    our window`** with no title (never a date, deliberately not "never
    filed"); the star.
  - `watch-count` = `N of 50 companies watched`; the roster is unpaged and
    ordered by when it was added (the server's order — never by activity,
    or the list reshuffles under the cursor).
  - the narrowing note, exact copy: hasMore → `The newest R of T filings
    from these companies. The list above is complete; this one is not.`;
    else `All T filings from these companies.`; hidden when the feed is
    empty because the empties speak.
  - **the two empties are two different sentences** (exact copy from the
    survey), and both hide the roster chrome the old page hides.
  - the feed half is the shared `FeedGrid` without chrome.
  - opening the view clears the unread badge (looking at the tab IS reading
    it — the server stamps `lastSeenWatchlistAt` on the way out); the two
    empties return early and deliberately do not.
- [x] Commit: `feat: the Watching view — the watchlist first, then what it said`

### Task 5: Search and suggest

**Files:** `use-suggest.ts`, `SearchBox.tsx`, `SearchNote.tsx` + specs; filter-state gains `category` + `picked`

- [x] Failing tests for the hook: 140ms debounce ("britannia" is ONE request,
  not nine), 2-char minimum (one character matches 87 of 954 companies), a
  sequence counter dropping out-of-order responses (the debounce and the
  staleness guard are two separate things — ArrowDown-to-reopen bypasses
  the timer while a debounced request may still be in flight), the
  deliberately silent catch (the one fetch that never raises the banner).
- [x] Failing tests for the combobox:
  - the input keeps DOM focus throughout; `aria-activedescendant` names the
    highlighted option's stable id (`suggest-opt-N`); `-1` means "nothing
    highlighted, Enter searches the typed text" — a real third state.
  - options flattened companies → categories → groups with presentational
    headings; head/name/count cells; empty answer closes the list, never a
    "no matches" row (the box also searches free text).
  - keyboard: ArrowDown opens-or-moves (wrapping), ArrowUp moves, Escape
    closes only while open, Enter applies the highlight or submits, Tab
    closes without preventDefault.
  - **the mousedown/blur dance**: blur closes the list; `onMouseDown` on the
    listbox calls `preventDefault()` so a click on a row lands before the
    input blurs — it must be mousedown, not click.
  - applying a suggestion writes the filter for its kind (company →
    `symbol`, category → `category`, group → `group`), sets `picked`,
    clears `q`, puts the head in the input; typing invalidates the pick
    (undo exactly what the pick did, not a blanket reset).
  - the search note's exact copy per kind, with its `clear` button.
  - `/` focuses the box unless focus is in an input/select/textarea.
- [x] `emptyHint`'s picked-company branch (deferred from Plan 2) comes alive.
- [x] Commit: `feat: search, and the type-ahead that never raises a banner`

### Task 6: Share text

**Files:** `share-text.ts`, `ReportingIconButton.tsx` + specs; foot wiring

- [x] Port `script-share.spec.ts`'s cases as the failing spec — it is the
  reference: the header lines (`*Company (SYM)*`, `Category · human IST`
  with the middle dot and `disseminatedAtIstHuman`, never the fixed-width
  string), the amount as its own unlabelled paragraph before the claims,
  every claim as `- text` (echoes included, spans never), the results line
  after, the tail `_AI-extracted. Every line verified against the company's
  filing._` + `Disclosed`, the exact blank-line counts, and the golden
  7-line one-claim message. Mirror `SHARE_BRAND`/`SHARE_TAIL` against the
  fragment.
- [x] `ReportingIconButton`: an IconButton that is an `aria-live="polite"`
  region and reports through one call — the drawing swaps
  (`ICON_DONE`/`ICON_FAIL`) and a clipped `.iconsaid` word lands in the
  same update, so the visible and audible reports cannot disagree. Copied →
  revert after 1500ms; `no clipboard` and `failed` draw the cross and
  deliberately never revert. Timers cleared on unmount (the feed repaints
  every four seconds; the old page leaked them harmlessly, React cannot).
- [x] The copy button computes its payload from the FILING at render, stops
  propagation, and mounts on card and focus foots only when the card has at
  least one line.
- [x] Commit: `feat: share as text — the filing, in a message`

### Task 7: Share as image

**Files:** `share-plan.ts`, `share-paint.ts`, `share-deliver.ts`, `share-marks.ts` + specs; `vite.config.ts` dev-proxy addition

The split the reference spec already implies: a **pure planner** (blocks,
wrapping, figure runs) tested in vitest against the spec's own stub
(`measureText: t => ({width: t.length * 14})`), and a thin painter + delivery
exercised against a recording fake context. jsdom has no canvas, and that is
the seam, not a hole.

- [x] Port the planner with every measured constant and its argument: 1080
  wide at a fixed 2× (no devicePixelRatio read), the claim cap of 8 (85.5%
  of 2,543 filings carry ≤8; the remainder is STATED — `+ N more in the
  app` — never swallowed), the literal palette (mirrored against
  `tokens.css`, where Plan 1 moved the values), the system font stacks, the
  figure-run regex (one font for every run — the line was measured in one
  font), the block order amount → claims → remainder → results.
- [x] Delivery: `ClipboardItem` receives an **unresolved blob promise** —
  Safari ends the user gesture at the first await, and an innocent
  `await toBlob` refactor breaks Safari silently (a comment, because no
  test can catch it). The four outcomes report through
  `ReportingIconButton`: `Image copied` / `Downloaded` (object-URL revoked
  after 10s) / `image failed` / `not ready`, reverting after 2000ms.
  Filename `disclosed-{symbol}.png` through the `[A-Za-z0-9._-]` whitelist.
- [x] Marks as module-scope singletons loaded once (never at click — the
  gesture window): the data: favicon from the document's own link (already
  byte-identical, favicon-mirror.spec.ts), and `/brand/logo.png` — added
  to the Vite dev proxy beside `/api`, session-guarded same-origin in
  production. Refuse only when BOTH are absent.
- [x] Commit: `feat: share as image — the filing, as a picture`

### Task 8: Gates and the live proof

- [x] All four gates locally (both lints, both tscs, both suites), build,
  audit — the audit's zero-external-origins rule now guards the app
  document containing no gstatic, which is the stronger form of the spec's
  intent.
- [x] Live proof against the real stack through the dev proxy: sign in on
  the served `/auth`, land in the React client; watch a company from a
  card, see it in Watching, unwatch from the roster and watch the row leave
  on the next poll; the badge; suggest with keyboard and mouse; copy a
  filing as text and as image; sign out and land on the served landing.
- [ ] PR; the four gates green; auto-merge.

---

## Port traps, restated as rules

1. `me` is three-state and the reload is latched in a ref — concurrent 401s
   are one reload, never a loop.
2. The watched set is derived state: every Watching response overwrites it
   wholesale, so nothing else may write it except a confirmed toggle.
3. Roster rows key by symbol or every poll churns the DOM and takes the
   reader's text selection with it.
4. The Watching read bypasses the ETag path by design.
5. Debounce and staleness are two guards, not one; `aria-activedescendant`
   moves, DOM focus does not.
6. Bodyless mutations carry the JSON Content-Type; params ride the path or
   query, never a body.
7. Share reads the filing, computes nothing, and the `ClipboardItem`
   promise stays unresolved for Safari.
8. Nothing in the app document may reference an external origin — the
   landing/auth pages keep the gstatic allowance because they stay
   server-rendered.

## The follow-on plan

| Plan | Delivers |
|---|---|
| **4 — cutover** | Caddy serves `dist/` to signed-in readers behind `WEB_CLIENT=react`; the front door's landing/auth branch stays at the server; Playwright re-pointed and run against both builds; the rollback is the variable. |

## Out of scope for Plan 3

The landing and `/auth` pages (server-rendered permanently — the decision
above); the admin surface; `logout-all` and password change (no dashboard
surface calls them today); routing; mobile; deleting anything.
