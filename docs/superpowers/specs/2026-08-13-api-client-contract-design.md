# The API becomes a client-agnostic contract

**Status:** approved 2026-08-13. Implementation plan to follow.

This is the first of two specs splitting task #52. It covers the backend
contract: the credential, the CSRF boundary, the timezone guarantee and the
origin the browser talks to. **The React application gets its own spec**, once
production has a full trading day behind it, so a rewrite bug stays
distinguishable from a deployment bug.

Splitting was deliberate. Nothing here changes a rendered byte, so none of it
is gated on that trading day, and the API decisions below are precisely the
ones a modular client depends on.

## The goal

One backend that a browser, a phone and anything later can all speak to,
without any of them being privileged. Today the dashboard is server-rendered
and the API is an implementation detail of it. The point of this work is to
invert that: the API becomes the product, and the web app becomes its first
client rather than its owner.

## What already exists, measured before designing

Four findings changed the shape of this work. They are recorded because the
task's own plan assumed otherwise, and the assumptions cost nothing only
because they were checked first.

**The IST contract is already built.** Every timestamp-bearing response field
already ships a server-formatted companion beside the raw instant —
`announcedAtIst`, `disseminatedAtIst` (and a separate `disseminatedAtIstHuman`),
`ingestedAtIst`, `generatedAtIst`, `builtAtIst`, `lastFiledAtIst` — and
`dashboard.types.ts` already argues why they are separate fields rather than a
reformatting of one. No shipped client script formats a timestamp. Step 3 of
the task is therefore an **audit and a lock**, not a build.

**Bearer is a one-function change.** `SessionService.resolve()` and `.close()`
each read the credential at exactly one place, `readSessionCookie(request.headers.cookie)`.
The token beneath is already opaque, already `sha256`-at-rest, already
transport-agnostic.

**There is no CORS anywhere today**, and the bootstrap is well positioned for
the content-type work: `bodyParser: false` globally, with
`express.json({limit:'4kb'})` mounted on `/api/auth` alone.

**The admin panel decides nothing here.** `adminEnabled` is
`NODE_ENV !== 'production' && isLoopbackOrigin(publicOrigin)` — unreachable in
production by two independent conditions, not merely unshipped. It is out of
scope rather than an open question.

## Decision 1 — one opaque token, two transports

The session token stays exactly what it is: 256 bits of `randomBytes`, stored
only as `sha256`, with a 30-day TTL that **slides on use**. What changes is
delivery.

| Client | Transport | Where the token lives |
|---|---|---|
| Browser | `Set-Cookie`, `HttpOnly` | Nowhere the page can reach. JavaScript never sees it |
| Mobile | `Authorization: Bearer` | OS keychain |

The browser client never handles the token. Its entire auth implementation is
`credentials: 'include'` on each request — no storage, no header, no refresh
logic, no expiry handling. That is not a simplification for the client's
benefit; `HttpOnly` is, as `session-token.ts` puts it, "the control that
survives an XSS elsewhere", and a token the page can read is a token an
injected script can take.

### Why not a JWT, restated because it was asked twice

`session-token.ts` already carries the argument and it held up under
re-examination: every operation this product needs is a revocation, and a JWT
cannot do one. The two standard escapes are a denylist — a session store built
inside out — or a short expiry plus a refresh token, which is a session store
with rotation logic bolted on.

The decisive detail is that **JWT's only real benefit does not apply here**.
`resolve()` must read the user row on every request regardless, to confirm the
account still exists. Statelessness is unreachable, so a JWT would cost
signing, verification and rotation while collecting nothing.

### Why "short-lived and auto-refreshed" is already true

`slide()` extends the expiry on use, at most hourly to avoid one write per
poll per open tab. An active session never lapses; an idle one expires. That
is what a refresh token buys, without a second credential to protect or rotate.

The lifetime is a single constant, `DEFAULT_SESSION_TTL_DAYS = 30`. It stays
30. Shortening it trades real re-authentication friction — worse on a phone
than in a browser — for a benefit that instant revocation already provides. It
is one number, changeable the day a reason to change it exists.

### Also considered: Firebase ID tokens as the credential

Coherent, and rejected on two specific costs rather than on principle. Google
already handles authentication; this would have made it handle **sessions**,
with the SDK's one-hour auto-refreshing ID token verified per request and no
session store at all.

It fails here because `AUTH_MODE=local` cannot mint one. `e2e/session.ts`
registers a throwaway account through the real `POST /api/auth/register`, and
there is deliberately no test bypass in the server — so the Playwright suite
would lose its only way to sign in, and the escape is either a Firebase
emulator as a new dependency or two auth systems side by side.

The second cost is that it puts Google on the path of **every authenticated
request**. Today `POST /api/auth/firebase` performs that exchange once,
specifically so the rest of the application has one credential model and a
Google outage does not sign everyone out. On 2026-08-13 a blocked Google origin
broke production sign-in; that is the same dependency, moved from one page onto
every request.

## Decision 2 — CSRF defends ambient authority, so it keys on transport

This is the only change here where being wrong is a security regression rather
than a bug.

`OriginGuard` today refuses an absent `Origin` on all eight mutating routes,
and `origin-guard.spec.ts` justifies it precisely: *"a non-browser client has
no cookie this design would honour anyway."* That sentence is true today and
**false the moment Bearer exists** — a phone is a non-browser client that will
carry a credential we honour. Left alone the guard 403s every mobile mutation;
removed, cookie CSRF protection disappears.

The resolving principle: a browser attaches cookies by itself and never
attaches an `Authorization` header by itself. CSRF is an attack on ambient
authority, so the check belongs on the ambient transport.

| Layer | Applies to | What it stops |
|---|---|---|
| `Content-Type: application/json`, else **415** | all 8 mutating routes | A cross-origin form POST, which cannot produce that content type |
| CORS allowlist, never `*` | cross-origin requests | Who may preflight at all |
| `Origin` allowlist → 403 | **cookie-authenticated only** | Unchanged for the browser; skipped for Bearer |
| `SameSite=Lax` | the cookie | Unchanged |

### Why CORS cannot carry this alone

Verified against the dependency's own source rather than assumed. In
`node_modules/cors/lib/index.js`, the non-preflight branch is:

```js
} else {                                        // any non-OPTIONS request
  headers.push(configureOrigin(options, req));  // disallowed -> value: false
  applyHeaders(headers, res);                   // falsy header simply skipped
  next();                                       // unconditional
}
```

A disallowed origin is not rejected. It receives no
`Access-Control-Allow-Origin`, and the handler **runs anyway**. The browser
then hides the response from the attacker — after the mutation has already
happened. CORS is also enforced by the browser and by nothing else, so it is
worth zero against curl, a script, or a phone.

The 415 rule is what makes the rest sound. An HTML form can emit only
urlencoded, multipart or text-plain, so requiring `application/json` means a
form can never reach a mutating handler, and every remaining cross-origin
attempt is preflighted — the one branch where `cors` genuinely short-circuits
with `res.end()` before the request is sent.

**The sign-in routes are the case with no transport to key on.**
`POST /api/auth/{firebase,register,login}` carry no credential yet, so the
cookie-versus-Bearer rule cannot classify them. They are covered by 415 plus
the CORS allowlist, which is a complete defence for them precisely because it
does not depend on knowing who the caller is.

## Decision 3 — one origin for the browser, a subdomain for the phone

The session cookie is **host-only**: `attributes()` sets `Path=/`, `HttpOnly`,
`SameSite=Lax` and `Secure`, and no `Domain`. A host-only cookie set for
`disclosed.live` is **not sent to `api.disclosed.live`**. A React app calling a
different subdomain would therefore find itself silently signed out, and the
page would simply look logged out with nothing explaining why.

So the browser keeps talking to exactly one origin.

**The client is a fully static React SPA.** A build step emits HTML, JS and
CSS; nothing renders on a server, and no Node process runs for the frontend.

**It is served by the Caddy sidecar already running in the dashboard pod** — a
static file root for everything, `/api/*` reverse-proxied to Nest beside it.
No new component, no new hostname, one origin. The cookie is unchanged, CORS
does not apply to the browser path, and the CSRF layering above stays exactly
as it is today.

### Why not Cloudflare Pages, which was the first answer

Pages hosting the bundle with a Worker route forwarding `disclosed.live/api/*`
to the cluster is architecturally cleaner — independent frontend deploys AND
one origin AND no cookie widening. It was rejected on **measured request
volume**, not on principle.

`script-base.ts` sets `FAST_MS = 4000` with `SLOW_EVERY = 5`: a four-second
poll plus a second call every fifth cycle, about **1,080 requests per hour per
open tab**. Static assets on Pages are free and unlimited, so the bundle is
never the cost — but every `/api/*` call would be a billed Worker invocation.
The free tier's 100,000 per day is roughly eleven users with an eight-hour tab.

The money is small — around $5/month for a long time, and $0.30 per million
after. The objection is that it attaches a meter directly to a polling loop
task #60 exists to eliminate. Paying per request for requests we intend to stop
making is the wrong order to do things in.

**Sequencing that follows from this:** task #60 lands BEFORE the React client,
so the new app is written against the efficient contract rather than inheriting
a four-second poll and needing a second rewrite. Once it has, Pages plus a
Worker becomes cheap, and moving to it is a hosting change with no code change —
the app is the same static bundle either way.

**Also rejected: Pages plus `api.disclosed.live` with no Worker.** It costs
nothing and deploys independently, but it puts the browser cross-origin, which
forces the cookie to widen to `Domain=disclosed.live`. That makes the session
readable by every subdomain that will ever exist and rules out `__Host-`
prefixing, which requires no `Domain` attribute. A permanent security cost to
avoid a $5 bill is a bad trade.

### Constraint: Cloudflare stays on the free plan, at zero

A requirement, not an outcome, so it is written where a future editor will hit
it. **Nothing in this design may introduce a metered Cloudflare feature** — no
Workers, no Pages Functions, no Argo, no Load Balancing. Every Cloudflare
capability this product uses is free and stays free:

| Used for | Cost |
|---|---|
| DNS and the proxy/CDN in front of the cluster | Free plan |
| Universal TLS at the edge | Free |
| DNS-01 ACME for the cluster's own certificate | Free API access |
| CDN caching of the React bundle's static assets | Free, and a straight gain |

Serving the bundle from Caddy means the JS and CSS pass through Cloudflare as
ordinary cacheable static assets — edge-cached at no charge, which is most of
what Pages would have provided anyway.

The one rule that must not be relaxed: **`/api/*` is never cached at the edge.**
The Caddyfile already stamps `Cache-Control: private, no-store, max-age=0` on
`@api`, so an authenticated response cannot be stored and replayed to another
reader. Any future caching work — task #60 included — belongs behind the
session guard in the application, never in a shared edge cache.

`api.disclosed.live` is still built, with its own Ingress host rule against the
same pods and a certificate from the existing `letsencrypt-cloudflare` issuer.
Its first real consumer is **mobile**, where cookies are irrelevant and Bearer
is the answer. Paths stay identical rather than being rewritten, so there is
one URL space and no rewrite middleware — mildly redundant to read, and the
alternative is two ways to reach every route.

**Rejected: widening the cookie to `Domain=disclosed.live`.** It would work,
and the two hosts are same-site so `SameSite=Lax` would survive. The cost is
permanent: the session cookie becomes readable by every subdomain that will
ever exist, and each future one becomes a place the session can leak from. It
buys only what edge routing already gives us.

`CORS_ALLOWED_ORIGINS` still ships — comma-separated, never a wildcard, failing
closed on blank exactly as `isAllowedOrigin` already does — because it is what
a second first-party client, a staging build, or a local React dev server needs.
It is simply not on the production browser path.

## Decision 4 — the IST guarantee gets a lock, not a rewrite

No behaviour change. A spec walks the response DTO types and fails when a field
naming an instant has no `*Ist` companion.

This matters more with mobile, not less, and it is the failure mode with no
symptom: a phone in another timezone renders every filing at the wrong time and
looks entirely normal doing it. The guarantee currently holds by consistent
practice across four files, which is exactly the kind of thing that survives
until somebody in a hurry adds a fifth.

## The four changes

**A1 — Bearer transport.** One extractor returning
`{token, transport: 'bearer' | 'cookie'} | null`, tried Bearer-first, consumed
by `resolve()` and `close()`. Bearer wins when both are present: it is the
explicit credential, a browser cannot set it cross-origin without a preflight,
and cookie-first would let a stale cookie shadow a fresh token. Minting,
hashing, TTL and sliding are untouched.

**A2 — transport-aware `OriginGuard`**, per Decision 2, with the new reasoning
written where the old reasoning currently sits. Plus the 415 content-type
requirement on all eight mutating routes.

**A3 — the IST audit and lock**, per Decision 4.

**A4 — `api.disclosed.live`**: Ingress host rule, certificate, edge routing for
`/api/*` on the apex, and `CORS_ALLOWED_ORIGINS` configuration.

## What this contract owes the web client

Recorded here because these are API properties, and a client cannot be modular
if the API is not. They are requirements on A, verified by A's tests.

- **The envelope is uniform.** `{success, data, error, meta}` on every route
  including errors, so one client-side fetch wrapper handles every call and no
  feature module writes its own error handling.
- **Errors carry a stable machine-readable code**, not only prose. `ApiError`
  already works this way (`UNAUTHENTICATED`, `BAD_ORIGIN`); the contract is that
  a client branches on the code and displays the message, never the reverse.
- **Every response is self-describing for rendering.** Display strings —
  `amountDisplay`, `currentDisplay`, `announcedAtIst` — are computed server-side
  and shipped ready. A client that must compute a display value is a client that
  will compute it differently from the next client.
- **No route requires a client to know about another route** to interpret its
  response.

These make a feature-sliced frontend possible: each module owns its data
fetching against a uniform contract, and none of them shares formatting logic,
because there is none to share.

## Testing

TDD throughout, and the repo's gates are the bar: `npm test`, `npx tsc
--noEmit`, `npm run lint:ci`, and Playwright against a local `AUTH_MODE=local`
stack. Specifically required:

1. **Transport** — a request authenticating by cookie still resolves; the same
   token as `Authorization: Bearer` resolves to the same user; both present
   resolves via Bearer; a malformed header resolves to null rather than throwing.
2. **CSRF** — a cookie-authenticated mutation with a foreign `Origin` is still
   403; a Bearer-authenticated mutation with **no** `Origin` succeeds; a
   cookie-authenticated mutation with no `Origin` is still 403.
3. **Content type** — each of the eight mutating routes answers 415 to
   urlencoded, multipart, text-plain and a missing content type, and the 415
   fires before the handler runs.
4. **IST lock** — the DTO walk fails on a deliberately added raw instant field,
   proving the lock can fail before trusting that it passes.
5. **Regression** — the existing dashboard e2e suite passes unchanged, which is
   the real assertion that nothing broke.

## Out of scope

- **The React application.** Its own spec, after the trading-day gate.
- **The admin panel** — unreachable in production by two conditions.
- **The 7,707 lines of specs asserting the served document.** They are rewritten
  when there is a new artifact to assert about, not before.
- **Removing the cookie.** The browser keeps it; this is additive throughout.
- **Bundling the client script with esbuild.** Recorded in task #52 and
  explicitly not chosen: React deletes that code, and `script-fragments.spec.ts`
  already guards the failure class that has actually shipped.
