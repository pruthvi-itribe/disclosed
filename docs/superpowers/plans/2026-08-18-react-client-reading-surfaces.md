# React Client — Plan 2: The Reading Surfaces

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** The feed, the focus dialog, the company page and the Brief, rendered by
React at parity — element for element, `data-ui` for `data-ui` — from the same
API the server-rendered client polls today.

**Spec:** `docs/superpowers/specs/2026-08-14-react-client-design.md`.
**Builds on:** Plan 1 (merged): scaffold, bundle audit, `apiGet`/ETag store,
design tokens, dev proxy, CI, image stage.

## What is IN this plan and what is deliberately not

In: the poll loop, the filter state, the card, the day buckets, the hero, the
empty states, load-more, the focus dialog, the company page and all its
sections, the Brief deck with rail/pager/keyboard/tap-zones, the view switch,
and the ported stylesheets for all of it.

**Not in, and why that is not a parity loss yet:** the watch star, the two copy
controls (`card-copy`, `card-copy-image`, and the Brief's Copy), search/suggest
(`#search`, `#suggest`, `#search-note`, the `/` shortcut), and `api/me`. Those
are the account and share features — Plan 3, exactly as Plan 1's follow-on
table assigned them. Until Plan 3 lands, this client renders those controls'
containers without them, the same way the server-rendered page renders a
signed-out reader's card without the star. Parity is *proven* at Plan 4, when
the Playwright suite runs against the finished client; each intermediate plan
only has to be working, testable software.

The admin surface is excluded permanently (spec: unreachable in production by
two independent conditions; the server-rendered admin page stays for local
operator use).

## Source of truth

The port copies behaviour from these files, and every task below cites the
lines it ports. Where a constant carries a measured argument in a comment, the
argument moves with it — a ported number without its measurement is a guess
wearing a citation.

| Fragment | What it owns |
|---|---|
| `apps/dashboard/src/ui/script/script-base.ts` | `state`, helpers, `getJson` semantics, constants |
| `apps/dashboard/src/ui/script/script-poll.ts` | the 4s loop, `query()`, `refresh(force)`, staleness |
| `apps/dashboard/src/ui/script/script-views.ts` | `showView`, tabs, chips, `growFeed`, the 430px default |
| `apps/dashboard/src/ui/script/script-feed.ts` | `feedCard`, `feedBucket`, `renderFeedInto`, `FIGURE`, glyphs |
| `apps/dashboard/src/ui/script/script-cells.ts` | `renderSummary` (hero; the admin cells do not port) |
| `apps/dashboard/src/ui/script/script-icon.ts` | the drawings, `iconButton` |
| `apps/dashboard/src/ui/script/script-focus.ts` | the dialog |
| `apps/dashboard/src/ui/script/script-company.ts` | the sections |
| `apps/dashboard/src/ui/script/script-brief.ts` | candidates, ordering, the deck |
| `apps/dashboard/src/ui/page.ts` | the static shell every id above lives in |
| `apps/dashboard/src/ui/page-style.ts`, `page-style-brief.ts`, `page-style-focus.ts` | the stylesheets |

`docs/ui-components.md` is the name-by-name map and stays authoritative.

## Global constraints (Plan 1's, plus the ones this plan adds)

- **Parity.** Same `data-ui`, same ids where the old page had ids, same
  `data-seq`/`data-symbol`/`data-at`/`data-index`, same visible text, same
  hide/absent rules. The e2e suite keys on these; Plan 4 re-points it.
- **No formatting in the browser** except the three the old client already
  does: `relativeTime` (the documented exception — a difference between two
  instants is timezone-free and must move as the reader watches), `duration`,
  and `groupInt`. Every IST string prints as sent.
- **Absent, not empty.** `brief-rest` is null when there are no more claims,
  the topic pill is null when the claim has no topic, the source link is null
  when `safeHref` refuses, sections hide when nothing qualified. "Nothing was
  found" and "nothing was looked for" are different facts.
- **No `dangerouslySetInnerHTML`** (lint error since Plan 1). Exchange text
  reaches the DOM as React text nodes or not at all. Links only via `safeHref`.
- **`hasOwnProperty` discipline becomes `Map`/`Object.create(null)`.** Every
  lookup keyed by DB or document text (`DIRECTION_GLYPH`, dedupe signatures,
  by-symbol grouping) must not be a plain-object `in` — `constructor` is on
  every prototype and the key comes from the exchange.
- **Files under 300 lines, functions under 50.**
- Mirrored constants (label maps, glyph tables, regexes) carry a **mirror
  spec** comparing them against the server source file they were copied from,
  the way `tokens.spec.ts` already compares the palette. Drift fails the build
  with a message naming the source.

### Two structural decisions, made here because every task depends on them

**1. Types are imported, not generated.**
`apps/dashboard/src/filings/dashboard.types.ts` is a pure type module — zero
imports, zero runtime exports, 19 interfaces. The web client does
`import type { FilingView, SummaryView, ... } from` it by relative path,
re-exported once from `src/shared/types/api.ts` so features import from one
place. `import type` is erased at compile time: single source of truth, drift
impossible, and not one byte of server code in the bundle. A spec greps
`apps/web/src` and fails on any **non-type** import that resolves outside
`apps/web` — the type namespace is shared, the runtime never is.

**2. The ported stylesheets are global CSS, not CSS Modules.**
The spec's Decision 4 named CSS Modules, and this plan deviates with the
reasoning stated: the old client composes class names from **data at runtime**
— `tier-${confidenceTier}`, `g-${categoryGroup}`, `t-${topic}`,
`body.briefing` — and a module would hash exactly the names the data has to
hit. The stylesheets port **verbatim** into `src/shared/ui/*.css` (global,
side-effect imports, which Plan 1's tokens already proved survive the build),
class names untouched. This is also the parity-cheapest path: a renamed class
is a diff on every element. Scoping is not lost, it was never needed — the
document contains only this application.

**Baseline:** 5,713 server Jest tests and 48 web tests green at Plan 1's merge.

---

## File structure

| File | Responsibility | Task |
|---|---|---|
| `src/shared/types/api.ts` | one `import type` re-export of the server DTOs | 1 |
| `src/shared/types/type-only-imports.spec.ts` | no runtime import escapes `apps/web` | 1 |
| `src/shared/format/relative-time.ts`, `group-int.ts`, `duration.ts`, `safe-href.ts`, `describe.ts` | the helpers, ported with their arguments | 2 |
| `src/shared/format/vocab.ts` | `DIRECTION_GLYPH/LABEL`, `TIER_TITLE`, `TOPIC_LABEL`, `METRIC_LABEL`, `FIGURE` | 2 |
| `src/shared/format/vocab-mirror.spec.ts` | vocab matches the server fragments verbatim | 2 |
| `src/shared/ui/MarkedText.tsx` | `writeClaim` as a component: text nodes + `span.fig` | 2 |
| `src/shared/ui/icons.ts`, `IconButton.tsx`, `IconLink.tsx` | the drawings and the one-string label rule | 3 |
| `src/shared/api/filings-query.ts` | `query()` as a pure function of filter state | 4 |
| `src/shared/api/use-poll.ts` | the 4s loop: tick, visibility, staleness, failures, dispatch | 4 |
| `src/app/filter-state.ts` | the reducer: every filter writer and its offset-reset rule | 4 |
| `src/features/feed/insight-lines.ts`, `feed-bucket.ts` | the pure logic, unit-tested first | 5 |
| `src/features/feed/FeedCard.tsx`, `FeedGrid.tsx`, `Hero.tsx`, `LiveIndicator.tsx` | the card, the grid with day dividers, the three numbers, the dot | 5 |
| `src/features/focus/FocusDialog.tsx`, `focus-lines.ts` | the dialog | 6 |
| `src/features/company/*.tsx` (Head, Figures, Next, Marks, Topics, Plans) | the sections, one file each | 7 |
| `src/features/brief/brief-model.ts` | candidates, lede, ordering, signature — pure | 8 |
| `src/features/brief/BriefDeck.tsx`, `BriefCard.tsx`, `BriefRail.tsx`, `BriefPager.tsx` | the deck | 8 |
| `src/app/App.tsx`, `view-state.ts`, `TopBar.tsx` | the view switch, tabs, `body.briefing` | 9 |
| `src/shared/ui/page.css`, `brief.css`, `focus.css` | the stylesheets, ported verbatim | 5, 6, 8 |

---

### Task 1: The shared types

**Files:** `src/shared/types/api.ts`, `src/shared/types/type-only-imports.spec.ts`

- [x] Write the failing spec: read every `src/**/*.{ts,tsx}` file, regex the
  import statements, and fail on any import whose specifier resolves outside
  `apps/web` that is not `import type`. Plant both cases in fixtures strings to
  prove the regex sees them.
- [x] `api.ts`: `import type` + `export type` for the DTOs the reading surfaces
  consume: `FilingView`, `SummaryView`, `FilingsMeta` (or the actual meta
  shape), the enrichment/claim/results types they reference. Header comment:
  why imported not generated (erased at compile; drift impossible; the guard
  spec bounds the direction of the dependency).
- [x] `npx tsc --noEmit` in `apps/web` must pass — the compiler follows the
  relative import outside `include`, which is the mechanism working.
- [x] Commit: `feat: share the server's response types by type-only import`

### Task 2: Format helpers and vocabulary

**Files:** the five helpers, `vocab.ts`, `vocab-mirror.spec.ts`, `MarkedText.tsx` + specs

Ported **verbatim** from `script-base.ts` / `script-feed.ts`, arguments
included. The doubled-backslash sharp edge dies here — these are real modules
now, `FIGURE` is written once with single escapes, and the mirror spec
normalises the server fragment's doubling when comparing.

- [x] Failing tests first, one file per helper. The load-bearing cases:
  - `relativeTime`: the full ladder (`just now` &lt; 45s, `a minute ago` &lt; 90s,
    `N min ago`, `Nh Mm ago`, `yesterday`, `N days ago`, `Nw ago`); NaN input
    returns the raw string (debuggable, not a lie); nullish returns `—`.
  - `safeHref`: http/https pass; `javascript:`, relative garbage that throws,
    empty, non-string → `null`.
  - `groupInt`: thousands grouping (not lakh/crore); nullish → `—`.
  - `duration` ladder and `lagClass` thresholds (120000 / 1800000, with the
    ok/warn/bad meaning stated).
  - `describe`: falls back to the key; a key named `constructor` must not
    return a function.
  - `MarkedText`: figures wrapped in `span.fig`, currency mark and scale word
    captured with the number, a match with no digit skipped, direction words
    NOT matched, and the no-spin guard (regex `lastIndex` advances).
  - `vocab-mirror.spec.ts`: `DIRECTION_GLYPH` (`▲ ▼ ◆`, **no `unrated` key**),
    `DIRECTION_LABEL` (`increase printed` — the document's act, never the
    company), `TIER_TITLE`, `TOPIC_LABEL`, `METRIC_LABEL` each equal the
    table in the server fragment they mirror, read from the fragment source at
    test time.
- [x] Implement. Glyph/label lookups take `Map`s.
- [x] Commit: `feat: port the format helpers and the vocabulary, mirrored`

### Task 3: The icons

**Files:** `src/shared/ui/icons.ts`, `IconButton.tsx`, `IconLink.tsx` + specs

- [x] Failing tests: `IconButton` renders `button.iconbtn[data-ui]` with
  `aria-label` and `title` **from one string**; the svg carries
  `aria-hidden="true"` and `focusable="false"`, `viewBox` from `ICON_BOX=24`,
  size 17, stroke 1.7, `stroke=currentColor fill=none`; `IconLink` renders
  `a.iconbtn` with `rel="noopener noreferrer nofollow" target="_blank"`.
- [x] Port the shape tables verbatim from `script-icon.ts` (`ICON_STAR`,
  `ICON_COPY`, `ICON_IMAGE`, `ICON_SOURCE`, `ICON_DONE`, `ICON_FAIL` — all
  six now; Plan 3 consumes the rest without touching this file). Keep the
  header's measurement: four words took 240px of a 326px footer at 390px;
  four 34px drawings take 160px.
- [x] Commit: `feat: port the icon drawings and the one-string label rule`

### Task 4: Filter state and the poll

**Files:** `src/app/filter-state.ts`, `src/shared/api/filings-query.ts`, `src/shared/api/use-poll.ts` + specs

The old client's `state` splits three ways: **filter state** (topic, plans,
onlyInsights `true` by default, q, symbol, picked, limit 25, offset), **view
state** (Task 9), and **poll state** (ticks, failures, live kind) which lives
inside the hook. `todayIstDay`/`previousIstDay` ride the summary response.

- [x] Failing tests for the reducer — every writer's reset rule from the
  survey: a topic click writes **both axes** and zeroes offset; only-insights
  zeroes offset; `growFeed` steps through `[25,50,100,200,500]` to the first
  step **greater than** limit, does NOT zero offset, and no-ops at 500;
  `openCompany` zeroes offset.
- [x] Failing tests for `filingsQuery(filters, view, company)` — the priority
  order ported from `query()`: company → `limit=200&offset=0&symbol=` (every
  feed filter ignored; "200 is roughly ten months of the heaviest measured
  filer"); brief → `tier=verified&offset=0&limit=200` (`BRIEF_WINDOW`; a
  verified IST day is 326–463 filings, the cover states the window);
  otherwise limit/offset always, `tier=verified` iff `onlyInsights && !tier`,
  then q, symbol, topic, `plans=only` — all URI-encoded.
- [x] Failing tests for `usePoll` (fake timers, fetch double via Plan 1's
  `apiGet`): 4000ms cadence; hidden tab ticks nothing and a
  `visibilitychange` back fires a forced refresh; a superseded response is
  dropped whole (the `current()` seam Plan 1 built); 304 keeps last data and
  reports `live`; failure increments a counter — `stale` at 1–2, `down` at
  3+, message `Refresh failed (N in a row): ...`; success resets it; 401
  calls `onSessionEnded` once (the latch); summary and filings ride **one**
  cycle; every filter/view change refreshes immediately (the old client's
  `refresh(true)` on every tab and chip).
- [x] Implement. The hook returns
  `{ filings, meta, summary, live, error, refresh }` — data stays put on 304,
  which is what makes React's reconciler the signature-skip successor: no new
  state, no re-render, scroll and selection untouched.
- [x] Commit: `feat: the filter reducer, the query builder and the poll hook`

### Task 5: The feed

**Files:** `insight-lines.ts`, `feed-bucket.ts`, `FeedCard.tsx`, `FeedGrid.tsx`, `Hero.tsx`, `LiveIndicator.tsx`, `page.css` + specs

- [x] Pure logic first, failing tests then port:
  - `insightLines`: results line first with no direction ("a results line has
    no direction of its own and never will"), echoes skipped **as headlines
    only**.
  - `feedBucket(istDay, iso, today, previous)`: `Just now` inside 30 minutes
    with the `ms >= 0` future-stamp guard, `Earlier today`, `Yesterday`, else
    the server's day string verbatim; **no date arithmetic** — assert the
    module source contains no `getDate`, `getTimezoneOffset`, `toISOString`,
    `86400000` (port of `script-feed.spec.ts:135`); both buckets null before
    the first summary → every filing named by its day.
- [x] `FeedCard` failing tests — the DOM contract, exactly:
  `article.card[data-ui="card"][data-seq][data-at]`, `.quiet` + `p.stated
  [data-ui="card-outcome"]` when no lines; `.openable`, `tabIndex=0`,
  `aria-haspopup="dialog"`; head with `button.sym` (opens company,
  stopPropagation), `span.coname`, `span.when` (relativeTime, IST string in
  `title`), group tag; `ul.insights[data-ui="card-claims"]` capped at
  `CARD_CLAIMS = 2` (the 1440px void measurement moves with it) with
  direction marks (`span.dir[data-direction]`, `aria-label`, evidence in
  `title`); `button.andmore[data-ui="card-more"]` = `+ N more` → opens focus,
  **no in-card expansion, no expanded state** — `state.expanded` was removed
  and must not be reintroduced; foot with tier, category, and the source
  `IconLink` only when `safeHref` passes. Card click opens focus unless
  `target.closest('a, button')`; keyboard opens on **Enter only** and only
  when the card itself has focus.
- [x] `FeedGrid` failing tests: day-divider `h2.bucket` inserted when the
  bucket label changes; cards keyed by `seqId` (the reconciler's version of
  "pin by data-seq, never position"); the two empty states with their exact
  sentences (`Nothing verifiable yet` under only-insights, else `No filings
  match`); `#feed-info` = `shown of total`; `#feed-more` hidden when
  `!hasMore` or at the 500 cap, the cap note appended when capped with more;
  `#dir-legend` hidden when no rendered claim carries a mark (23.2% of claims
  do — the one count the browser still performs); IntersectionObserver on the
  more-button sentinel with `rootMargin: '200px'`, inert when the button is
  hidden or the view is not the feed.
- [x] `Hero` + `LiveIndicator` failing tests: `hero-today` ←
  `todayCount`, `hero-insights` ← `todayVerified` (server-computed — the
  browser-counted version shipped "8 filings today" beside "22 verified
  insights"), `hero-lag` ← `duration(feedLagMs)` + `lagClass`; live dot
  kinds and `generated` = `updated {generatedAtIst} IST` printed as sent.
- [x] Relative times tick without a rebuild: one 60-second interval at the
  grid, cards `memo`-ised on their filing + bucket; the tick re-renders only
  `.when` text — the React equivalent of `touchFeedTimes`, and the reason
  `relativeTime` stayed out of the old signature.
- [x] Port the feed's rules from `page-style.ts` into `page.css` verbatim
  (minus admin-only selectors, which are recorded in the file header as
  deliberately left behind).
- [x] Wire into `App` behind the poll hook; **prove against the real server**
  through the dev proxy: cards render, buckets label, 304 keeps scroll.
- [x] Commit: `feat: the feed at parity`

### Task 6: The focus dialog

**Files:** `FocusDialog.tsx`, `focus-lines.ts`, `focus.css` + specs

- [x] Failing tests:
  - `focusLines` returns **every** claim including echoes ("one filing opened
    on purpose cannot omit a sentence"), uncapped.
  - Structure: `#focus-back[hidden]` &gt; `#focus[role="dialog"]
    [aria-modal="true"][aria-labelledby="focus-symbol"]`; head symbol/name/
    when; `focusresults` line when present (monospace, nowrap); `focus-stated`
    = `outcome` when no lines; else `[data-ui="focus-claims"]` with marks and
    figures; per claim a `[data-ui="focus-spans"]` box, **hidden by default**,
    behind one `[data-ui="focus-span-toggle"]` (`Show source line`/`Hide`,
    `aria-expanded`, toggle **before** the box in tab order); span and
    periodSpan as two quotes never merged; quotation marks as text.
  - Foot: tier, category, source link (watch/copy arrive in Plan 3).
  - Behaviour: open snapshots the filing — a poll repaint must not change an
    open dialog (the component holds the filing it was opened with, not a
    seqId lookup into live data); close on Escape (document-level), on the
    close button, and on backdrop click **only when the target is the
    backdrop itself**; close **unmounts** — spans forget their state and
    nothing stays in the document on a shared screen; focus goes to
    `#focus-close` on open and back to the opener on close; Tab is trapped
    manually across `button, a[href], input, [tabindex]:not([tabindex="-1"])`
    (`aria-modal` is a claim the page must honour).
- [x] Two-phase open: `hidden=false` on commit, `.open` on the **next frame**
  (`requestAnimationFrame` in an effect) — both in one commit skips the
  transition, the exact recorded bug.
- [x] Port `page-style-focus.ts` verbatim, including the 560px bottom-sheet
  block with `max-height: 92dvh` (at 92**vh** the close button was
  unreachable on a phone, 2026-08-13) and the reduced-motion block.
- [x] Commit: `feat: the focus dialog at parity`

### Task 7: The company page

**Files:** `CompanyView.tsx`, `CompanyHead.tsx`, `Figures.tsx`, `NextUp.tsx`, `Marks.tsx`, `TopicMix.tsx`, `PlansList.tsx` + specs

Fed by the same poll (`symbol=` window of 200); every section computes its own
"anything to show" and the wrapper hides on false — drawn first, hidden after,
so the condition lives in one place.

- [x] Failing tests, per section, with the survey's rules verbatim:
  - Head: identity; industry tag hidden without a value; the `co-industry-
    source` BSE mark only when `industrySource === 'bse'`; hero numbers
    (`co-verified` counted over the window client-side as today); coverage
    line with singular/plural day.
  - Figures: dedupe key = period + basis + every `metric:current:prior:unit`
    **in order** — content, not quarter, so a restatement draws two blocks
    and a repeated table draws one (VIJAYA is the live case); values are
    `currentDisplay`/`priorDisplay` printed as sent, `vs` and never an arrow;
    span quotes in `title`.
  - What's next: `commitments` from the server only (IST rolls at 18:30 UTC —
    the browser must not decide "still ahead"); one entry per
    date + lowercased evidence; date asc, word asc tie-break.
  - Marks: one row per IST **day**, items walked oldest-first; glyphs from
    the shared vocab (no `unrated` key draws nothing); **nothing counted, no
    colour** (13 of 45 printed decreases are falling bad loans, debt,
    borrowing costs or emissions); evidence in `title`.
  - Topic mix: claims counted with null topic under `other` (the bar must
    sum); **floor `MIN_TOPIC_CLAIMS = 4`** with its sweep (floor 4 → 257
    companies, 90% multi-topic); count-desc name-asc order so a repaint
    cannot reorder equals; top-3 legend.
  - Plans: `planEvidence` guard, echoes skipped, quotes **`span`** never
    `text` (the span is the document's bytes, the text is the extractor's
    compression), deciding words in `title`, newest first, uncapped, no floor.
  - The company feed: `FeedGrid` without chrome — no info/more/legend.
- [x] Implement; the section notes are static children with their
  `company-*-note` names.
- [x] Prove against the real server through the dev proxy on a symbol with
  figures and one with none.
- [x] Commit: `feat: the company page at parity`

### Task 8: The Brief

**Files:** `brief-model.ts`, `BriefDeck.tsx`, `BriefCover.tsx`, `BriefCard.tsx`, `BriefEnd.tsx`, `BriefRail.tsx`, `BriefPager.tsx`, `brief.css` + specs

- [x] `brief-model.ts` failing tests first — this is the honesty core and it
  is pure:
  - candidates grouped by symbol (`Map`), a claim travelling **with its
    filing**; `hasResults`; `figures` counted by `/\d/` over claim text (an
    ordering key over our evidence, not a figure parser); newest by string
    compare; candidates whose every claim is an echo dropped.
  - lede = first non-echo claim.
  - ordering: hasResults, figures desc, claim count desc, newest desc, then
    **symbol asc — the tie-break that stops equal candidates swapping under a
    reader's thumb on a repaint**.
  - `BRIEF_MAX_CARDS = 12` (a deck is ~54s at 4.5s a card; 15 breaks the
    rail's promise), `BRIEF_MIN_CARDS = 3`, `BRIEF_REST_CLAIMS = 2`.
  - signature = `symbol:seqId` joined — the deck rebuilds only when it
    changes (React: the deck's children are memoised on this signature;
    twelve full-viewport cards must not be replaced under a thumb).
- [x] Component failing tests:
  - Cover (fed by the **summary**, so card 0 costs no request): `brief-day`,
    the mix bar (flexGrow = count, zero groups skipped, count-desc name-asc),
    the cover line's two sentences, the rule line ending in `BRIEF_RULE` —
    ported verbatim, "ranking" appears nowhere.
  - Card: `article.bcard[data-ui="brief-card"][data-symbol][data-seq]
    [data-index]`, `role="group"`, `aria-label="Card N of M, SYMBOL"`,
    `tabIndex=-1`; ident with symbol button → company, name, `bwhen` = the
    IST string whole; lede through `MarkedText` at 25px; `brief-rest`
    **null** when empty (echoes kept here — skipped only for the lede);
    `+ N more from SYMBOL` → company, never an expander (a card that grows
    stops being one viewport); topic pill **null** on a null topic (not
    `other` — a single card has no sum), whose click sets topic + offset
    **but not plans** — a recorded asymmetry with the chip row, preserved
    deliberately; foot with tier, category, source link (Copy is Plan 3).
  - End card: the two remainder sentences; `brief-to-feed` → feed.
  - Empty: `brief-empty` shown instead of the deck, with the window count.
  - Rail: one segment per company card only ("a rail lighting for the cover
    would promise thirteen cards where there are eleven"), hidden below 3,
    cumulative `.on` fill; driven by an IntersectionObserver
    (`root: deck, threshold: 0.6`) reading `data-index` off the node —
    derived from scroll, never a counter.
  - Stepping: `briefStep` walks card starts with 4px tolerance and calls
    `scrollIntoView` + `focus({preventScroll: true})`; keyboard on the deck
    (down/right/PageDown/Space forward, up/left/PageUp back, modifiers
    exempt); tap zones on the across axis only, outer thirds, skipping
    clicks on controls and clicks that end a text selection; pager above
    900px, disabled at the ends, syncing from scroll.
  - The axis is read from `getComputedStyle(deck).scrollSnapType` — the
    stylesheet answers, so the 900px breakpoint exists in exactly one place.
- [x] Port `page-style-brief.ts` verbatim: `body.briefing` with the
  **child-combinator** footer rule, `dvh` not `vh`, the 431/900/reduced-motion
  blocks, the one-auto-margin rule.
- [x] Prove on the real server at phone width and at ≥900px.
- [x] Commit: `feat: the Brief at parity`

### Task 9: The view switch and the shell

**Files:** `view-state.ts`, `TopBar.tsx`, `App.tsx` rewrite + specs

- [x] Failing tests: three views this plan owns (`brief`, `feed`, `company`;
  watching and admin tabs are Plan 3/never); exactly one visible; **no tab
  lit while company is open** (reached from a card, not a tab); leaving
  `company` clears the company symbol; `body.className = 'briefing'` iff
  brief (one class on the body, so exactly one view is ever in scroll-lock);
  every tab switch triggers an immediate refresh (the deck asks the server a
  different question); initial view = brief at ≤430px, **read once, never
  watched** (a rotated phone must not swap the view under a reader);
  `company-back` returns to the feed.
- [x] Replace Plan 1's status-line `App` body with the real shell: TopBar
  (brand, tabs, live indicator, `#generated`), `#alert`, the view sections.
  The `/api/summary`-count smoke behaviour from Plan 1 is superseded; its
  spec is replaced by the shell's.
- [x] Full manual pass against the real server through the dev proxy: feed →
  card → focus → close; ticker → company → back; tab → brief → deck →
  keyboard/pager; kill the server and watch stale → down; restart and watch
  it recover.
- [x] Commit: `feat: the shell — three views, one poll`

### Task 10: Gates

- [x] `npm --prefix apps/web test` — everything above green.
- [x] `npm --prefix apps/web run build && npm --prefix apps/web run audit` —
  the audit already runs in CI and the image; nothing new to wire, it just
  has to stay clean now that real surfaces exist.
- [x] `npm test`, `npm run lint:ci`, `npx tsc --noEmit -p tsconfig.json` —
  the server untouched.
- [ ] PR; the four gates green; auto-merge.

---

## The port traps, restated as rules

From the survey of the old client — each of these is a recorded bug or a
deliberate behaviour the port must not lose:

1. React's keyed reconciliation replaces `feedSignature`/`briefSignature` as
   the *mechanism*, but the **contract** stays: unchanged data must cause zero
   DOM mutation (304 → same state object → no render), and card identity is
   `seqId`. The idle rebuild this killed created 28,237 nodes a minute.
2. `relativeTime` never enters render-triggering data. A 60s tick repaints
   `.when` text only.
3. The focus dialog is a **snapshot**, lives outside the polled tree, and
   unmounts on close (privacy on a shared screen; spans forget).
4. Two-phase open (`hidden` then `.open` next frame) or the transition
   silently dies.
5. The Brief's axis question is answered by the stylesheet
   (`scrollSnapType`), never by a media-query hook — one breakpoint, one
   place.
6. Scroll position is the single source of truth for rail, pager and step —
   no card index in state.
7. `briefTopic` sets topic but not plans; the chip row sets both. Asymmetric,
   deliberate, preserved.
8. Every lookup keyed by exchange-derived text goes through `Map` /
   `Object.create(null)`.
9. Nothing here reintroduces `state.expanded`, in-card growth, colour on
   direction marks, counts of marks, or any derived arithmetic. The verbatim
   gate binds the client too.

## The follow-on plans (unchanged)

| Plan | Delivers |
|---|---|
| **3 — the account surfaces** | `api/me`, watch star + Watching view, search/suggest, share text + image, landing, auth page. |
| **4 — cutover** | Caddy serves `dist/` behind `WEB_CLIENT=react`; Playwright re-pointed and run against both builds; rollback is the variable. |

## Out of scope for Plan 2

Everything Plan 3 owns (above); the admin surface (permanently); routing;
mobile; deleting anything; any visual change.
