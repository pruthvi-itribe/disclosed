# Accounts, per-user watchlists, and per-user alerts

**Status:** design, 2026-08-08. Not yet built. No production code changed by this
document.

**Problem.** The dashboard is a loopback-only, unauthenticated, read-only viewer.
Alerts are one Telegram channel carrying everything notable. The founder wants
register/login, per-user watchlists, and an alert when a watchlisted company
files something notable.

**v1, decided by the founder and taken as given here:** in-house email +
password. Firebase, Google OAuth and Telegram login are v2 alternatives and live
in Appendix A. Telegram DM delivery is a v2 upgrade and lives in Appendix B.

**The shape of the answer.** Email + password with argon2id and Mongo-backed
opaque sessions. Watchlists are one document per user with a multikey index.
**The v1 alert surface is an in-app "Watching" view, which needs no fan-out, no
queue and no delivery state at all** — it is a query over filings we already
hold. Email alerts land at the same moment as DNS and TLS, because they share a
blocking dependency. The user's alert preferences carry a **channels array** from
day one so email, Telegram DM and web push are additions rather than migrations.

---

## 0. What this must not break

Six invariants constrain almost every decision below. They are listed first
because several obvious designs violate one of them.

| Invariant | Where stated | What it rules out |
|---|---|---|
| `apps/ingest` has **no HTTP server**, and `@nestjs/platform-express` is absent from its runtime graph on purpose | `dashboard.module.ts:17-59` | Any inbound HTTP in the ingest process. |
| The dashboard **never writes** to `filings` — `FilingReadModel` makes a write a compile error | `dashboard.module.ts:64-79` | Loosening that narrowing. Account writes need their own models. |
| The dashboard is **self-contained**: no CDN, no external request, no web font — enforced by `page.spec.ts` (`not.toMatch(/<script[^>]+src=/)`, `not.toMatch(/url\s*\(/)`, no `<link>`, no `@font-face`) | `CLAUDE.md` | Any hosted auth widget or SDK on the page. This is what disqualifies Firebase's client SDK (Appendix A). |
| **Untrusted text**: no `innerHTML`, DOM via `createElement`/`textContent`, links via `safeHref` | `CLAUDE.md`, `script-feed.ts` | Templating shortcuts in new UI. Email addresses and display names are untrusted text. |
| `DASHBOARD_HOST` is loopback and **deliberately not configurable** — *"making that an environment variable would make `0.0.0.0` a one-line mistake"* | `config/configuration.ts:38-44` | Changing the bind to go multi-user. §6 keeps it. |
| Script fragments carry **no backtick and no `${`**; every regex backslash is doubled; **no emoji** (`page.spec.ts` rejects `\u{2600}-\u{27BF}`) | `script-fragments.spec.ts`, `page.spec.ts` | Template literals in client code, and a `U+2605` star glyph. §10 draws the star in CSS instead. |

Two softer ones that still bind:

- `autoIndex: false` on the dashboard connection. New collections get no indexes
  for free (§8).
- `bodyParser: false` in `main.ts`, load-bearing for the multer argument in the
  module header. **A password cannot travel in a query string**, so this one has
  to move — §6 moves it as narrowly as it can be moved.

---

## 1. The numbers this design stands on

Measured, from source comments that cite their own measurements and the
2026-08-07 live-collection pass in `2026-08-07-company-page-and-widgets.md`.

| Fact | Value | Source |
|---|---|---|
| Filings surviving the routine-category gate | 12,415 / 17,442 = **71.2%** over 32 days | `alert.service.ts:36-44` |
| Alertable filings per IST day | **388** | same |
| Busiest observed hour | **106** filings | same |
| Busiest observed 30s / 60s window | **9 / 12** filings | `telegram.service.ts:115-122` |
| Filings in the live collection (2026-08-07) | 2,261 | company-page spec |
| Distinct companies (same pass) | **960** | same |
| Filings per company | **2.36**; 47.9% of companies filed exactly once | same |
| Filings carrying a verified claim | 885 / 2,261 = **39.1%** | same |
| Claim lines lost to the wire mute | 43 / 1,014 = **4.2%** | `enrichment.worker.ts:1015-1033` |
| Feed poll cadence | **4 s** (`FAST_MS`) | `script-poll.ts` |

**Not measured, and it governs the per-user cap.** Distinct companies across the
32-day corpus is unknown; only the 4-day figure (960) exists. §4.3 is therefore
bracketed rather than asserted, and §11/M1 is the measurement that must run
before the constant ships. The company-page spec already learned this the hard
way — a number quoted from a stale comment was wrong by a factor of 7.6.

---

## 2. Identity: email + password, done properly

The provider debate is settled (Appendix A carries the alternatives and the
honest costs of each). What follows is the design of the thing chosen.

### 2.1 What "done properly" costs, stated up front

Three real obligations come with owning credentials, and none of them is
assumed away:

1. **A password hash that survives a database dump.** §2.2.
2. **A reset path.** It needs email. §2.5 sequences it against a dependency
   rather than a preference, and names what the login page says in the meantime.
3. **Brute-force and enumeration defence.** §2.4 and §2.6. These are not
   optional extras; a login endpoint without them is a credential-stuffing
   target from the hour it is public.

### 2.2 Hashing

**argon2id**, OWASP's first choice, at the OWASP-2024 minimum profile:
`m = 19456 KiB (19 MiB)`, `t = 2`, `p = 1`, 16-byte random salt, 32-byte output.
The encoded string (`$argon2id$v=19$m=19456,t=2,p=1$...`) carries its own
parameters, so raising them later is a per-user upgrade on next login rather
than a migration.

**Package: `@node-rs/argon2`, not `argon2`.** The `argon2` package is node-gyp
and needs a build toolchain on the deploy host that matches its libc; the Rust
package ships prebuilt binaries. This matters because the alternative failure is
a deploy that cannot install its own auth.

**The escape hatch, and it is a real one.** If no prebuilt binary covers the
deploy target, `crypto.scrypt` is in the Node standard library, is memory-hard,
and is OWASP's named fallback at `N = 2^17, r = 8, p = 1`. Zero dependencies,
which this codebase's dependency hygiene would otherwise prefer outright. So
the hasher is behind a **two-method interface (`hash`, `verify`) with its own
spec**, and swapping implementations is a provider change, not a rewrite. Write
the interface first; it costs nothing and it is what makes the escape hatch real
rather than aspirational.

**A concurrency cap is required, not optional.** argon2id at 19 MiB per hash
means 50 concurrent logins is ~1 GB of resident memory. A login flood becomes an
OOM of the process that also serves the public feed. So password hashing runs
behind a **semaphore of 4** (a small pure queue, like the sender queue in
`telegram.service.ts` already is), and requests beyond it wait. Combined with
the rate limits in §2.4, an attacker cannot convert the hash cost into a denial
of service against readers.

**Bounds on the input.** Minimum 12 characters, maximum 128. The maximum is
about bounding work, not policy. (argon2 has no bcrypt-style 72-byte truncation
problem, so the maximum is generous rather than security-critical.) **No
composition rules and no forced rotation** — NIST SP 800-63B is explicit that
both make passwords worse. A small embedded deny-list of the ~1,000 most common
passwords is checked at registration and at change; a k-anonymity call to HIBP is
follow-on F6, deliberately not on the login path on day one because it puts an
outbound third-party request inside authentication.

### 2.3 Sessions, not JWTs

Briefly, because the brief asks for a bias to the simplest revocable thing and
that bias is correct here.

A JWT removes one indexed read per authenticated request. It cannot do
revocation, and every operation this product needs is a revocation: "log me
out", "log me out everywhere", "I changed my password", "delete my account".
The standard answers are a short expiry plus a refresh token — which is a stored
session with extra moving parts — or a denylist, which is a session store built
inside out and growing without bound. A JWT also puts identity in a bearer
artifact that is valid off-host, which is a worse outcome for a leaked log line
than an opaque handle.

**Decision: Mongo-backed opaque sessions.** It is the same call
`enrichment.worker.ts` already argued for the work queue — *"Bull and Redis were
removed from this project as unused, and are not re-added… Mongo is the queue"*.
Mongo is the session store for the same reason: there is one durable store, and
a second one for 50,000 tiny records is infrastructure without a load.

Mechanics:

- Token: **32 random bytes** from `crypto.randomBytes`, base64url. **Never
  stored.** What is stored is `sha256(token)`, so a database dump is not a
  session-hijack kit and the lookup is `findOne({tokenHash})` on a unique index.
- Cookie `turret_sid`: `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`,
  `Max-Age` = TTL (30 days).
  `Lax` rather than `Strict`: `Strict` drops the cookie on any inbound top-level
  navigation, which breaks a link from an email into a logged-in page — and the
  email lane is landing. `Lax` still blocks cookies on cross-site POST, which is
  the CSRF case that matters; §6 adds an `Origin` check as the second layer.
- Expiry via a **TTL index** (`expiresAt`, `expireAfterSeconds: 0`) — the
  database does the sweeping. Sliding renewal is written **at most once an hour**
  so an active reader does not cause a write per request.
- **Session fixation.** There is no pre-auth session to fix — a session document
  exists only after a successful password verification. The rule is stated
  anyway because it is the one that gets broken later: **a session token is
  minted at authentication and never reused across an authentication boundary.**
  On login, any cookie already presented is discarded, not adopted. On password
  change, every other session for that user is deleted and the current one is
  re-minted.

### 2.4 Brute force

Two independent limiters, because either alone is defeatable:

| Limiter | Scope | Rule |
|---|---|---|
| Per IP | `POST /api/auth/login`, `/register`, `/reset/*` | 10/min, 60/hour. Throttler. |
| Per account | keyed on the normalised email | Exponential backoff after 5 consecutive failures: 1s, 4s, 16s, 64s, capped at 15 min, stored as `lockedUntil` on the user. Reset to zero on success. |

**Backoff, not lockout.** A hard account lockout hands an attacker a denial of
service against any user whose email they know. A backoff that caps at fifteen
minutes makes online guessing hopeless without letting anyone lock anyone out.

**A locked account returns exactly the same body and status as a wrong
password** — otherwise the lockout response is itself an oracle telling an
attacker that the address exists and that they are hitting a real account.

### 2.5 Password reset — the honest sequencing

**The email lane is blocked on a verified sending domain, which is the same
domain the TLS certificate needs.** Day one is loopback with no domain. So
"ship reset on day one" is not a cost trade-off; it is not possible.

**MVP day (loopback, invited testers): no self-serve reset, and the login page
says so in plain words.** *"No password reset yet — message the operator and it
will be reset by hand."* For three testers that is correct, honest, and takes
zero engineering. What is not acceptable is a reset link that quietly does
nothing, or a login page that stays silent and lets someone lock themselves out.

**At the exposure gate, before the first public signup: the email lane ships.**
Not later. A public signup with no reset is a product that loses users silently
and never learns why.

The marginal cost then is genuinely small, which is why this is the right shape
rather than a dodge:

- **No new dependency.** `axios` is already a runtime dependency; a Resend-style
  REST send is one POST.
- **DNS is a one-time job on a domain the TLS certificate already requires.**
  SPF TXT, DKIM CNAME, DMARC. Twenty minutes, once.
- Reset token: **32 random bytes**, stored only as `sha256`, single-use,
  **30-minute** expiry, invalidated on use and on any password change.
- The response to a reset request is **always** *"If that address is registered,
  a link is on its way"* — same body, same status, whether or not it exists.
- The reset **link is a GET that renders a form**; the token is consumed by the
  **POST**, so a link prefetcher or an email-security scanner following the URL
  cannot burn it.
- Completing a reset **deletes every session for that user**.

The same lane then carries **email verification at registration** (§2.6) and
**email alerts** (§5.2). Three features, one dependency, one gate.

### 2.6 No user enumeration

| Surface | Rule |
|---|---|
| **Login** | One error for every failure: *"Email or password is incorrect."* Same status (401), same body, for unknown address, wrong password, and backed-off account. **Timing must match too**: when no user exists, verify the submitted password against a constant `DUMMY_ARGON2_HASH` so the no-user path costs the same ~50 ms as the wrong-password path. Without this, response time is the oracle. |
| **Reset request** | Always *"If that address is registered, a link is on its way."* Always 202. |
| **Registration, after the email lane lands** | Always *"Check your email to finish signing up."* Always 202. An unregistered address gets the confirmation link; a registered one gets *"someone tried to sign up with your address — here's a sign-in link and a reset link."* This is the standard non-enumerating registration and it needs email to work. |
| **Registration, on MVP day** | **Enumerates, knowingly.** With no email lane, the only alternative to a `409` is to accept a registration that silently does nothing. The doc records this as an accepted, time-boxed exposure on a loopback deployment with invited testers, closed by the exposure gate before any public signup. It is written down so it is a decision rather than an oversight. |

### 2.7 Email as identity

Normalised to lowercase and trimmed, and **that is all**. Gmail dot-stripping and
`+tag` removal are not done: they surprise users, they differ per provider, and
getting them wrong merges two people's accounts. The unique index is on the
normalised form. Validation is a conservative pattern plus a 254-character bound
at the boundary, not an RFC 5322 parser.

---

## 3. Deliberately not in v1

Stated so they are visible decisions rather than omissions: no email
verification-gating of login on MVP day (§2.6), no 2FA (follow-on F7), no
"remember this device", no social login (Appendix A), no account deletion UI
(follow-on F8 — but it becomes non-optional quickly once real people have
accounts).

---

## 4. Watchlists

### 4.1 Shape

**(a) One document per user with an `entries` array.** `findOne({userId})` is one
document for the page load. Fan-out is `find({'entries.symbol': S})` on a
multikey index. The array must be bounded — an unbounded array in a document is
the classic Mongo anti-pattern — which the cap in §4.3 does by construction.

**(b) One document per (user, symbol) edge.** Unbounded growth is fine and
per-entry preferences are natural, but "show me my watchlist" becomes a
multi-document query on every page load, and the common read should be the
cheapest.

**Decision: (a).** At the cap the array is ~50 subdocuments (a few KB). (b)'s
only real advantage is unbounded size, and the cap says we do not want that.

### 4.2 Per-symbol preferences

The brief asks whether entries carry their own alert preferences. **Not yet, but
the schema must grow them without a migration.**

There are exactly two knobs a filing can be gated on that mean anything to a
reader today: confidence tier and claim topic (`CLAIM_TOPICS`, already a closed
list and already a feed filter). Everything else — routine categories,
boilerplate claims — is gated globally and correctly before anything per-user
happens. Offering *per symbol* what nobody has asked for *per account* is
configuration for a case that has never occurred, which `CLAUDE.md` rule 2 names
directly.

So **`minTier` and `mutedTopics` live on the user**, and the entry schema
reserves the same two optional field names as overrides. Absent means "use the
account default". Adding the override later is a UI change and a two-line
resolver.

### 4.3 The cap

`MAX_WATCHED_SYMBOLS = 50`, derived rather than picked:

- 388 alertable filings/day across the corpus.
- Distinct companies across the 32-day corpus is **not measured**; the 4-day
  figure is 960. Bracketing at 1,500–2,500 gives **0.16–0.26 alertable filings
  per company per day**.
- A 50-symbol watchlist therefore averages **8–13 notable filings per day**.
  That is at the upper edge of what a person tolerates in a notification channel
  — and `alert.service.ts:74-89` already documents exactly what a muted channel
  costs a pipeline whose outage alarms share it.

**The bracket must be replaced by a measurement before the constant ships**
(§11/M1), and the constant's comment carries the measured number. A guessed
number in a comment poisons the record this codebase keeps.

---

## 5. The alert surface

### 5.1 v1 is in-app, and that is the design's biggest simplification

Three candidates for the v1 channel:

**(a) In-app "Watching" view.** A third view beside Feed and Admin, showing the
user's symbols' filings newest-first, with an unread count. **It requires no
fan-out, no queue, no delivery state, no rate limiter, no bounce handling and no
third party.** It is `filings.find({symbol: {$in: mySymbols}})` against an index
that already exists.

**(b) Email.** Real push, no app open needed. Needs the whole email lane —
which §2.5 is landing anyway for reset — and needs coalescing, because 8–13
individual emails a day is a spam-folder trajectory.

**(c) Web push.** Genuinely real-time, and — worth noting since it is usually
assumed otherwise — it does **not** break the self-contained rule: the service
worker is same-origin, and the push endpoint is called by our server, not by the
page. Costs: VAPID keys, a second served asset (`/sw.js`), poor permission-accept
rates, and iOS Safari requiring the site be added to the Home Screen first.

**Decision: (a) ships on the MVP day; (b) ships at the exposure gate alongside
reset; (c) is follow-on F4 next to Telegram DM.**

**The honest cost of this ordering, stated plainly.** This product's stated
reason for existing is latency — `enrichment.worker.ts` opens with the poller's
two-second budget being *"the reason this project exists"*. **An in-app view is
not a push channel.** A reader who is not looking at the page learns nothing
until they look, and a coalesced email is minutes behind. The latency promise
returns with F4 (web push / Telegram DM), and it should not be described to
users as real-time until then. That is a product-messaging obligation, not just
an engineering note.

### 5.2 Email alerts (at the exposure gate)

**Coalesced, never per filing.** A 15-minute window during the NSE session, then
one message: *"3 filings from companies you watch."* Per-filing email at 8–13/day
is how a sender reputation is destroyed. A user may instead choose a single
**08:00 IST daily digest**.

Coalescing is what makes an outbox necessary, so this is where it arrives:

- `alert_outbox`: one document per (user, filing, channel), written by the
  fan-out, drained by a per-channel dispatcher.
- Claimed with one atomic `findOneAndUpdate`, exactly the pattern
  `enrichment.repository.ts` already proves — Mongo is the queue, and there is
  nothing to reconcile after a restart because there is one record of what is
  outstanding.
- The `inapp` channel writes **nothing** to the outbox. It is a query.

### 5.3 Where the fan-out hooks in, when it exists

There are exactly two places a filing becomes a message today, and the fan-out
hooks into **both, at the same point, after the same gates**:

1. `AlertService.processInserted` — the poller's immediate alert, inside the
   per-filing `try`, after `this.shouldAlert(filing)`.
2. `EnrichmentWorker.announce` — the follow-up carrying the verified headline,
   claim line or results line, after its four gates and after
   `composeWireClaimLine`.

This placement *is* the "inherits the same rules" requirement:

- `isRoutine(category)` has already refused the filing, so a user alert can never
  be a routine category.
- `isWithinAlertWindow` has already refused it, so a backfill of a thousand
  stored filings cannot notify a thousand users about last week.
- On lane 2, `wireClaimLine` is **the muted line**, so the 4.2% of filings whose
  every claim is boilerplate stay silent for subscribers too — the same silence
  the operator gets.

**One required change, and it is a bug waiting to happen.**
`passesContentGates` folds two unrelated things together: `isRoutine` (a fact
about the filing) and the operator's `WATCHLIST` env (a fact about the
operator's preferences). If the operator sets `WATCHLIST=RELIANCE`, every
subscriber watching TCS silently gets nothing, forever, with no error anywhere.

- Rename the env var `WATCHLIST` → **`OPERATOR_WATCHLIST`** (`.env.example` and
  the startup warning text with it). One word now means two things in a system
  about to have both, and that is precisely how the bug above ships.
- Split `passesContentGates` into the **routine gate** (all lanes) and
  **`isWatchedByOperator`** (operator lanes only). The two existing call sites
  compose both; the fan-out calls only the first.

### 5.4 The channels array

The founder's requirement is that a Telegram DM channel be addable in v2 without
a schema change. So `user.alerts.channels` is an array of discriminated
subdocuments from day one:

```
channels: [ { kind, enabled, config } ]

  kind: 'inapp'    config: {}                                            -- v1
  kind: 'email'    config: { address, verifiedAt, mode, lastFlushedAt }  -- exposure gate
  kind: 'telegram' config: { chatId, deliverable, reason }               -- v2, no migration
  kind: 'webpush'  config: { endpoint, p256dh, auth }                    -- F4, no migration
```

`config` is `Mixed` in Mongoose and is validated by a **pure discriminated-union
parser** (`libs/accounts/src/channel.ts`, tested), which is how every other
boundary in this codebase is validated. That combination is what makes "no
schema change" true rather than aspirational.

**This is the one place this design accepts speculative generality**, and it is
accepted knowingly: `CLAUDE.md` rule 2 forbids *"configuration for a case that
has never occurred"*, and the second and third channels here are already named
and already dated in this document. That is the condition under which the rule
does not apply.

Querying it obeys the house rule verbatim — *"Mongo array fields: `$elemMatch`
for existence, never `$ne: null`"*:

```
{ 'alerts.channels': { $elemMatch: { kind: 'email', enabled: true } } }
```

Without `$elemMatch`, `{'alerts.channels.kind':'email','alerts.channels.enabled':true}`
matches a user whose email channel is **disabled** and whose in-app channel is
enabled — two conditions satisfied by two different array elements.

---

## 6. Exposure: loopback to the internet

### 6.1 The bind does not change

`configuration.ts:38-44` argues that making the host an env var makes `0.0.0.0` a
one-line mistake. That does not weaken when the app gains a login; it
strengthens, because a misconfigured bind now exposes sessions and a password
endpoint.

**A reverse proxy is the only process on a public interface** (Caddy is the
smallest thing that terminates TLS with automatic certificates) and it proxies to
`127.0.0.1:7717`. `DASHBOARD_HOST` stays a constant.

Proxy: TLS termination, HSTS, a coarse per-IP connection and request limit, a
request-body size limit, `X-Forwarded-For`. The app sets `trust proxy` to
**exactly one hop** — trusting it blindly lets any client spoof its own IP in a
header and walk straight past every limiter in §2.4.

### 6.2 Route posture

| Routes | Posture | Why |
|---|---|---|
| `GET /`, `api/summary`, `api/filings`, `api/suggest`, `api/categories`, `api/daily` | **Public** | The feed is the shop window. Login-walling it kills discovery and sharing. Public data, republished with attribution. |
| `api/enrichment` | **Behind the session** | Queue depths, refusal reasons, raw error strings. Nothing secret, but it is internals, and it belongs behind the Admin tab. |
| `api/me`, `api/watchlist*`, `api/alerts/*` | **Session required** | |
| `api/auth/*` | **Public, hard rate limits** | §2.4 |

### 6.3 Body parsing — the one posture that has to move

`bodyParser: false` is load-bearing for the multer argument in
`dashboard.module.ts`. **A password cannot travel in a query string**: query
strings land in access logs, `Referer` headers and browser history. So the
posture moves — as narrowly as it can:

```
app.use('/api/auth', express.json({ limit: '4 kb' }));
```

- **Path-mounted.** Body parsing exists on four routes and nowhere else. The
  feed routes, the watchlist routes and the page itself still see zero parsing.
- **JSON only.** No `urlencoded`, no `multipart`, so `qs`'s array handling stays
  off the request path and multer stays unreachable — it is reachable only
  through `FileInterceptor`/`FilesInterceptor`, which this app never registers.
  The module header's three-point argument survives with point 2 amended from
  "no body parsing at all" to "JSON only, on `/api/auth`, at 4 kb".
- **`main.ts` and the module header must both be edited.** That comment is the
  reason the dependency was re-added deliberately, and leaving it stale would be
  worse than the change itself.

**Watchlist mutations still use query parameters and need no body**, which is
what keeps the change this small:

```
POST   /api/watchlist?symbol=RELIANCE
DELETE /api/watchlist/RELIANCE
```

This is not a workaround. `readSingle` in `http/query-params.ts` already refuses
the array and object query shapes — *"the object form is the shape a
NoSQL-injection attempt takes"* — and is already tested. The mutation inputs go
through the same hardened reader as every existing filter, and a ticker in an
access log is public data.

### 6.4 CSRF

Cookie sessions, so two layers and no token plumbing:

1. `SameSite=Lax` already blocks the cookie on cross-site POST.
2. An **`Origin` guard on every mutating route**: reject when `Origin` is absent
   or is not `PUBLIC_ORIGIN`. Twelve lines, pure, testable.

Double-submit tokens add a third layer and a lot of plumbing; with no cross-site
surface and no CORS, they are not earning it. Revisit if a mobile client or a
third-party integration ever appears.

### 6.5 CORS

**None. Do not enable it.** The page is served by the origin it calls. An open
`Access-Control-Allow-Origin` is the single line that converts a `SameSite=Lax`
cookie design into a cross-origin API with ambient credentials.

### 6.6 Rate limiting

Add **`@nestjs/throttler`** — first-party, correct sliding window, in-memory
(fine: one process; limits reset on restart, which is acceptable given the
per-account backoff in §2.4 is persisted). Rolling a limiter by hand is the
textbook case for preferring the library; the proxy's coarse limit is the belt.

| Bucket | Limit | Sizing |
|---|---|---|
| Public reads (default) | 300/min/IP | The page itself is 30/min (two routes at 4 s) plus debounced `api/suggest` keystrokes. Above real use, below a scrape. |
| `api/auth/login`, `/register` | 10/min, 60/h per IP | §2.4, alongside the per-account backoff. |
| `api/auth/reset/*` | 5/h per IP | Each one sends an email. |
| Watchlist mutations | 60/min/session | |

### 6.7 Response headers

```
Content-Security-Policy: default-src 'none'; script-src 'nonce-<per-response>';
  style-src 'nonce-<per-response>'; connect-src 'self'; img-src 'self';
  base-uri 'none'; form-action 'self'; frame-ancestors 'none'
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
Referrer-Policy: same-origin
Cache-Control: no-store          (already set on every route)
```

A **nonce** rather than `'unsafe-inline'`: the page is 100% inline by design, so
a nonce costs one parameter on `renderDashboardPage()` and is strictly stronger
(CSP3 ignores `'unsafe-inline'` when a nonce is present). `default-src 'none'`
works precisely because `page.spec.ts` already forbids external scripts,
stylesheets, `@font-face` and `url(`.

Consequence: `renderDashboardPage()` becomes `renderDashboardPage(nonce)` and
`page.spec.ts` passes one.

---

## 7. Security checklist and threat model

### Against the global standards

| Rule | How it is met |
|---|---|
| No hardcoded secrets | Everything through the existing `loadDashboardConfig` pattern — the only place this app reads `process.env`. `.env` is gitignored and **has never been tracked** (verified with `git ls-files`). New keys: `SESSION_TTL_DAYS`, `PUBLIC_ORIGIN`, `ARGON2_*`, and later `RESEND_API_KEY`, `MAIL_FROM`. |
| Inputs validated at the boundary | Auth bodies through `class-validator` DTOs (already a dependency) with `ValidationPipe({whitelist: true, forbidNonWhitelisted: true})` — `whitelist` is the clause that matters, since it strips fields the DTO does not declare. Watchlist inputs through the existing `readSingle`/`readFilter`. Symbols allowlisted against the directory. |
| Parameterised / injection-safe queries | No query is built from caller text. `readSingle`'s `typeof` check stops `?symbol[$ne]=x` becoming an operator; the DTO `whitelist` stops `{"email": {"$gt": ""}}` reaching a filter — **the classic Mongo auth bypass**, and the specific reason `forbidNonWhitelisted` and an explicit `@IsString()` on `email` are load-bearing rather than decorative. |
| XSS prevention | Unchanged and absolute: no `innerHTML`, `createElement`/`textContent`, `safeHref`. Email addresses are untrusted text and go in via `textContent`. |
| AuthN/AuthZ on protected endpoints | One `SessionGuard`. Every watchlist operation is scoped by `userId` **from the session**, never from a parameter — there is no route on which one user can name another. |
| Rate limiting | §2.4 and §6.6. |
| Errors leak nothing | Stable `code` plus a human message. Mongo errors, stack traces and mail-provider bodies are logged server-side and never serialised. The auth errors are deliberately *less* informative than a developer would like — §2.6. |
| Immutability | Watchlist mutation is `$addToSet`/`$pull` — a new array server-side, not a read-modify-write race. |
| 80% coverage | The security-critical units are pure and cheap: `password-hash.ts`, `password-policy.ts`, `email-normalise.ts`, `session-token.ts`, `login-backoff.ts`, `origin-guard.ts`, `channel.ts`, `watchlist-cap.ts`, `symbol-validate.ts`. TDD each before wiring. |

### Threat model

1. **Offline cracking after a database dump.** → argon2id at the OWASP profile,
   per-user 16-byte salt, parameters encoded in the hash so they can be raised
   per-user on next login.
2. **Online guessing / credential stuffing.** → Per-IP throttle plus per-account
   exponential backoff capped at 15 min; identical response for wrong password
   and backed-off account; deny-list of the 1,000 most common passwords.
3. **User enumeration.** → Identical bodies, statuses **and timings** (the dummy
   hash) on login; always-202 on reset. Registration enumerates on MVP day only,
   knowingly and time-boxed (§2.6).
4. **Hash-cost denial of service.** → Semaphore of 4 concurrent hashes, so a
   login flood cannot OOM the process that also serves the public feed.
5. **Session theft.** → 256-bit opaque token stored only as SHA-256; `HttpOnly`
   + `Secure` + `SameSite=Lax`; TTL index; revocation is a delete;
   `deleteMany({userId})` for log-out-everywhere and after any password change.
6. **Session fixation.** → Tokens are minted only at authentication and never
   reused across that boundary; a presented cookie is discarded, not adopted.
7. **CSRF on mutations.** → `SameSite=Lax` plus an `Origin` allowlist guard.
8. **NoSQL injection through a login body.** → `ValidationPipe` with `whitelist`
   and `forbidNonWhitelisted`, `@IsString()` on every field. Without it,
   `{"email": {"$gt": ""}}` is an authentication bypass.
9. **Reset-token abuse.** → 32 random bytes, stored hashed, single-use, 30-min
   expiry, consumed by POST rather than by the GET a link-scanner follows, all
   sessions revoked on completion.
10. **Privacy.** Email addresses are personal data. Store the minimum; never log
    a full address at info level (log a hash or a masked form); account deletion
    removes the user, sessions, watchlist and outbox rows in one operation
    (follow-on F8, and it becomes non-optional quickly).

---

## 8. Schemas, with exact indexes

Collections: `users`, `sessions`, `watchlists`. Later: `alert_outbox`.
**The `filings` collection is not touched and gains no index.**

### `users`

| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | |
| `email` | String | **Normalised** (lowercase, trimmed). Identity. |
| `passwordHash` | String | Encoded argon2id string; carries its own parameters. |
| `emailVerifiedAt` | Date \| null | Null on MVP day for everyone. |
| `createdAt`, `lastLoginAt` | Date | |
| `failedLoginCount` | Number | §2.4 |
| `lockedUntil` | Date \| null | §2.4 |
| `alerts.channels` | `[{ kind, enabled, config }]` | §5.4. `_id: false`. |
| `alerts.minTier` | String \| null | Account default; null = no floor. |
| `alerts.mutedTopics` | [String] | Allowlisted against `CLAIM_TOPICS`. |
| `alerts.lastSeenWatchlistAt` | Date \| null | Drives the unread badge (§10). |

```
{ email: 1 }                     unique   name: email_1
{ 'alerts.channels.kind': 1 }             name: channels_kind_1   -- with $elemMatch (§5.4)
```

### `sessions`

| Field | Type | Notes |
|---|---|---|
| `tokenHash` | String | `sha256(token)` hex. The raw token is never stored. |
| `userId` | ObjectId | |
| `createdAt`, `lastSeenAt`, `expiresAt` | Date | |

```
{ tokenHash: 1 }  unique                  name: tokenHash_1
{ expiresAt: 1 }  expireAfterSeconds: 0   name: expiresAt_ttl
{ userId: 1 }                             name: userId_1   -- log out everywhere
```

### `password_resets`  *(exposure gate, not MVP day)*

```
{ tokenHash: 1 }  unique                  name: tokenHash_1
{ expiresAt: 1 }  expireAfterSeconds: 0   name: expiresAt_ttl
```

Fields: `tokenHash`, `userId`, `createdAt`, `expiresAt`, `usedAt`. Single-use is
enforced by `findOneAndUpdate({usedAt: null}, {$set:{usedAt: now}})` — an atomic
claim, not a read-then-write, so two concurrent submissions cannot both succeed.

### `watchlists`

| Field | Type | Notes |
|---|---|---|
| `userId` | ObjectId | One document per user. |
| `entries` | `[{ symbol, addedAt, minTier?, mutedTopics? }]` | Capped at 50. The optional fields are §4.2's reserved overrides; absent = account default. `_id: false`. |
| `updatedAt` | Date | |

```
{ userId: 1 }                      unique   name: userId_1
{ 'entries.symbol': 1, userId: 1 }          name: entries_symbol_1_userId_1
```

The compound index exists so the eventual fan-out
`find({'entries.symbol': S}, {userId: 1, _id: 0})` is served from the index.
**Whether MongoDB reports `PROJECTION_COVERED` for a multikey index with the
predicate on the array field must be measured with `explain()` before the index
comment claims it** — the documented rule is that multikey indexes cannot cover
queries over the array field. The `symbol_1_companyName_1` comment in
`filing.schema.ts` is the precedent for putting a real plan in the comment rather
than a belief. Either way the index serves the predicate; only the wording
depends on the measurement.

Scale: 1,000 users × 50 symbols = 50,000 index keys. Trivial.

### Who builds these indexes

The dashboard is the only writer of these collections, so it owns their indexes —
but its connection is `autoIndex: false` and must stay that way so it can never
touch `filings`.

**`assertAccountIndexes()` runs at dashboard boot and creates indexes on the
account models only.** This is deliberately the *opposite* of
`FilingRepository.assertIndexes`, which fails rather than repairs, and the
asymmetry is the point: `filings` is shared with a live poller, so a background
index build there is an operational event an operator must choose. These
collections are this process's own and are empty on day one.

---

## 9. API

Every response uses the existing envelope. `envelope.ts` gains a failure variant;
the exception filter is registered on the **new controllers only** (`@UseFilters`
at controller level), so existing routes' error bodies stay byte-identical.

```json
{ "success": false, "data": null,
  "error": { "code": "WATCHLIST_FULL", "message": "..." }, "meta": null }
```

### Auth — JSON body, `/api/auth` only

**`POST /api/auth/register`** `{ "email": "...", "password": "..." }`

- `201` `ok({ signedIn: true, email })` and sets the session cookie — MVP day
  signs the user straight in, since there is no verification lane yet.
- `409 EMAIL_IN_USE` on MVP day (the knowing exposure of §2.6); becomes a
  `202` with an identical body for every address once the email lane lands.
- `422 WEAK_PASSWORD` with the specific reason (too short, on the deny-list).
  This one *should* be specific — it is about the submitted secret, not about
  whether an account exists.

**`POST /api/auth/login`** `{ "email": "...", "password": "..." }`

- `200` `ok({ signedIn: true, email })`, fresh session token, fresh cookie.
- `401 INVALID_CREDENTIALS`, *"Email or password is incorrect."* — for unknown
  address, wrong password, and backed-off account alike, at matched timing.

**`POST /api/auth/logout`** → deletes this session, clears the cookie.
Origin-guarded.
**`POST /api/auth/logout-all`** → `deleteMany({userId})`.
**`POST /api/auth/password`** `{ "current": "...", "next": "..." }` → verifies
current, rehashes, deletes every other session, re-mints this one.
**`POST /api/auth/reset/request`** *(exposure gate)* → always `202`.
**`POST /api/auth/reset/complete`** `{ "token": "...", "password": "..." }`
*(exposure gate)* → `200`, all sessions revoked.

**`GET /api/me`**

```json
{ "success": true, "error": null, "meta": null,
  "data": { "signedIn": true, "email": "asha@example.com",
            "watchCount": 7, "watchCap": 50, "unread": 3,
            "channels": [ { "kind": "inapp", "enabled": true } ] } }
```

Signed out: `data: { "signedIn": false }` with **`200`, not `401`** — the page
asks this on every load, and a 401 on the ordinary anonymous path is console
noise that trains people to ignore the real ones.

### Watchlist — session required

**`GET /api/watchlist`**

```json
{ "success": true, "error": null,
  "meta": { "used": 2, "cap": 50 },
  "data": [ { "symbol": "RELIANCE", "companyName": "Reliance Industries Limited",
              "addedAt": "2026-08-08T04:11:09.000Z", "filingsHeld": 14 },
            { "symbol": "TCS", "companyName": "Tata Consultancy Services Limited",
              "addedAt": "2026-08-08T04:12:40.000Z", "filingsHeld": 3 } ] }
```

`companyName` and `filingsHeld` come from the `CompanyDirectory` snapshot, so
this route costs **zero database reads beyond the one watchlist document**.

**`POST /api/watchlist?symbol=RELIANCE`**

- `201` `ok({symbol, addedAt}, {used, cap})`.
- `200` with the same body when already present — idempotent, because a
  double-click is not an error.
- `409 WATCHLIST_FULL` with `meta: {used, cap}`, so the page can say which to
  drop.
- `422 UNKNOWN_SYMBOL` when it is not in the directory. **Refused, not
  accepted.** A silently accepted typo is a watchlist entry that will never
  alert and that the reader believes is working — *"nothing was found"* and
  *"nothing was looked for"* must not render the same. The message names the
  fact: *"No filings are held for XYZ."* (§11/M2 sizes how often this bites.)

**`DELETE /api/watchlist/RELIANCE`** → `ok({removed: true}, {used, cap})`. `200`
even when absent, for the same idempotency reason.

**`GET /api/watchlist/feed?limit=&offset=`** — the v1 alert surface.

Resolves symbols from the session and returns `FilingView[]` in the **same shape
`api/filings` already returns**, so `renderFeedInto` draws it unchanged. Also
sets `meta.unread` and stamps `alerts.lastSeenWatchlistAt`.

Query: `{ symbol: { $in: [...≤50] } }` sorted `disseminatedAt: -1`, served by the
existing `symbol_1_category_1_disseminatedAt_-1` index as a sort-merge across
symbol values. **No new index.** §11/M3 measures the plan.

---

## 10. UI touchpoints

One self-contained document, no framework, no router, no client-side
persistence. Everything below respects that.

### Header — `page.ts:57-70`

`.topbar` is a flexbox and `.topbar .status` carries `margin-left: auto`. The
account control slots in as a **sibling of `<nav class="tabs">`, immediately
before `<div class="status">`** — no CSS layout change.

It must **not** go inside `<nav class="tabs" role="tablist">`: a non-tab child of
a `tablist` is an ARIA violation. Share the styling by class, not by role.

```html
<div class="account" data-ui="account">
  <button id="signin"  class="tab" type="button" hidden>Sign in</button>
  <button id="signout" class="tab" type="button" hidden></button>
</div>
```

Both `hidden` until `api/me` answers, so the header never flickers between two
states. New ids go in `page.spec.ts`'s `REQUIRED_IDS`.

### The sign-in panel

**A modal panel inside the existing document**, not a separate page — a second
served HTML document would duplicate the whole inline-CSS shell for two input
fields. `<form id="auth-form">` with `email` and `password`, a Register/Sign in
toggle, one error line, and — on MVP day — the literal sentence from §2.5:
*"No password reset yet — message the operator and it will be reset by hand."*

Constraints that bite here specifically:

- `autocomplete="email"`, `autocomplete="current-password"` /
  `"new-password"`. Password managers are a security control, and omitting these
  makes people pick worse passwords.
- The form **must not submit natively** (`event.preventDefault()`), because a
  native POST would navigate away from the single-document page. It calls
  `postJson`.
- The error line is written with `textContent`, from `body.error.message`, and
  never with `innerHTML`.

### The watch star — `script-feed.ts:127` (`feedCard`)

Attach after `span.grow` in `footer.cardfoot`, beside `.copy` and `.srclink`.
`page-style.ts:643` requires that group to be `flex: 0 0 auto`; add `.watch` to
that rule.

**Drawn in CSS, not typed.** `page.spec.ts`'s `it('contains no emoji')` rejects
`\u{2600}-\u{27BF}`, which contains `U+2605 BLACK STAR` and `U+2606 WHITE STAR`;
`it('embeds no remote asset through a CSS url()')` rejects any icon file. So the
star is a `::before` with `clip-path: polygon(...)` — no glyph, no asset, no
`url(`, and it passes both tests. Filled versus outlined is a class. The button
carries `aria-label="Watch RELIANCE"` / `"Stop watching RELIANCE"` and a text
fallback, because a clip-path shape is invisible to a screen reader.

The feed repaints every 4 seconds and **no DOM node survives a poll**, so
**watched state lives in `state.watched`, never in the DOM** — the same rule
`state.expanded` follows, for the reason its comment gives:
*"Anything a reader does to this page has to outlive the refresh that is the
whole reason the page is live."* `state.watched` is a `{SYMBOL: true}` map keyed
by **symbol, not `seqId`**, loaded once from `GET /api/watchlist` at sign-in.

The control is **absent, not disabled, when signed out.** A disabled control that
never explains itself is worse than no control.

### The company page — `page.ts:197-204`

`<button id="co-watch" class="watch" type="button" hidden>` inside `.coident`,
after `#co-industry`. `.cohead` is flex with `.cocoverage` at `margin-left:auto`,
so nothing moves. `renderCompany` (`script-company.ts:335`) already writes
`co-symbol`, `co-name`, `co-industry`, `co-coverage`; it sets this label and
`hidden` the same way it already does `industryTag.hidden = !industry`.

### The "Watching" view

A fourth view beside `view-feed`, `view-company`, `view-admin`, with a tab that
carries the unread count. `showView('watching')` follows the existing pattern in
`script-views.ts:16`; `query()` in `script-poll.ts:21` gains one branch returning
`api/watchlist/feed?...`; the body is **`renderFeedInto` reused unchanged**,
which is the largest saving in this design — it already draws results lines,
claim lines, quiet cards, Copy and Source with the full
`createElement`/`textContent`/`safeHref` discipline.

**One cost, stated:** while this tab is open, the 4-second poll is
authenticated — one indexed session read per 4 s per open tab. On the Feed and
Company tabs the poll stays anonymous and touches no session. An in-process
30-second session cache is follow-on F5, not day one.

### Writes from the client — `script-base.ts:270`

`getJson(path)` is the only fetch in the app. Add a sibling **`postJson(path,
method, body)`**:

- `credentials: 'same-origin'` (the default, but stated).
- A JSON body **only** for `/api/auth/*`; watchlist mutations pass `undefined`
  and carry their parameters in the path or query string (§6.3).
- Reads the failure envelope and surfaces `body.error.message`, rather than the
  generic string `getJson` throws today — `WATCHLIST_FULL`, `UNKNOWN_SYMBOL` and
  `INVALID_CREDENTIALS` are all messages a reader needs to see.

`page-script.ts:24` states *"NO URL APPEARS IN THIS FILE"* — every new path is
relative, like every existing one.

### Bootstrap ordering

`script-views.ts` ends with the entry point:
`setLive(...); refresh(true); window.setTimeout(loop, FAST_MS);`. The `api/me`
call and the auth wiring must land **above** those three lines. Fragment order is
asserted byte-exactly by `script-fragments.spec.ts`, so a new `script-account.ts`
fragment means editing **both** `page-script.ts`'s `FRAGMENTS` array and the
spec's array. **No backtick, no `${`, and every regex backslash doubled.**

### The footer sentence — `page.ts:404`

> "Read-only. This view never writes to the filings collection."

`page.spec.ts` asserts only `expect(html).toContain('never writes')`. Dropping
the first two words leaves the sentence true and the test passing:

> "This view never writes to the filings collection."

Precise rather than diplomatic: the app now writes `users`, `sessions` and
`watchlists`, and it still never writes a filing.

### Also update

`docs/ui-components.md` — the by-name component index. New `data-ui` and `id`
names belong in its tables.

---

## 11. Before this ships: measurements

The house rule is that a number in a comment comes from a measurement that
actually ran. Three things here are currently beliefs.

- **M1 — distinct companies across the 32-day corpus.** Governs the per-user cap
  (§4.3) and every alert-volume figure. Today it is a 1,500–2,500 bracket. Run
  it and write the result into the `MAX_WATCHED_SYMBOLS` comment.
- **M2 — how often a reader wants a symbol that has not filed yet.** If it is
  common, `422 UNKNOWN_SYMBOL` is hostile and the answer is a real NSE symbol
  master rather than the directory snapshot (follow-on F9).
- **M3 — the `explain()` for `GET /api/watchlist/feed`**: `$in` over up to 50
  symbols with `sort: {disseminatedAt: -1}` against
  `symbol_1_category_1_disseminatedAt_-1`. Confirm it plans as a sort-merge and
  not a blocking `SORT`, and put the plan in the route's comment. Also M3b: the
  fan-out plan for `entries_symbol_1_userId_1` (§8).

---

## 12. The MVP slice — one focused day

**Ship the whole loop, on loopback.** Founder plus two or three testers reach it
over SSH or Tailscale. Going public is a separate, gated step (§13/E) with its
own checklist, because "does the product work" and "is it safe on the internet"
are different questions and answering both in one day answers neither well.

The founder's decision made this day **smaller**, and the reason is worth
naming: the v1 alert surface is a query, so **day one contains no fan-out, no
outbox, no delivery state, no sender rate limiter and no third party.**

| # | Work | Notes |
|---|---|---|
| 1 | `libs/accounts`: `users`, `sessions`, `watchlists` schemas, `assertAccountIndexes`, repositories | Includes the narrowed read model for the ingest side, so a future fan-out cannot write. |
| 2 | `password-hash.ts` (interface + argon2id), `password-policy.ts`, `email-normalise.ts`, `session-token.ts`, `login-backoff.ts` — **TDD, all pure, first** | These are the security-critical units. Known-good/known-bad vectors, the deny-list, the backoff ladder, the dummy-hash timing path. |
| 3 | `session.service.ts`, `session.guard.ts` + specs | |
| 4 | `auth.controller.ts`: register, login, logout, logout-all, `api/me` | `express.json` path-mounted on `/api/auth` (§6.3); `main.ts` and the module header comment both edited. |
| 5 | `@nestjs/throttler` on the auth routes + `origin-guard.ts` on every mutation | **Not deferred.** Brute-force exposure begins the hour login exists. |
| 6 | `watchlist.controller.ts`: GET / POST / DELETE, cap, symbol validation | Query-param mutations; no body parsing outside `/api/auth`. |
| 7 | `GET /api/watchlist/feed` | Reuses `FilingQueryService`'s existing shape and index. |
| 8 | UI: sign-in panel, `#signin`/`#signout`, `api/me` on load, `state.watched`, `postJson`, the CSS star on cards, `#co-watch`, the "Watching" tab | The star and the tab are both in scope per the founder's brief. |
| 9 | `alert-gate.ts` split + `OPERATOR_WATCHLIST` rename | Small, and it prevents the §5.3 silent-failure bug before any fan-out exists to trip on it. |

Deliberately **not** in the day: email of any kind, password reset, the fan-out,
the outbox, the CSP nonce, per-symbol preferences, a public URL.

**Done means:** a tester registers, signs in, stars a company from a card and
from its page, sees it in "Watching", sees the unread count move when that
company files, signs out, signs back in, and finds the watchlist intact.

---

## 13. Follow-ons, in order

- **E — the exposure gate. Nothing goes public until every line is ticked.**
  Domain, Caddy with TLS, `trust proxy` = 1 hop, the four throttler buckets, the
  CSP nonce and security headers, `api/enrichment` behind the session, the email
  lane (verification + **reset** + non-enumerating registration, §2.5/§2.6), and
  one pass of `npm audit --omit=dev`.
- **F1 — email alerts**, coalesced at 15 minutes with a daily-digest option
  (§5.2). Brings `alert_outbox` and the fan-out with it.
- **F2 — durable delivery**, triggered when subscribers pass 100: the atomic
  `findOneAndUpdate` claim pattern `enrichment.repository.ts` already proves.
- **F3 — per-user preferences**: `minTier`, `mutedTopics`, quiet hours, and then
  the per-entry overrides the schema already reserves.
- **F4 — a real-time channel: web push and/or Telegram DM (Appendix B).** This is
  what restores the latency promise the product is built on; until it lands, the
  alerting must not be described to users as real-time.
- **F5 — a 30-second in-process session cache**, if the Watching tab's
  authenticated poll shows up in the numbers.
- **F6 — HIBP k-anonymity** on the password path, fail-open with a timeout.
- **F7 — TOTP 2FA.**
- **F8 — account deletion and data export.** Non-optional once real people have
  accounts; deliberately not day one.
- **F9 — a real NSE symbol master**, so a reader can watch a company before it
  has filed (M2).

---

## Appendix A — the auth providers not chosen (v2 alternatives)

Kept because the reasoning stays useful if the in-house path proves expensive.

**Firebase Authentication.** The genuine win is large and should not be
minimised: it outsources password storage, reset flows, email deliverability and
verification — the three things §2.2/§2.5 spend real effort on. Server-side
verification of ID tokens via `firebase-admin` is straightforward.

The blocking objection is specific rather than philosophical: the client SDK is a
**hosted script**, and `page.spec.ts` asserts
`expect(html).not.toMatch(/<script[^>]+src=/)`. Firebase's REST identity endpoints
can be driven from our own server without the SDK — but then Firebase is a remote
password database with a network hop on the login path, and most of the "it
handles email for you" benefit is retained while the "it handles the UI for you"
benefit is gone. The other route, relaxing the self-contained invariant for an
auth page only, means a second served document with its own shell and a
carve-out in a rule that has held everywhere else. Reconsider if the email lane
in §2.5 turns out to cost more than a day.

**Google OAuth directly.** No password, no email infra, good identity. But it
delivers **identity without a channel**, so the alert half of the product is not
shortened at all; and it adds a Cloud project plus a consent screen whose
verification for anything finance-adjacent is not instant. Worth adding later as
a *second* sign-in method next to email, where it costs one button and reduces
signup friction; not worth it as the only one.

**Telegram login.** Detailed in Appendix B, because its real value here was never
identity — it was arriving with a delivery channel attached.

## Appendix B — Telegram DM as the v2 channel

The parts that survive the founder's decision, kept because F4 will need them.

**Identity is not required to use the channel.** A user who already has an
account can bind Telegram as an additional channel: they open
`https://t.me/<bot>?start=<nonce>` from their settings, the nonce ties the
resulting chat to the account, and `alerts.channels` gains a `telegram` entry —
**no schema change**, which is what §5.4 exists to guarantee.

**Binding without inbound HTTP.** Receiving `/start` needs either a webhook or
`getUpdates`. A webhook is inbound HTTP and `apps/ingest` must never listen, so
it would have to live in the dashboard. `getUpdates` is an **outbound** call and
can therefore live in the ingest process without touching that invariant — one
bot token supports one or the other, not both. If neither is wanted, the login
widget's OAuth redirect (`oauth.telegram.org/auth`, a plain top-level navigation
with no third-party script, which is what keeps the self-contained rule intact)
returns the Telegram user id directly, and that id *is* the private-chat id; the
first DM either succeeds or returns 403 and the UI prompts for Start.

**The sender must change before any fan-out, and this is the sharp part.**
`TelegramService` today serialises **every** send behind one promise chain paced
at one message per second (`telegram.service.ts:136-144, 227-232`). That is right
for one chat and fatal for many. At 1,000 users × 50 symbols and the §4.3
bracket, steady state is **~10,200 DMs/day** — 10,200 seconds, **2.8 hours of
pure queue per day** — and the queue is shared with the operator channel, so an
`INGEST DEGRADED` alert would sit behind every user DM already queued. **The
pipeline's own outage alarm would be hours late at exactly the moment it
matters.**

Required changes:

- **Add `sendTo(chatId, text)`**; `send(text)` delegates to
  `sendTo(this.chatId, text)`. Zero changes at the three existing call sites.
- **One lane per chat** (`Map<chatId, Promise>`), keeping the existing 1 msg/s
  per-chat pacing, evicted when a lane drains — 1,000 permanent promise chains
  is a leak.
- **One global token bucket** at 25/s (under Telegram's ~30/s, with headroom).
- **A reserved slice for the operator**: 5/s reserved, 20/s for fan-out;
  operator may borrow idle fan-out capacity, fan-out may never touch the reserve.
  This is what stops a results-season storm from delaying an outage alarm.
- The bucket and scheduler are **pure functions over an injected clock**, tested
  without a network, exactly as `alert-window.ts` is.
- **403 is permanent per chat** (blocked, deactivated, never started): flip
  `deliverable: false` with the reason rather than retrying forever, or every
  blocked user costs one wasted API call per matching filing indefinitely.

With that in place the volume is comfortable:

| Scenario | Messages | At 25/s |
|---|---|---|
| Steady state, 1,000 users × 50 symbols | ~10,200/day; ~1,570/h over the ~6.5 h session | **0.44/s** |
| Peak measured minute (12 filings), ~26 watchers/filing | ~312 | **~13 s** |
| One mega-cap filing watched by 1,000 users | 1,000 | **40 s** |
| Peak measured hour (106 filings) | ceiling 90,000 | headroom to ~849 avg watchers/filing |
