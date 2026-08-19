# The App: Shell and Push

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Disclosed on a phone as an installed app that (a) paints its shell
with **zero network requests** — the bundle ships inside the binary — and
(b) delivers a push notification for a watched company's verified filing
with no artificial delay on top of the pipeline's own two-second detection
floor. One codebase: the app is `apps/web`, wrapped, and the Playwright
parity suite keeps binding it.

**Builds on:** the React client (Plans 1–4, merged, PRs #12–#26): the
bundle exists, is audited, renders every signed-in surface at parity, and
is 202.27 KB of JS + 34.12 KB of CSS (measured, 2026-08-18 build).

**Priorities set 2026-08-18:** the app leads; Telegram is deprioritized
(the fan-out built here is channel-shaped, so Telegram later plugs into
the same trigger rather than needing its own).

## Why Capacitor and not React Native

- **One client.** The repo just deleted-by-supersession a second UI; the
  quality bar (2026-08-18) is no duplication. React Native is a full second
  client with its own parity burden. Capacitor wraps the audited bundle.
- **"Fastest load" is an asset-location problem, not a framework problem.**
  A shell served from inside the binary costs a WebView start plus a disk
  read; no network is on the path at all. That is the fastest a shell
  loads short of rewriting the product, and it is faster than a
  network-served PWA on first open.
- **The specs keep working.** The wrapped app is the same origin serving
  the same document, so `page.spec.ts`, the mirror specs and the browser
  suite continue to bound what ships.

## The two speed budgets, and what is measured vs. targeted

Numbers below marked *measured* exist today; everything else is a target
whose real value gets measured on-device and **written back into this doc
after the run — a number written before the run poisons the record.**

**Load.** Shell = WebView init + parse of 202 KB JS (*measured*) + first
render. Data = one authenticated round trip; the filings route answers in
9.3–12.6 ms server-side (*measured, five runs*), so network dominates.
The app paints its chrome and skeleton before any response arrives.

- **What this plan will NOT do for load:** cache authenticated responses
  on the device for an instant stale paint. `Cache-Control: no-store` is a
  contract — an authenticated response may never be stored or replayed
  (`etag-store.ts` records why) — and breaking it is a spec-level decision,
  not a performance tweak. If a future measurement shows the one round
  trip is the experience bottleneck, that decision gets its own argument.
- The SearchBox draft-state re-render (review finding #10, deferred
  2026-08-18) joins this plan: on a phone it is on the critical typing
  path.

**Notify.** Detection floor: the poller's two-second hot path — the alert
seam (`apps/ingest/src/alert/alert.service.ts`) already sits on the insert
path, and its stated constraint holds for us: **the send path must not put
a database read inside the poller's budget.** The per-user fan-out
therefore hangs off the insert event asynchronously. Delivery: FCM
(Android) and APNs (iOS) at high priority. **No batching delay:** the
first filing for a watched company sends immediately; later filings in a
burst update the same notification via a collapse key per company, so
speed and non-spam are both kept. End-to-end latency (`disseminatedAt` →
device receipt) gets measured after shipping and recorded here.

**The alert gate is already written:** verified is "the only tier allowed
near an alert" (`TIER_TITLE`). Push carries only server-composed sentences
— the same verified claim/outcome line the card shows. Exchange text never
reaches a notification body raw, and IST stays server-owned.

## Prerequisites (operator's manual acts, like the WEB_CLIENT flip)

- **Apple Developer Program membership** — APNs and TestFlight/App Store
  have no workaround. iOS tasks below block on it; Android does not.
- **FCM enabled on the existing Firebase project** (the one AUTH_MODE
  firebase already uses) — a console toggle plus a service-account key in
  the secret store, never in the repo.
- Play Console account, only when store distribution starts; a built APK
  sideloads without one.

## Phase A — the shell

- [ ] **A1. Scaffold `apps/mobile`:** Capacitor project whose web dir is
  `apps/web/dist`; iOS and Android platforms committed; no framework
  plugins beyond what a task below names. Verify: `npx cap sync` from a
  fresh clone succeeds after `npm run build` in `apps/web`.
- [ ] **A2. Point the client at the production origin** via a build-time
  base URL for `/api/*` (the bundle is same-origin today; the wrapped app
  is not). The Origin/CORS posture on the server must be argued, not
  loosened: the app's WebView origin is fixed and known. Verify: unit
  spec on the URL seam; a device build reads the live feed.
- [ ] **A3. Native sign-in:** Firebase's popup does not run in a WebView.
  Use the native Google Sign-In plugin, then exchange the Firebase ID
  token at the existing verification route for the same session cookie
  the browser gets. No new auth logic server-side — if the existing route
  cannot accept this exchange as-is, the gap is recorded here before any
  server change. Verify: sign in on a device, feed loads, sign out lands
  on the landing page.
- [ ] **A4. Measure cold start** on one real Android device and one real
  iPhone: tap → chrome painted, tap → first feed row. Write both numbers
  into this section. Only after measuring, decide whether any load work
  (code split, deferred features) is justified — not before.
- [ ] **A5. SearchBox draft-state refactor** (finding #10): keystrokes
  re-render the whole app; keep the draft local until submit/pick. Verify:
  existing suggest specs stay green; a render-count spec pins the fix.
- [ ] **A6. PWA manifest + icons for `apps/web`** — near-free here, gives
  desktop/Android install of the web client and the base for later Web
  Push. Verify: Lighthouse installability pass; `page.spec.ts` budget for
  the one allowed `<link>` is re-argued in the spec, not silently widened.

## Phase A7 — native feel (requirement raised 2026-08-18)

**The bar, in the user's words: it must not feel like a wrapper; it should
perform like a Flutter app.** That is achievable in this architecture, but
only by killing every webview TELL deliberately — each is small, and
together they are the whole difference between "app" and "site in a box":

- [ ] **A7.1. No white flash, no lingering splash:** the OS-painted frame
  and the splash both carry the theme's `--bg`, and the splash auto-hides
  the moment the WebView paints (`launchShowDuration: 0`) — a splash that
  lingers is delay dressed as branding. Verify: on-device, part of A4.
- [ ] **A7.2. Shell-feel CSS, scoped to the binary:** `main.tsx` marks
  `<html>` `native-shell` only when Capacitor reports a native platform, so
  the web document never changes. Under the mark: theme background on the
  overscroll bounce, safe-area insets on `<html>` (body's padding varies by
  breakpoint; a calc() per breakpoint would be a copy that drifts), and
  tap-highlight/long-press-callout/text-selection removed on CONTROLS only
  — the filing text stays selectable, because quoting the document is the
  product. Verify: web suite green and unchanged; the class absent from a
  browser render; the rest on-device in A4.
- [ ] **A7.3. The Brief's 100dvh cage on a notched device** is a known
  open question under `viewport-fit=cover` — measured on hardware in A4,
  not guessed.
- [ ] **A7.4. On-device feel pass (with A4):** scroll at 60fps on the
  grown feed (if it stutters, virtualize THEN, with the measurement in
  hand — not speculatively), keyboard behavior on the search box, status
  bar styled to the theme, view transitions judged against the native bar.
  What the pass finds becomes named tasks here; "it feels fine" is not a
  recordable result, so each check gets a yes/no against a device named in
  this doc.
- If the bar is still not met after A7.4 with the tells dead and 60fps
  held, the next conversation is native navigation chrome (bottom tabs,
  native transitions via plugin) — and only after that, a native client.
  Each step is cheaper than the rewrite it defers.

## Phase A8 — mobile chrome (direction set 2026-08-18, after first hands-on)

The user's words, from using the app: the top bar should be FIXED with
cards scrolling under it; the search bar need not always be there; filters
move into their own screen on mobile; the tabs move to a BOTTOM bar; and
profile/watchlist surfaces need real mobile treatment. All of it scoped to
the shell (`html.native-shell`), so the web document — and the parity
suite that binds it — is untouched.

- [x] **A8.1. Fixed slim header:** brand + live dot pinned over the
  island, content scrolling beneath a blurred backdrop.
- [x] **A8.2. Bottom tab bar:** Brief / Feed / Watching (unread badge) /
  Search / Profile, safe-area aware, thumb-height targets.
- [x] **A8.3. The Explore sheet:** search box, search note, topic chips
  and the verified-claims toggle move off the feed into a full-screen
  sheet opened from the bottom bar — the SAME FeedControls composition,
  relocated, so the filters keep their one implementation.
- [x] **A8.4. The Profile sheet:** who is signed in, the watch count, and
  sign out — the account surface the top bar's buttons were too small for.
- [ ] **A8.5. On-device pass:** Brief deck vs the fixed bars, keyboard vs
  the sheets, scroll-under behaviour — screenshots against a named device,
  findings become tasks here.

## Phase B — push

- [ ] **B1. Device registration:** the push plugin's token posted to a new
  session-guarded route and stored on the account's `channels`. Removal on
  sign-out. Verify: controller spec (guard on the route, shape of the
  stored channel), device shows up on `api/me`.
- [ ] **B2. The fan-out:** on filing insert, asynchronously resolve
  watchers of that symbol with an enabled device channel; send FCM/APNs
  high-priority with a per-company collapse key; verified tier only;
  per-filing-per-user dedupe; a sent-log collection (what, when, to whom,
  outcome — report-then-skip on channel errors, never silent). Verify:
  unit specs on the gate and dedupe; a staged filing reaches a real
  device.
- [ ] **B3. Tap-through:** notification opens the app on that company's
  page. Verify: on-device.
- [ ] **B4. Measure end-to-end latency** (`disseminatedAt` → device
  receipt) over at least one live market hour; write the distribution
  here. If the number disappoints, the investigation starts at the
  poller's floor, not at speculation.
- [ ] **B5. Docs tick:** boxes above ticked with the measured numbers, and
  the deploy doc gains the new manual acts (APNs key, FCM key rotation).

## Phase C — the notifications section (designed 2026-08-19)

Readers subscribe by TOPIC as well as by company, and every channel obeys
one server-side decision. The design, and why each piece is shaped so:

- **Topics, never NSE's categories.** The subscription vocabulary is the
  chip row's own closed list (CLAIM_TOPICS) — ours, verified, allowlisted.
  Keying alerts on exchange-controlled category names is the fail-open
  rule's oldest prohibition.
- **One predicate, every channel.** "What deserves this reader's
  attention" = VERIFIED filings from watched companies OR subscribed
  topics, computed by the server in one place (`/api/alerts/feed`,
  session-guarded, bounded) — so desktop alerts today and push in Phase B
  send identical decisions instead of two drifting rules. The response
  says WHICH rule matched, for the notification's own copy.
- **One preferences panel, two homes**: the app's Profile sheet and the
  web's Watching view render the same component — channel status rows
  (Desktop: enable/on/blocked · Mobile push: "arrives with the app
  release", an honest placeholder, never a dead toggle), then "Alert me
  about": watched companies stated as the always-on fact with its count,
  and the topic checklist. The product's promise printed where it
  matters: only claims verified against the source document are ever
  sent.

- [ ] **C1. The model:** `alertTopics` on the account (allowlisted,
  bounded), read on `api/me`, written by one session-guarded PUT.
- [ ] **C2. The predicate:** `/api/alerts/feed` returning the union with
  the matched rule in each row; unit-specced against both arms and the
  verified gate.
- [ ] **C3. The panel:** one component, both homes; the desktop notifier
  switches from the watchlist feed to the alerts feed unchanged in
  cadence.
- [ ] **C4. Push consumes it:** Phase B's fan-out reads the same
  predicate server-side; nothing channel-specific in the rule.

## Out of scope, named so it stays out

- React Native / Flutter (a second client; argued against above).
- On-device caching of authenticated responses (a spec-level decision).
- Telegram per-user fan-out (deprioritized 2026-08-18; B2's trigger is
  channel-shaped so it can join later without redesign).
- Web Push for browsers (the manifest from A6 is its base; its own plan).
- Store listing assets and copy; the unread-badge mid-session poll
  (subsumed by push once B lands).
