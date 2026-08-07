# The Brief: the day's signal in under a minute, on a phone

**Status:** design, measured 2026-08-08 against the live collection. Not built.
**Problem:** the dashboard is honest and text-heavy. The reader we are now
designing for scrolls fast, decides in seconds, and reads on a 390px screen.
The founder's words: *"hardly has time to sit and read things but much better
way to consume this information."*

Two things are unsolved:

1. **A graphical representation of a company and its stream of updates.**
2. **A consumption model where a reader gets the day's signal in under a minute.**

This document proposes three directions for (2), argues them against each
other, picks one, and specifies it. (1) is answered as a consequence: the
per-company graphic that survives the argument is the *card*, not a chart.

---

## 0. The numbers this design stands on

Every figure below came from a query run against `mongodb://localhost:27117/turret`
on 2026-08-08, not from a source comment. The precedent for the distinction is
in `2026-08-07-company-page-and-widgets.md`, which was wrong by 7.6× the one
time it quoted a comment instead of measuring.

### Corpus shape

| Fact | Value |
|---|---|
| Filings held | **3,451** |
| Distinct companies | **1,218** |
| IST days covered | 3 (2026-08-05 → 2026-08-07) |
| Filings per IST day | 1,009 · 1,156 · 1,286 |
| Distinct companies filing per day | 571 · 591 · 659 |
| Enriched (a model read the document) | 3,077 (89.2%) |
| Filings with ≥1 verified claim | **1,156 (33.5%)** |
| Total verified claims | **3,420** |
| Filings with a verified results block | **18 (0.52%)** |
| Filings carrying an extracted amount | 39 (1.1%) |
| Filings carrying a counterparty | 3 (0.09%) |
| Model prose summary present | 2,546 (73.8%) |

### The sparsity that governs every visual

| Fact | Value |
|---|---|
| Companies that filed **exactly once** | **496 of 1,218 (40.7%)** |
| Companies that filed ≤3 times | 897 (73.6%) |
| Companies that filed ≥10 times | 30 (2.5%) |
| Companies that filed ≥5 times (the `MIN_DISTRIBUTION_FILINGS` floor) | 232 (19.0%) |
| Companies holding ≥1 claim | 581 (47.7%) |
| Companies holding ≥4 claims (the `MIN_TOPIC_CLAIMS` floor) | **290 (23.8%)** |
| Heaviest filer by claims | POWERICA, 38 |

**Three-quarters of companies have filed three times or fewer.** Any per-company
time series, trend, sparkline or cadence is drawn over ≤3 observations for 73.6%
of the population. This is the single fact that kills an entire class of design.

### Claims — the payload

| Fact | Value |
|---|---|
| Hard cap on claim length (`claim-verify.ts: MAX_CLAIM_CHARS`) | **120 chars** |
| Measured claim length p50 / p90 / max | **65 / 102 / 120** |
| Claims ≤90 chars | 2,810 (82.2%) |
| Claims containing a digit | 2,933 (85.8%) |
| Claims containing ₹ / Rs / a currency token | 1,462 (42.7%) |
| Claims containing a `%` | 1,249 (36.5%) |
| Claims with a figure in the **first 30 characters** | 1,874 (54.8%) |
| Claims carrying a **printed** delta (direction word + %/bps, or signed %) | **823 (24.0%)** |
| …of which carry **exactly one** delta | **752 (21.9%)** |
| …of which carry **two or more** | **71 (2.1%)** |
| Claims per filing (of the 1,156 with any): 1 / 2 / 3 / ≥4 | 331 / 250 / 404 / 171 |

**`MAX_CLAIM_CHARS = 120` is the enabling constraint of this whole design.**
A verified claim is guaranteed to fit on a phone screen at display type. Nothing
else in this product has that property.

### Topics

| Topic | Claims | % |
|---|---|---|
| other | 1,203 | 35.2% |
| financial | 883 | 25.8% |
| **(no topic stored)** | **528** | **15.4%** |
| capacity | 202 | 5.9% |
| acquisition | 175 | 5.1% |
| dividend | 157 | 4.6% |
| product | 112 | 3.3% |
| orders | 73 | 2.1% |
| ratings | 40 | 1.2% |
| governance | 36 | 1.1% |

All 528 untopiced claims are on 2026-08-07 — the classifier's backfill has not
reached the newest day. This is not a bug to design around; it is the *normal*
state of the newest day, and any topic visual must render it as absence rather
than as `other`.

`other` + untopiced = **50.6% of all claims**. Half the payload is filed under
"nothing in particular".

### Results — the comparison data

| Fact | Value |
|---|---|
| Filings with a results block | 18 (0.52%) |
| Results filings per day | 10 · 3 · 5 |
| Total figures | **50** |
| Metrics | total-income 17, net-profit 15, revenue 14, eps 4 |
| Units | LAKH 24, CR 17, MN 5, (rupees) 4 |
| Figures per filing (1/2/3/4) | 1 / 6 / 7 / 4 |
| Basis: consolidated / standalone | 13 / 5 |
| **Figures where current or prior is negative** (stored parenthesised) | **3 of 50 (6%)** |
| current ÷ prior across the 47 positive pairs | min 0.01 · median 1.19 · max 1.63 |

Every figure carries one `unit` that applies to **both** current and prior —
`results-verify.ts` refuses a row whose unit cannot be fixed. Negatives are
stored in accounting parentheses: `IRIS net-profit (97.12) vs 22.43 LAKH`.

### When the day actually happens

Filings by IST hour of dissemination:

```
09 ▏27    12 ███ 223   15 ████ 308   18 ████████ 519   21 ██ 144
10 ▏61    13 ███ 221   16 █████ 382  19 █████ 339      22 █ 94
11 ██153  14 ███ 236   17 ██████ 426 20 ███ 222        23 █ 73
```

**43.6% of all filings arrive between 17:00 and 20:59 IST.** The peak hour is
18:00. A "day's signal" product is an *evening* or *next-morning* object, not a
market-hours ticker. That is a consumption-model fact, not a rendering one.

### What a "verified today" set looks like

| IST day | verified-tier filings | distinct companies |
|---|---|---|
| 2026-08-05 | 383 | 242 |
| 2026-08-06 | 463 | 250 |
| 2026-08-07 | 326 | 214 |

**~230 companies a day say something a document verified.** At four seconds of
attention each that is fifteen minutes. The design problem is not *finding*
signal; it is *bounding* it.

---

## 1. Three directions

### Direction A — **The Tape**

*Atomic unit: one claim. Consumption: an endless, dense, number-first scroll.*

The feed stops being a list of filings and becomes a list of **claims**. Each
claim is a tile sized to its content, in a 2-column (phone) masonry. The tile
leads with the claim's own figures set at 28–32px with `tabular-nums`, the rest
of the sentence wrapping beneath at 15px, the ticker as a small monospace label,
the topic as a 6px dot. Tiles with no figure are drawn narrow and grey. Infinite
scroll; no end.

**What it shows.** 3,420 claims instead of 1,156 filings — 3× the number of
scannable objects, each one already ≤120 characters.

**Why a fast reader would stay.** Density per swipe is the highest of the three.
54.8% of claims carry a figure in their first 30 characters, so a thumb-flick
past a screen of tiles delivers six or eight numbers with tickers attached. It
is the closest thing to a Bloomberg tape that a phone can hold.

**Data it needs.** `enrichment.claims[].text`, `.topic`, `.echo`, plus `symbol`,
`seqId`, `attachmentUrl`, `confidenceTier`. All already on the wire. No new
route: `api/filings?tier=verified` flattened client-side.

**What it CANNOT honestly show.**
- **No completion.** An endless tape has no "you are done" state, which is the
  exact thing the brief asks for. It optimises for the reader who has ten
  minutes, not the one who has one.
- **Ranking is unavoidable and forbidden.** 3,420 tiles must be ordered by
  *something*. Recency puts a 19:14 ESOP allotment above a 14:02 results
  release. Anything else is a materiality judgement, which is advisory.
- **A tile amputates its filing.** A claim shown alone loses the category, the
  basis, and the sibling claims that qualify it. `claim-fact.ts` exists because
  one company files the same fact three times; on a tape those become three
  tiles, and the `echo` flag only suppresses within one response window.

### Direction B — **The Deck**

*Atomic unit: one company's day. Consumption: a finite, countable, swipeable
deck with an explicit end.*

A separate view. Card 0 is the day at phone scale. Then N full-viewport cards,
one per company, vertical scroll-snap. Each card: ticker at 34px, the company's
loudest verified claim at 25px with its own figures marked, up to two more
claims at 15px, the topic, the tier badge, Source. A 3px progress rail across
the top counts the deck down. The last card says *"That's the day"* and states
exactly what was and was not covered.

**What it shows.** A bounded subset — 12 companies — of the ~230 that said
something, ordered by **how much of what they said could be checked**, and
labelled as such.

**Why a fast reader would stay.** It is the only one of the three that *ends*.
The progress rail is a promise: twelve cards, about a minute. Story-deck
mechanics are the native idiom of the audience, and scroll-snap gives them for
free with no JS scroll-hijack. Each card is one thought at a size you cannot
miss, which is what `MAX_CLAIM_CHARS = 120` makes possible.

**Data it needs.** `api/summary` (`todayCount`, `todayByGroup`, `todayVerified`,
`todayIstDay`) plus `api/filings?tier=verified&limit=200`. Per card:
`symbol`, `companyName`, `disseminatedAtIst`, `istDay`, `seqId`, `category`,
`categoryGroup(-Label)`, `confidenceTier(-Label)`, `attachmentUrl`,
`enrichment.claims[].{text,topic,span,echo}`, `enrichment.results.*`. No new
route for the MVP.

**What it CANNOT honestly show.**
- **It cannot say these twelve *matter most*.** It can only say they are the
  twelve we could check the most of. This must be printed on the cover, not
  implied.
- **It cannot cover the day from one request.** `MAX_LIMIT = 200` against 326–463
  verified filings a day. The MVP ranks over a window and states the window.
- **It is a poor company page.** One card is one day. The stream-over-time
  question belongs elsewhere.

### Direction C — **The Board**

*Atomic unit: the day. Consumption: one screen, no scroll, then drill in.*

A single non-scrolling screen. A 3×3 grid of topic cells sized by claim count
(financial, capacity, deals, dividends, orders, product, ratings, governance,
everything else). Each cell shows its count, a colour, and the single loudest
claim inside it. Tap a cell → the existing feed, pre-filtered by that topic chip.

**What it shows.** The *shape* of a day before any of its content: what today
was about, in one glance, with zero scrolling.

**Why a fast reader would stay.** Three seconds to orientation. It answers "is
anything happening today" before asking for any attention at all. It is also the
cheapest thing to build — the topic filter, the chips and the colours already
exist.

**Data it needs.** A per-day topic count. Not currently on the wire:
`api/summary.todayByGroup` counts *category groups over filings*, not *topics
over claims*. Needs either a new aggregation or client-side counting over a
fetched window (which makes the counts a property of the window, not the day).

**What it CANNOT honestly show.**
- **Its two biggest cells are meaningless.** `other` (35.2%) plus untopiced
  (15.4%) is 50.6% of all claims. A board whose largest tile reads "Everything
  else 1,203" and whose third-largest reads "Not yet classified 528" is a
  truthful picture of a boring day and a useless product.
- **It is the day bar again.** `day-mix` + `day-sentence` already answer "what
  shape was today" with 100% coverage. The board is a bigger, prettier version
  of a widget that exists, and the founder's complaint is not that the day bar
  is too small.
- **Counts are not signal.** "Financial 350" tells a reader nothing they can act
  on or send to a friend.

### Direction D — **Comparison strips** (raised, and killed as a *direction*)

Pairs of zero-baselined bars per results figure: current vs prior, both labelled
with the figures the filing printed.

**It cannot be a product direction, and one number says why: 18 filings, 0.52%
of the corpus, 3–10 a day, 50 figures total.** A consumption model whose central
object appears five times a day is not a consumption model. It survives as a
*card type* inside whichever direction wins — see §3.6.

---

## 2. The debate

### A vs B — density against closure

A wins on information per swipe and loses on the only requirement that was
actually stated. "Under a minute" is a *completion* claim; a tape cannot make
one. Worse, A's ordering problem is unsolvable within the invariants: 3,420
tiles must be sorted, recency is actively misleading given that 43.6% of filings
land in four evening hours, and every other key is a materiality judgement.

B has the same ordering problem but a *smaller* one, and a legitimate answer to
it. B orders by a countable property of the evidence — does this filing carry a
verified results block; how many of its claims carry a figure; how many claims
does it have — and prints the rule on the cover. That is a statement about what
we hold, not about the security. A tape cannot do this because "top 12 by
evidence density" is a *selection*, and a selection is only honest when it comes
with a stated cut and a stated remainder. A deck has a last card to put those on.
A tape has nowhere to put them.

**A's counter-attack, which lands:** the deck shows 12 of 214 companies. That is
5.6% of the day. It is a highlights reel wearing the word "day". — Answered by
making the end card carry the exact remainder and a one-tap route into the full
feed, and by never using the word "top".

### B vs C — content against orientation

C is faster to first pixel and cheaper to build, and it is the wrong product.
Half its surface area is `other` and unclassified. Its cells carry counts, and a
count is the text-heavy honest thing the dashboard already does well. The
founder is not asking for a better summary of the day; he is asking for the
day's *content* in a form that survives a fifteen-second attention span.

**C's counter-attack, which lands:** a reader dropped into card 1 of a deck has
no idea whether today was busy or dead, and no idea how much they are not being
shown. — Answered by stealing C entirely and making it **card 0** of the deck,
where the existing `day-mix` bar is already the right graphic and already has
100% coverage.

### A vs C

Neither is worth defending against the other; they fail on opposite axes. A is
all content and no frame; C is all frame and no content. This is itself the
argument for B, which is a frame (cover, rail, end card) wrapped around content
(one 120-character claim at 25px).

### D against everyone

D is the highest-quality data in the building — every figure checked against the
document's own basis, column, period and scale — and it happens 0.52% of the
time. Any direction that leans on it is a design for a corpus we do not have.
Any direction that *cannot accommodate* it wastes the best asset. B accommodates
it as a card variant; A would render it as an untethered tile (losing basis and
period, which `results-line.ts` says is the most dangerous error available); C
cannot show it at all.

### Winner: **B, The Deck** — with parts taken from all three

| Taken from | What |
|---|---|
| **C** | The whole day-shape screen becomes **card 0**, built from the existing `day-mix` bar and `todayByGroup`. Orientation before content, and it costs one existing widget. |
| **A** | The **number-first typography**. `writeClaim`'s existing `.fig` marking is scaled up: figures at 1.12em, `tabular-nums`, brighter. The claim is never re-ordered or re-written to lead with a number — 54.8% already do. |
| **A** | The **claim, not the filing, is the unit of a card's body.** A card is a company, but what fills it is claims, ranked within the company. |
| **D** | The **pair-bar card variant** for the 3–10 filings a day that carry a results block. §3.6 governs it. |
| **C** | Tapping a topic dot on any card opens the existing feed with that topic chip active. The board's drill-in survives without the board. |

---

## 3. The design

### 3.0 Where it lives

A fourth view, `view-brief`, beside `view-feed`, `view-company` and `view-admin`.
Reached by a third tab, `tab-brief`, placed **first**.

**On viewports ≤430px, `view-brief` is the default landing view; above it,
`view-feed` stays the default.** The feed's card grid is a desktop object — a
3-column grid whose card is 400px of text — and the deck is a phone object. Each
is default where it is right. The tab is present on both, so neither reader is
trapped.

Naming follows `docs/ui-components.md`: drawn-once elements take an `id`,
repeated elements take `data-ui`.

### 3.1 The components

| Name | Kind | What it is |
|---|---|---|
| `view-brief` | id | the deck view |
| `tab-brief` | id | the tab, first in `top-bar` |
| `brief-cover` | id | card 0: the day at phone scale |
| `brief-day` | id | the IST day, from `summary.todayIstDay` |
| `brief-mix` | id | the day's group bar — the same `.mix` markup `day-mix` uses |
| `brief-cover-line` | id | "1,286 filings · 326 verified · 214 companies" |
| `brief-cover-rule` | id | the ordering sentence and the window it covers |
| `brief-deck` | id | the scroll-snap container |
| `brief-rail` | id | the progress rail, pinned to the top of the viewport |
| `brief-rail-seg` | data-ui | one segment of the rail, one per card |
| `brief-card` | data-ui | one company-day. Also carries `data-symbol` and `data-seq` |
| `brief-ident` | data-ui | ticker · company name · IST time |
| `brief-lede` | data-ui | the loudest claim, 25px, figures marked |
| `brief-rest` | data-ui | up to two more claims, 15px |
| `brief-pair` | data-ui | the results comparison block (§3.6) |
| `brief-topic` | data-ui | topic dot + label; a button into the feed's topic chip |
| `brief-foot` | data-ui | tier badge · category · Source · Copy · Open company |
| `brief-end` | id | the last card: the tally and the two ways out |
| `brief-empty` | id | shown instead of the deck when nothing qualified |

### 3.2 What builds the deck

One request, already served: `api/filings?tier=verified&limit=200&offset=0`,
plus the `api/summary` the page already polls. No new route, no new index.

**Grouping.** Items are grouped by `symbol`. Each group becomes one candidate
card. Within a group, claims are concatenated in the order the response gives
them (`disseminatedAt` descending), and any claim with `echo === true` is
dropped from the *lede* position but kept in `brief-rest` — the same rule
`insightLines()` already applies.

**Ordering.** A total order over candidates, from countable properties only:

```
1. carries enrichment.results (a verified results block)   — desc
2. count of its claims whose text contains a digit          — desc
3. count of its claims                                      — desc
4. newest disseminatedAt                                    — desc
5. symbol                                                   — asc  (tie-break, so a
                                                                    repaint cannot
                                                                    reorder the deck)
```

Key 5 is not cosmetic. The feed repaints every four seconds; a deck that
reshuffles under a reader's thumb between two equal candidates is the same class
of bug the topic-mix bar's name tie-break already fixes.

**The rule is printed, in these words, on `brief-cover-rule`:**

> Ordered by how much of what each company said could be checked against its own
> document — not by how much it matters. That judgement is yours.

**Cap.** `BRIEF_MAX_CARDS = 12`. Justification: 12 cards at the ~4.5 seconds a
25px sentence plus a glance at the ticker takes is 54 seconds. 15 would be 68 and
break the promise. The number is a promise about time, so it is derived from time.

**Floor.** `BRIEF_MIN_CARDS = 3`. Below three candidates the rail is not drawn at
all — a two-segment progress bar is chrome, not information — and the cover line
says how many there are.

### 3.3 One card, on a 390px screen

```
┌──────────────────────────────────────────┐  ← brief-rail, 3px, 12 segments,
│ ▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │    filled up to the current card
│                                          │
│  IKS                          18:42 IST  │  ← brief-ident
│  Inventurus Knowledge Solutions          │    ticker 34/700, name 13/muted
│                                          │
│                                          │
│  Q1 FY27 revenue INR 8,936 Mn,           │  ← brief-lede
│  up 20.7% YoY                            │    25px / 1.28 / weight 500
│                                          │    figures in .fig at 1.12em
│                                          │
│  · Q1 FY27 PAT INR 1,937 Mn, up 27.8%    │  ← brief-rest, 15px, max 2
│  · Q1 FY27 EBITDA INR 2,949 Mn, up 24%   │
│                                          │
│  + 3 more in the feed                    │  ← only when >3 claims exist
│                                          │
│                                          │
│  ● Financials                            │  ← brief-topic, tappable
│  ────────────────────────────────────    │
│  Verified · Investor Presentation        │  ← brief-foot
│  Source   Copy   IKS →                   │    44px tap targets
└──────────────────────────────────────────┘
```

**Type scale (≤430px).** ticker 34/700/-0.02em · name 13/muted · time 12/muted ·
lede 25/1.28/500 · `.fig` inside lede 1.12em/600/`tabular-nums` · rest 15/1.4 ·
topic 13 · foot 11.

A 120-character claim at 25px on a 390px screen with 22px side padding wraps to
four lines and occupies ~128px. Measured against the p90 (102 chars) it is three
lines. The card has room for the lede at its maximum without any card in the deck
changing height, because every card is exactly one viewport.

### 3.4 Mobile mechanics (≤430px), stated as rules

- `#brief-deck { height: 100dvh; overflow-y: auto; scroll-snap-type: y mandatory;
  overscroll-behavior-y: contain; }` and each card
  `{ min-height: 100dvh; scroll-snap-align: start; }`.
  **`dvh`, not `vh`** — iOS Safari's collapsing URL bar makes `100vh` taller than
  the visible viewport, which puts the footer of every card under the chrome.
- **Vertical only. No horizontal swipe, ever.** A left-edge horizontal gesture is
  the iOS back navigation; a deck that competes with it loses and takes the
  reader out of the app. This is a hard rule, not a preference.
- **No scroll hijacking and no autoplay.** `scroll-snap` is the entire mechanism.
  There is no timer advancing cards: a reader who looks away must not lose their
  place, and an auto-advancing deck cannot be paused by a thumb that is holding a
  coffee.
- **Rail position is derived from scroll, not from a counter.** An
  `IntersectionObserver` at `threshold: 0.6` marks the current card; the rail
  reads that. A counter incremented on swipe drifts the moment a reader flicks
  two cards at once.
- Bottom padding `calc(20px + env(safe-area-inset-bottom))`; the foot row must
  clear the home indicator.
- Every control in `brief-foot` is ≥44×44px including padding.
- `@media (prefers-reduced-motion: reduce)` → `scroll-behavior: auto`, no rail
  transition. The stylesheet already has this block.
- Keyboard: `ArrowDown`/`ArrowUp`/`PageDown`/`PageUp`/`Space` move one card via
  `scrollIntoView({ block: 'start' })`. Each card is `tabindex="-1"` and takes
  focus on entry so a screen reader announces it. The deck is
  `role="region" aria-roledescription="card deck"`; each card is
  `role="group" aria-label="Card 4 of 12, IKS"`.

**Desktop (>430px).** The same deck, centred in a 480px column against the
existing `--bg`, cards at `min-height: 78vh`. Not a separate layout — one
codepath, one set of bugs.

### 3.5 Empty and sparse states, per element

The rule the codebase already wrote: *"Nothing was found" and "nothing was
looked for" are different facts and must not render the same.*

| Situation | Render |
|---|---|
| Deck has 0 candidates | `brief-empty`, not an empty deck. "Nothing in the last N filings carried a claim matched against its source document. *N* filings arrived; here is the feed." with the real N. |
| Deck has 1–2 candidates | Cards drawn, **rail suppressed**, cover line reads "2 companies. That is all we could check in this window." |
| Card has exactly 1 claim | Lede fills the card. `brief-rest` is **absent from the DOM**, not an empty `<ul>`. No "+0 more". |
| Card has 2–3 claims | Lede + `brief-rest`. No overflow line. |
| Card has >3 claims | "+ N more in the feed", linking to the company page. Never an in-card expander — a card that grows breaks scroll-snap. |
| Claim has `topic === null` (15.4% of claims, all on the newest day) | `brief-topic` is **hidden**. Not drawn as "Everything else". *This deliberately diverges from `renderTopics()`, which counts null as `other` so the bar's segments sum to the claim count. A single card has no sum to preserve, so absence is the honest render and a wrong label is not.* |
| `attachmentUrl` fails `safeHref` | No Source button. Existing behaviour, unchanged. |
| `summary.todayCount === 0` | Cover shows the day and "No filings yet today." The deck still draws from the fetched window and says so. |
| A company's only claims are all `echo === true` | The company is **not** a candidate. Its facts are already on an earlier card. |

### 3.6 The comparison pair — the one place arithmetic is even nearby

Drawn only on a card whose filing carries `enrichment.results`. 3–10 cards a day
across the whole product.

```
  Q1 FY27  vs  Q1 FY26        CONSOLIDATED
  Revenue
  ████████████████████████  ₹70,046 LAKH
  ███████████████████       ₹58,319 LAKH
```

**The rules, each with its reason:**

1. **Two bars, one metric, one unit, one zero baseline.** `ResultsFigureView`
   carries a single `unit` for both values by construction —
   `results-verify.ts` refuses a row whose unit cannot be fixed — so a pair can
   never compare a lakh against a crore.
2. **Both printed values are rendered as text on their bars**, using exactly
   `renderResultsValue(raw, unit)`'s output form (`₹70,046 LAKH`). The bar is
   decoration on a number the filing printed; the number is the content.
3. **No percentage. No multiple. No arrow. No red or green.** The bar lengths are
   the only comparison drawn, and they are a re-rendering of two printed numbers
   on a shared zero baseline. `results-line.ts` records what happens when a
   competitor prints a derived margin: `EBITDA MARGIN 11.73% VS 13.32%` where the
   arithmetic gives 13.23%, on a named listed company.
4. **The honest objection, and the answer.** A bar twice as long *is* a ratio
   rendered in pixels. The answer is that it is the same ratio a reader's eye
   performs on the two digit strings, it introduces no token that is not in the
   document, and it is bounded by rules 1 and 3. The line this design will not
   cross is *printing* a number the filing did not print. If a future reviewer
   disagrees, the fallback is rule 6 applied to every pair, and the design still
   works — the numbers are the content.
5. **Basis spelled in full, never abbreviated.** `RESULTS_BASIS_LABEL` →
   `CONSOLIDATED` / `STANDALONE`, in the header of the block. Two statements in
   one filing differ by tens of per cent, and `results-line.ts` calls confusing
   them the most dangerous error this feature can make.
6. **A pair where either value is negative is rendered as TEXT ONLY, no bars.**
   Measured: 3 of 50 figures (6%) are stored parenthesised —
   `IRIS net-profit (97.12) vs 22.43 LAKH`, `HGS net-profit (66.26) vs 11.16 CR`.
   A zero-baselined bar cannot draw a sign change, and a bar drawn from
   `|−97.12|` next to one drawn from `22.43` says *four times larger* about a
   swing from profit to loss. `renderResultsValue` already normalises these to
   `-₹97.12 LAKH`; the pair prints that and draws nothing.
7. **`period` and `priorPeriod` verbatim.** Never "YoY" alone.
8. **Max 3 pairs per card**, in `RESULTS_METRIC_LABEL` order. Four figures occur
   on 4 of 18 filings; the fourth goes to the feed.

### 3.7 What is explicitly NOT built, and why

| Not built | Measurement that kills it |
|---|---|
| A per-company sparkline / trend line | 73.6% of companies have ≤3 filings; 40.7% have exactly one. A line through one point is decoration. |
| A delta chip lifted from claim text ("▲ 20.7%") | 823 claims carry a printed delta but **71 carry two or more**: `"Revenue up 16% YoY and down 2% QoQ"`, `"EBITDA up 15.1%, PAT up 22.2%, volume up 11.3%"`. A browser regex that lifts the first and shows it as *the* number of the card is a summarisation, not a marking. See slice 3. |
| A computed % change on a results pair | The invariant. `results-line.ts` is the argument. |
| Colour-coding a claim by direction | `writeClaim` already records the rule: "'up' is the document's word, but colouring it green is this page taking a view." |
| A "top movers" or "most important" label | Advisory. The ordering rule is printed instead. |
| Auto-advancing cards | A reader who looks away loses their place, and a deck that plays itself is a video, which is a different product with a different cost. |
| A topic board as its own screen | 50.6% of claims are `other` or unclassified. |

---

## 4. The MVP slice — one focused day

**Deliverable: `view-brief` renders a 12-card deck on a phone, from data already
on the wire, with no new route and no change to any pipeline module.**

### Files

| File | Change | Est. |
|---|---|---|
| `apps/dashboard/src/ui/script/script-brief.ts` | **new fragment.** `briefCandidates()`, `orderBrief()`, `briefCard()`, `renderBrief()`, the `IntersectionObserver` rail. | ~260 lines |
| `apps/dashboard/src/ui/page-style-brief.ts` | **new stylesheet module**, concatenated into `PAGE_STYLE`. `page-style.ts` is already **808 lines** and CLAUDE.md's ceiling is 800 — the deck's CSS cannot go there. | ~140 lines |
| `apps/dashboard/src/ui/page.ts` | the `view-brief` shell + `tab-brief`. Markup only; no data. | ~45 lines |
| `apps/dashboard/src/ui/page-script.ts` | register `SCRIPT_BRIEF` in fragment order (after `script-feed`, so `writeClaim` and `safeHref` are in scope). | 2 lines |
| `apps/dashboard/src/ui/script/script-views.ts` | third tab; `≤430px` default-view selection. | ~25 lines |
| `apps/dashboard/src/ui/script/script-poll.ts` | when `state.view === 'brief'`, `query()` returns `tier=verified&limit=200&offset=0`. | ~6 lines |

### Scope of the MVP deck

- Cover card, 12 company cards, end card. No pair-bars (slice 2).
- Ordering client-side, over the newest 200 verified filings.
- The cover states the window in the codebase's own idiom, next to
  `co-coverage`'s precedent: *"Ordered over the 200 most recent verified filings.
  1,286 filings arrived today; 326 carry something a document verified."*
- The end card states the remainder: *"12 of the 214 companies that said
  something today. The rest are in the feed."* and offers one button into
  `view-feed`.

### Reuse, not rewrite

`writeClaim`, `safeHref`, `tag`, `setText`, `el`, `groupInt`, `describe`,
`TOPIC_LABEL`, `TIER_TITLE`, `pickGroup` and the `.mix` markup all already exist
in scope. The deck writes **no new path for exchange text into the DOM** — every
string still lands through `textContent` or `writeClaim`.

### Verification (this is the acceptance list, not a wish)

1. `npx tsc --noEmit` and `npm run lint` clean.
2. `script-fragments.spec.ts` passes — it asserts no backtick and no `${` in any
   fragment, and this is a new one.
3. `page.spec.ts` asserts every new `id` is present exactly once in the served
   HTML and every `data-ui` name is spelled as in `docs/ui-components.md`.
4. New Playwright spec `e2e/brief.spec.ts` at 390×844:
   - deck renders ≥3 cards; card count equals rail segment count;
   - card 1 pinned by `data-symbol`, **never by index** — cards re-resolve on the
     4s repaint, and the sharp-edges list already records that trap;
   - scrolling to card 3 moves the rail;
   - a card whose claim has `topic === null` has no `brief-topic` node;
   - `document.body.scrollWidth <= 430` (no horizontal overflow);
   - deck with zero candidates renders `brief-empty`, not an empty deck.
5. Update `docs/ui-components.md` with the new names — the file's whole premise
   is that every part of the page has a name you can say out loud.

### The debt this slice takes on, stated

The ordering function lives inside a template literal and therefore cannot be
unit-tested by Jest; only e2e reaches it. Slice 2 moves it to a real module.

---

## 5. Follow-on slices

### Slice 2 — `api/brief`, and the ordering becomes testable

A `@Get('api/brief')` route on `DashboardController` that does the grouping,
ordering and capping in Mongo over the **whole IST day** rather than a 200-row
window, and returns ≤12 pre-ordered company groups plus the day's counts.

- `apps/dashboard/src/filings/brief-order.ts` + `.spec.ts` — the ordering rule as
  a pure function with a Jest spec, including the tie-break that keeps a repaint
  from reshuffling the deck.
- Kills the "ordered over a window" caveat on the cover; the cover then says
  "ordered over all 326 verified filings today".
- One aggregation, `$match` on the IST day window + tier predicate, `$group` by
  symbol. The `disseminatedAt` index already serves the match.

### Slice 3 — the results pair card (§3.6)

3–10 cards a day, and the highest-quality data in the product. Needs
`renderResultsValue`'s output on the wire so there is exactly one definition of
how a figure is spelled — add `currentDisplay` / `priorDisplay` to
`ResultsFigureView` rather than re-implementing the `₹`/unit/sign rules in a
client fragment where they would drift.

### Slice 4 — the printed delta, done honestly

A server-side module `libs/filings/src/logic/claim-delta.ts` + spec that lifts a
delta from a claim **only when the claim contains exactly one**, and emits
`{ text: 'up 20.7%', direction: 'up' }` as a stored, testable field on
`ClaimView`. Measured reach: **752 claims, 21.9%** — and 56.2% of `financial`
claims. The 71 multi-delta claims (2.1%) return null and render as they do today.
This is a pipeline change with a corpus test, not a rendering change, which is
why it is last.

### Slice 5 — the company page, phone-first

The deck's card is the per-company graphic this design was also asked for. Give
`view-company` the same treatment: identity block, then the existing filing strip
(which is already the right graphic — squares, not bars, because at 2.8 filings
per company a bar chart is two bars of height one), then claims at deck
typography. The two distribution bars keep their floors (`MIN_DISTRIBUTION_FILINGS
= 5`, `MIN_TOPIC_CLAIMS = 4`), which today suppress them for **81.0%** and
**76.2%** of companies respectively — and that remains the widget working.

---

## 6. Risks

1. **The deck is 5.6% of the day and could read as the whole day.** 12 cards of
   214 companies. Mitigated by the cover rule, the end-card remainder, and never
   using the word "top" — but a reader who only ever opens the Brief will believe
   they have seen the market. This is the design's central honesty risk and it
   lives in copy, which is the weakest place to put a guarantee.
2. **The ordering rule is a materiality judgement wearing a countable disguise.**
   "Carries a results block, then most claims with figures" correlates with
   importance, and a reader will read the order as a ranking whatever the cover
   says. The defence is that every key is a property of *our evidence*, checkable
   by anyone, and printed on the page. It is a real defence and it is not a
   complete one.
3. **`scroll-snap` at `100dvh` is the least portable thing in the codebase.**
   iOS Safari, Android Chrome and Firefox differ on `dvh` during URL-bar
   collapse, on `overscroll-behavior` inside a snap container, and on whether a
   fast flick lands on a snap point. This is the one part that cannot be proven
   by `npm test` — it needs real devices, and the alternative (JS-driven paging)
   is worse and is what everyone regrets.
4. *(runner-up)* **The pair-bar precedent.** §3.6 rule 4 argues that a
   zero-baselined bar pair introduces no new number. A future reader may
   reasonably call it derived arithmetic. The design survives its removal — text
   only — which is the test of whether the rest of it was resting on it.
