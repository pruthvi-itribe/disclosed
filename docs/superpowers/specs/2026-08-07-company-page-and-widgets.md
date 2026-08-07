# The company page and the feed widgets

**Status:** design, measured 2026-08-07. Not yet built.

## The numbers this design stands on

Measured directly against the live collection on 2026-08-07, not read from
source comments. The distinction matters: an earlier pass of this design quoted
115 verified claims from a comment in `enrichment-merge.ts` and was wrong by a
factor of 7.6, because the claim-cap and whitespace fixes landed after that
comment was written.

| Fact | Value |
|---|---|
| Filings | 2,261 |
| Distinct companies | 960 |
| **Filings per company** | **2.36** |
| Companies with exactly ONE filing | **460 (47.9%)** |
| Companies with ≥5 filings | **128 (13.3%)** |
| Filings with a verified claim | **885 (39.1%)** |
| Filings with a results line | 13 (0.6%) |
| `industry` null | 1,315 (58.2%) |
| Coverage held | 2026-08-04 → 2026-08-07 (4 IST days) |

Two of those govern everything below.

**Half of all companies have filed exactly once.** Any per-company distribution
— a category mix, a cadence, a trend — is computed over one observation for
half the population and over two for three quarters of it. A chart drawn on
that is not a summary, it is decoration with error bars nobody can see.

**39.1% of filings carry a verified claim**, up from 5.3% at the start of the
day. That is high enough that claim-derived widgets are worth building, which
was not true this morning.

## The governing rule, which the codebase already wrote

`libs/filings/src/logic/context-line.ts`:

> "Largest in the last 30 days" is a claim about thirty days of data. A database
> holding two days of filings cannot support it, and stating it anyway would be
> the most confident lie the system is capable of — every word true, the whole
> sentence false.

So:

> **Every windowed or distributional element states the coverage it was computed
> over, and suppresses itself below a stated floor.** `MIN_CONTEXT_WINDOW_DAYS`
> is the precedent; this design adopts `MIN_DISTRIBUTION_FILINGS = 5`, which
> today suppresses the group-mix bar for 86.7% of companies.

That is the widget behaving correctly, not failing. It is also what makes the
page get better on its own as the collection deepens, rather than shipping a
chart that is a lie today and true in November.

## 1. The company page

A third view beside `view-feed` and `view-admin`, entered by clicking a card's
symbol or picking a company from search.

**It needs no new route and no new index.** It is served by
`api/filings?symbol=X&limit=200` with no tier filter — a query the existing
`symbol_1_category_1_disseminatedAt_-1` index serves. Every widget is derived in
the browser from that one payload. Add `{symbol: 1, disseminatedAt: -1}` only
when a single symbol exceeds ~5,000 filings; at the heaviest measured filer's 19
a month that is decades away, and the trigger is a number rather than a feeling.

One server change: add `istDay` to `FilingView`. The client must not compute IST
— that rule is at the top of `page-script.ts` — and slicing the first ten
characters off `disseminatedAtIst` would couple the browser to a server format
that can change silently.

### Layout

**Row 0 — identity and coverage.** Symbol, company name, and the honesty line:
`12 filings held · 04-Aug → 07-Aug · 4 IST days`. This is the coverage guard made
visible, and it is the first thing telling a reader whether anything below means
anything. Industry appears **only when non-null** — at 58.2% null it can never be
structural; a page whose third line reads "Industry: —" on six companies in ten
looks broken.

**Row 1 — three numbers.** Filings held, verified count, last filed. Reuses the
existing `.hero` markup.

**Row 2 — the filing strip. The highest-value element on the page.**

One column per IST day across the held range, zero-filled. Each column is a
bottom-aligned stack of one 10×10 square **per filing**.

- Pure CSS flex. No SVG, no scale, no axis.
- **A square per filing, not a bar.** At 2.36 filings a company, a bar chart is
  two bars of height one and needs an axis to be read at all. Twelve squares is
  *countable*: a reader gets the number without reading anything.
- **Weekends are drawn as a rule, not a short bar.** In the 32-day corpus a
  Sunday is 26 filings against a Tuesday's 832 — a factor of 32. A proportional
  bar renders a normal Sunday as an outage. A zero-filing day gets a 2px rule
  rather than a zero-height column, so "nobody filed" and "one filing" cannot
  look alike.
- Each square carries the IST timestamp and category as its title, and scrolls
  to that filing on click.

**Row 3 — what they file.** One 100%-wide stacked bar, one segment per category
group, fixed group order so two companies are comparable. Widths set with
`flexGrow`, so flex does the arithmetic exactly and no percentage rounding is
needed. **Suppressed below 5 filings** — today, for 86.7% of companies.

**Row 4 — the filings.** `renderFeed` reused unchanged. This is the largest
saving in the design: the body of the company page is code that already draws
results lines, claim lines, quiet cards, Copy and Source, and already carries the
`createElement`/`textContent`/`safeHref` discipline.

**Row 5 — results, conditional.** Rendered only when a filing has a results
block; today that is 13 filings, so it will be absent on essentially every page.
It must therefore be **genuinely absent, never an empty panel** reading "no
results yet".

**No computed delta. Not "+12.4% YoY", not an arrow.** `current` and `prior` are
stored as the document printed them. `results-line.ts` carries the argument and
it is the product's whole differentiator: a competitor published `Q1 EBITDA
MARGIN 11.73% VS 13.32%` for APOLLOTYRE where 8.68B over 65.61B is 13.23% — two
digits transposed, in a figure the filing never printed, about a named listed
company. A percentage badge is a calculation, and nothing downstream can tell a
right one from a wrong one.

### Colour: three meanings, not eleven

Eleven groups cannot take eleven hues on a dark theme without a legend, and a
legend defeats a glance. Reuse the meanings the cards already carry: `--results`
for results, `--claim` for anything that carried a verified claim, `--accent` for
other signal, and **`--line` for routine and governance** — which are 57% of
everything filed, so making them recede is the most informative act of colour on
the page. Groups are told apart by fixed position and hover title, not hue.

### Refused, with reasons

| Not built | Why |
|---|---|
| Price / return chart | No price data exists anywhere in this system. |
| **Revenue or EPS over quarters** | Needs ≥3 results filings for one company. We hold 13 results lines across 960 companies. Structurally impossible before 2027. This is the widget most likely to be asked for and the one refused hardest. |
| Sector breakdown | `industry` is null on 58.2% of filings. The chart would be 58% "unknown". |
| "Also on BSE" badge | The BSE feed carries no ISIN; the join needs a scrip→ISIN cache built at 800ms per company, the full ISIN disagrees across exchanges on 2 of 8 measured companies, and NSE byte counts are not stored. It is a batch job, not a render-time read. |
| Activity / momentum / sentiment score | `context-line.ts`: "There is no sentiment word in this file and there must never be one." A count is a fact; a score is a recommendation wearing a fact's clothes, about a named listed company. |
| 30-day sparkline | 30 columns for 2.36 filings is 28 empty ones. The strip spans the *held* range instead. |
| Peer comparison | Requires a peer set. `industry` is 58% null, so there isn't one. |

## 2. Feed-level widgets

**F1 — relabel the daily bars.** A fix, not a feature. The Admin days panel draws
proportional bars with no weekday labels, so on real data **every weekend renders
as an outage**. Near-zero cost; it stops the dashboard crying wolf twice a week.

**F2 — the day in one bar and one sentence.** A stacked bar of today's filings by
group, with routine and governance greyed, under one line of prose:

> `832 filings today. 476 of them are routine compliance. 41 said something a document verified.`

`category` is required on every filing, so coverage is 100% and always will be.
This is the most informative single sentence available about a market day, and
nothing on the page says it today.

**F3 — today's verified companies as chips.** At 39.1% verified this is a rich
set, not the thin one an earlier estimate suggested. It is literally the answer
to "what should I read", and each chip is the natural entry point to the company
page. Deliberately **not ranked** — ordering by claim count would be ordering
noise.

**F4 — the arrivals clock, gated.** Sixteen columns, 07:00–23:00 IST. It answers
"have I seen the day yet", and the measured answer is that **62.6% of a day lands
after 15:30 IST**, so a reader at 14:00 has seen about a third of it. Ship
today's bars with no norm; add the norm only when coverage reaches 10 days. Do
not hard-code a norm from a corpus file — an unfalsifiable constant is what the
measurement tools exist to prevent.

**Not built:** a pipeline funnel (Admin already counts every stage, clickably);
a "biggest amount today" ticker (verified amounts are ~1% of filings, so it is
empty most days and trains readers to stop looking); a company × day heatmap
(960 × 4, over 97% empty).

## 3. Build order

1. **Company page: strip + coverage line + reused `feedCard`.** Every cost is
   already paid — the query exists, the index exists, the renderer exists, and
   the data is complete. Symbol, category, timestamp and attachment are present
   on every filing, so unlike claims (39%), amounts (1%) or results (0.6%), the
   strip cannot be empty for anybody. It is honest at 4 days of coverage and
   better at 300.
2. F1, the weekend fix.
3. F2, the day in one bar.
4. F3, verified companies as chips.
5. Company group-mix bar, suppressed below 5 filings.
6. Company results block, shipped dark, lit up by the backfill.
7. F4, arrivals clock.

## 4. Build-safety rules

- Every node via `createElement`, every value via `textContent`. `innerHTML`
  appears nowhere — exchange text is untrusted.
- Class names by string concatenation, never template literals: `page-script.ts`
  is itself a template literal and a stray backtick or `${` breaks the build.
  This has caused two outages already.
- Sizes via `style.flexGrow` and `style.height`, both patterns already in the
  file.
- Links only through `safeHref`.
- No new timestamp formatting in the browser. `relativeTime` stays the one
  exception, because elapsed time is a difference between instants rather than a
  timezone question.
- Anything a reader does — an expanded card, the selected company — lives in
  `state`, because the page repaints every four seconds and interaction must
  outlive the refresh.
