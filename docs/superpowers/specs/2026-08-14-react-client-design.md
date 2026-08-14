# The React client

**Status:** approved 2026-08-14. Implementation plan to follow.

Sub-project B of task #52. Sub-project A — the API as a client-agnostic
contract — shipped on 2026-08-14 and is live in production.

## The goal, and what is deliberately not in it

Replace ~11,900 lines of TypeScript that build HTML, CSS and client script as
template literals with a static React application, **at parity**. No feature
changes, no new surfaces, no redesign. A reader must not be able to tell which
one they are using.

Parity is the whole discipline here. A rewrite that also improves things cannot
be verified, because every difference becomes an argument about whether it was
intended. A rewrite that changes nothing can be checked against the old one.

## Why now, and what unblocked it

Two gates, both cleared:

- **Production has seen a full trading day.** The condition task #52 set, so a
  rewrite bug stays distinguishable from a deployment bug. Production has run
  since 13 Aug 10:58 IST and covered Friday 14 Aug's whole session.
- **Task #60 landed first, deliberately.** An unchanged feed now answers 304
  with a zero-byte body instead of 41 KB. Had the client been written before
  that, it would have inherited a four-second full-payload poll and needed a
  second rewrite.

## The surfaces, which is what parity means

From `docs/ui-components.md` and the code:

| Surface | Today | In the React client |
|---|---|---|
| Feed | `script-feed.ts`, `script-cells.ts` | yes |
| The Brief (deck) | `script-brief.ts`, `page-style-brief.ts` | yes |
| Company page | `script-company.ts` | yes |
| Focus modal | `script-focus.ts`, `page-style-focus.ts` | yes |
| Watching | `script-account.ts` | yes |
| Search / suggest | `script-suggest.ts` | yes |
| Share text + image | `script-share.ts`, `script-share-image.ts` | yes |
| Landing | `landing.ts` | yes |
| Auth page | `auth-page.ts`, `auth-script.ts` | yes |
| **Admin** | `script-admin.ts` | **no — see below** |

**Admin is excluded, and it is not a parity loss.** `adminEnabled` is
`NODE_ENV !== 'production' && isLoopbackOrigin(publicOrigin)` — unreachable in
production by two independent conditions, and absent from the served document
there. No reader has ever seen it. Porting 593 lines for a surface that never
ships is work with no recipient. The server-rendered admin page stays exactly
where it is for local operator use, and the React client simply does not
contain it. This is the one place the old UI outlives the new one, and it is
recorded so nobody treats it as an oversight.

## Decision 1 — no router, because there is nothing to route

The current client uses **no URLs at all**: no `pushState`, no `replaceState`,
no hash, no query parameters. Verified by search across every client fragment.
The server serves exactly two HTML documents, `GET /` and `GET /auth`, and
every view — feed, brief, company, watching, focus — is client state.

So the React client has view state and no routing library. Adding deep links
would be a genuine improvement and is a **feature change**, which this project
excludes. It is cheap to add later precisely because the client is a static
bundle; recorded as a follow-on rather than smuggled in.

## Decision 2 — the fetch layer is ours, not a data library

The polling behaviour is small, already carefully reasoned, and carries three
properties a general-purpose data library would have to be configured not to
break:

- **ETag revalidation with the validator in memory only.** `/api/*` is
  `Cache-Control: private, no-store` — an authenticated response may never be
  stored — so this is the application revalidating explicitly, never the
  browser caching, and never `localStorage`.
- **Only strong validators are stored.** Express tags every response `W/"..."`;
  sending `If-None-Match` indiscriminately would make every GET start 304-ing,
  including views whose renderers never expected one.
- **A staleness sequence.** Responses do not arrive in the order requests were
  sent, so a poll sent before a ticker click can land after it and paint the
  feed as that company's filings. The existing client claims a sequence number
  before dispatch and drops any response that is no longer current.

Plus: a 401 means a session that ended under an open tab, answered by reloading
into the landing page rather than by rendering a red banner every four seconds.

TanStack Query would be the reflexive "best practice" answer and is rejected
for this: its value is caching, deduplication and background refetch, and the
first of those is the thing we are contractually forbidden from doing. What
remains after configuring it away is a subscription wrapper around roughly
eighty lines we would still have to write. One `useFilings`-shaped hook over an
explicit `apiGet` is smaller, and every one of the properties above is visible
in it rather than encoded in options.

## Decision 3 — the self-contained invariant becomes a bundle audit

`page.spec.ts`, `landing.spec.ts` and `auth-page.spec.ts` assert properties of
the SERVED DOCUMENT: no `https?://` except one XML namespace passed to
`createElementNS`, exactly one `<link>` (the inlined `data:` favicon), no CDN,
no web font. Those specs do not port — there is no served document to read.

They are replaced by an audit of the BUILT OUTPUT, which is a stronger check
rather than a weaker one. Asserting the document only bounds what we wrote; the
production CSP incident on 2026-08-13 happened precisely because a third-party
script fetched two Google origins at runtime that appeared nowhere in the HTML.
An audit over `dist/` sees what the bundler actually emitted, including a
transitive import that would fetch at runtime.

The audit asserts, over every emitted asset:

1. No absolute `http(s)` URL, except the XML namespace and — in firebase mode
   only, on the landing and auth entry points — the pinned `gstatic.com` SDK
   the two signed-out surfaces already load.
2. Exactly one `<link>` in the emitted HTML, the inlined `data:` favicon.
3. No `@font-face` with a remote `src`, and no external stylesheet.
4. No `fetch`/`XMLHttpRequest` to an absolute origin.

The CSP in `Caddyfile` stays the runtime enforcement. The audit is what fails
the build before anyone deploys.

## Decision 4 — structure, and the rules that keep it

```
apps/web/
  index.html                 the one entry document
  src/
    app/                     bootstrap, providers, the view switch
    shared/
      api/                   apiGet, apiSend, the ETag store, the 401 rule
      ui/                    primitives with no product knowledge
      types/                 generated from the server's response DTOs
    features/
      feed/  brief/  company/  focus/  watching/  search/  share/  account/
```

**A feature owns its data, its components and its tests, and imports from
`shared/` only.** No feature imports another feature. Where two need the same
thing — the focus modal and the company page both draw a claim — the shared
piece moves to `shared/ui`, which is the signal that it was never a feature's
own.

**Rules, each with a reason rather than a preference:**

- **No formatting in the browser, ever.** The API ships `announcedAtIst`,
  `amountDisplay`, `currentDisplay` already formatted; a component renders the
  string it is handed. This is the IST invariant, and `ist-contract.spec.ts`
  already fails the build if a response instant loses its companion. A phone in
  another timezone that formatted its own would render every filing at the
  wrong time and look entirely normal doing it.
- **No `dangerouslySetInnerHTML`.** Exchange text is untrusted; React escapes by
  default and that default is the whole defence. A lint rule forbids it.
- **Links only through a `safeHref` helper**, as today.
- **Files under 300 lines, functions under 50.** Tighter than the repo's 800,
  because a component file that large is several components.
- **Every component is a function of props.** No component fetches; hooks in
  `features/*/api` do, so a component test needs no network and no mock server.

**Style guide:** TypeScript strict, the repo's existing ESLint and Prettier
extended with `eslint-plugin-react-hooks` and `jsx-a11y`. CSS Modules — zero
runtime, scoped by default, and it keeps the existing hand-written CSS portable
rather than rewriting 2,400 lines into another paradigm. Tailwind is refused:
it would make the port a rewrite of the styling as well as the structure, and
double the surface on which parity has to be argued.

## Decision 5 — how it ships, and how it is backed out

Vite builds a static bundle into `apps/web/dist`. The Caddy sidecar already in
the dashboard pod serves it, with `/api/*` reverse-proxied to Nest beside it —
same origin, so the cookie is untouched, no CORS on the browser path, and the
CSRF layering from sub-project A holds unchanged. The React client's entire
auth implementation is `credentials: 'include'`.

**Both UIs coexist until parity is proven.** Caddy serves the React bundle only
when `WEB_CLIENT=react`; otherwise it proxies `/` to Nest exactly as it does
today. The switch is one environment variable, the rollback is the same
variable, and neither is a code change or an image build.

The server-rendered UI is deleted in a **separate, later commit**, once the
React client has served production traffic. Deleting it in the same change
would mean the rollback is a revert of the rewrite rather than a flag.

## Testing

The bar is the repo's: `npm test`, `tsc --noEmit`, `lint:ci`, and Playwright
against a real `AUTH_MODE=local` stack.

- **Unit** — Vitest and React Testing Library, per feature. Components are
  functions of props, so these need no network.
- **The fetch layer** — its own suite, against a fetch double: a 304 does not
  re-render, a weak validator is not stored, a stale response is dropped, a 401
  reloads once and not in a loop.
- **The bundle audit** — Decision 3, run against `dist/` in CI.
- **Parity, and this is the load-bearing one.** The existing Playwright suite is
  the specification of what the product does. It runs against the React client
  with its assertions unchanged wherever they describe behaviour rather than
  markup. Selectors that pin server-rendered structure are re-pointed at the
  same `data-ui` and `data-seq` attributes, which the React components carry
  for exactly this reason. **A parity claim is that suite passing against both
  builds, not a screenshot comparison.**

## Out of scope

- Deep links and routing — a feature change, recorded as a follow-on.
- The admin panel — dev-only, stays server-rendered.
- Mobile — its own project, consuming `api.disclosed.live` with Bearer.
- Deleting the server-rendered UI — a later commit, after production traffic.
- Any visual change. If the React client looks different, that is a bug.
