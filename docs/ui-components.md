# Disclosed, by name

Every part of the page has a name you can say out loud. Point at one — "the card
foot wraps", "the company topic mix is empty" — and it maps to exactly one thing
in the source.

Two kinds of name, for one reason: **an `id` must be unique in a document.**
Anything the page draws once has an `id`. Anything it draws many times — a card,
its footer — carries `data-ui` instead, because twenty-five cards cannot share
an id and a duplicate one silently breaks `getElementById` for everybody.

To find one in a running page: `document.querySelectorAll('[data-ui="card-foot"]')`
or `document.getElementById('co-topics')`.

## Where the code lives

| File | Holds |
| --- | --- |
| `apps/dashboard/src/ui/page.ts` | the markup shell — every `id` below with a fixed position |
| `apps/dashboard/src/ui/page-style.ts` | all CSS except the Brief's |
| `apps/dashboard/src/ui/page-style-brief.ts` | the Brief's CSS, concatenated onto the above by `page.ts` |
| `apps/dashboard/src/ui/script/script-base.ts` | constants, DOM and format helpers |
| `apps/dashboard/src/ui/script/script-cells.ts` | the admin table's cells |
| `apps/dashboard/src/ui/script/script-feed.ts` | **the card** and the time buckets |
| `apps/dashboard/src/ui/script/script-brief.ts` | **the deck**: candidates, ordering, one card, the rail |
| `apps/dashboard/src/ui/script/script-company.ts` | the company page's sections |
| `apps/dashboard/src/ui/script/script-admin.ts` | the admin panels |
| `apps/dashboard/src/ui/script/script-poll.ts` | the poll loop and the filters |
| `apps/dashboard/src/ui/script/script-suggest.ts` | the type-ahead |
| `apps/dashboard/src/ui/script/script-account.ts` | **the account**: sign-in panel, the watch star, the Watching view |
| `apps/dashboard/src/ui/script/script-views.ts` | tabs, company view, chip state |

## The five views

| Name | What it is |
| --- | --- |
| `view-brief` | the day as a finite deck. The default view at 430px and below |
| `view-feed` | the product: what companies said today. The default above 430px |
| `view-company` | one company, reached by clicking a ticker |
| `view-watching` | filings from the companies this reader watches. **Signed in only** |
| `view-admin` | the instrument panel: refusals, routes, tiers, states |

While the Brief is open the body carries the class `briefing`: the deck is a
scroll container sized to the viewport, so the page behind it must not scroll
too.

## The Brief

Card 0 is the day, then up to twelve company cards, then the card that states
what was left out. The cards are inserted between `brief-cover` and `brief-end`
and are rebuilt only when the deck's contents actually change — the page
repaints every four seconds and replacing twelve full-viewport cards under a
reader's thumb costs them their place.

| Name | What it is |
| --- | --- |
| `tab-brief` | the tab, first in `top-bar` |
| `brief-rail` | the progress rail. One segment per card, hidden below three |
| `brief-rail-seg` | one segment. `.on` up to the card the reader is on |
| `brief-deck` | the scroll-snap container. Everything below lives inside it |
| `brief-cover` | card 0: the day at phone scale |
| `brief-day` / `brief-mix` | the IST day, and the day's group bar |
| `brief-cover-line` / `brief-cover-rule` | what arrived today, and the ordering rule with the window it covers |
| `brief-end` | the last card |
| `brief-end-line` / `brief-to-feed` | the remainder, and the way into the feed |
| `brief-empty` | shown **instead of** the deck when nothing qualified |

### One card of the deck

Repeated, so these are all `data-ui`. Each card also carries
`data-symbol="<symbol>"` and `data-seq="<seqId of the filing the lede came
from>"`, which are the only stable ways to name **one specific card**.

| Name | What it is |
| --- | --- |
| `brief-card` | one company's day, exactly one viewport tall |
| `brief-ident` | ticker, company name, and the IST time of the lede's filing |
| `brief-lede` | the loudest claim, at 25px, with its figures marked |
| `brief-rest` | up to two more claims. **Absent** from the DOM when there are none |
| `brief-topic` | the topic dot, and a way into the feed filtered by it. **Absent** when the claim carries no topic |
| `brief-foot` | tier badge, category, Copy, Source — every control a 44px target |

## The feed

| Name | What it is |
| --- | --- |
| `top-bar` | brand, the tabs, the account controls, and the live indicator |
| `live-dot` / `live-text` / `generated` | poll health and the IST time of the last refresh |
| `alert` | the red banner, hidden unless a fetch failed |
| `feed-hero` | the three big numbers |
| `hero-today` / `hero-insights` / `hero-lag` | filings today · verified insights · time since the last one |
| `day-bar` | the whole day as one stacked bar |
| `day-mix` / `day-sentence` | the bar itself, and the sentence under it |
| `feed-controls` | the search box, the topic chips, the toggle |
| `search` | the search wrapper (input `symbol`, listbox `suggest`) |
| `topics` | the one row of topic chips, plus `Plans` |
| `only-insights` | "Only filings that said something" |
| `search-note` | what the current query matched |
| `feed` | the card grid |
| `feed-info` / `feed-more` | the count, and "Load more" |

**The chip row holds two axes.** Every chip carries `data-topic` — what a claim
is ABOUT — except `Plans`, which carries `data-plans="only"` and narrows to the
filings holding a claim in which the company pointed at a period still ahead
(179 of 3,994 stored claims, across 128 filings; `claim-plan.ts` owns the rule
and both surfaces read it). They
share a row because a reader uses them the same way, and the price is that
**exactly one chip is ever lit**: picking either axis clears the other, and
Clear resets both.

## One card

Repeated, so these are all `data-ui`. Each card also carries
`data-seq="<seqId>"`, which is the only stable way to name **one specific card**
across the four-second repaint.

| Name | What it is |
| --- | --- |
| `card` | the whole tile. `.quiet` when the filing said nothing verifiable |
| `card-head` | ticker, company name, time, group chip — always one line |
| `card-claims` | the claims list. At most two, then "+ N more" |
| `card-outcome` | the exchange's own sentence, on a card with no claims |
| `card-foot` | tier badge, category, Copy, Source — always one line |
| `card-tier` | the Verified / Exchange-stated badge |
| `card-category` | NSE's category. The only part allowed to truncate |

## The company page

| Name | What it is |
| --- | --- |
| `company-back` | back to the feed |
| `company-head` | ticker, name, industry tag, coverage line |
| `co-symbol` / `co-name` / `co-industry` / `co-coverage` | the identity, and what the numbers were computed over |
| `co-filings` / `co-verified` / `co-last` | filings held · verified · last filed |
| `company-figures` (`co-figures-wrap`) | **the numbers, as printed** — the filing's own results table. **Hidden when there is none** |
| `co-figures` | the blocks. `company-figure-block` is one table, `company-figure` one row |
| `company-next` (`co-next-wrap`) | **what's next** — dated commitments still ahead. **Hidden when there are none** |
| `co-next` | the list. `company-next-item` (`data-ui`) is one date, its word and the quote |
| `company-marks` (`co-marks-wrap`) | **movement, as the filings printed it** — one mark per directional claim. **Hidden when there are none** |
| `co-marks` | the rows. `company-mark-day` is one IST day, `company-mark` one glyph |
| `company-topic-mix` (`co-topics-wrap`) | **what they say** — claim topics, over claims. Hidden below 4 claims |
| `co-topics` / `co-topics-legend` | the topic bar and its top-3 legend |
| `company-plans` (`co-plans-wrap`) | **plans, in their words** — the company's own forward-looking sentences, quoted. **Hidden when there are none, and drawn at one** |
| `co-plans` | the list. `company-plan` (`data-ui`) is one quote and its IST date |
| `company-feed` | the same card grid, without the repeated company identity |

Each section's note carries the class `sectionnote` and a `data-ui` of
`company-<section>-note`. One class for all four, because they say the same kind
of thing: what the section is, and what it deliberately does not compute.

### What this page stopped drawing

`co-strip` (the filing strip: one column per IST day, one square per filing) and
`co-mix-wrap` (the category bar) are **gone, not hidden** — with `renderStrip`,
`renderMix`, `MIN_DISTRIBUTION_FILINGS` and their CSS. Both drew the PIPELINE
rather than the company: a reader learns nothing from four squares landing on a
Tuesday, and "57% of this company's filings are routine" is a fact about NSE's
category list. What survives of them is one quiet coverage line —
`N filings held across M IST days · first to last` — which is the only thing on
the page about the shape of our holdings, and it is there because every number
under it is computed over that window.

### Absent is a valid state, and it is the usual one

All three new sections hide themselves when there is nothing to show, and
`npm run company:sections` is how often. Measured 2026-08-08 over 3,900 filings
and 1,286 companies:

| Section | Companies it draws for | What it holds |
| --- | --- | --- |
| the numbers, as printed | 15 (1.2%) | 19 tables, 52 figures, every one Q1 FY27 |
| what's next | 50 (3.9%) | 93 claims, 106 dates |
| movement over time | 282 (21.9%) | 989 marks; 25 companies span 2+ IST days, none 3+ |

**None of them has a floor**, unlike the topic bar. A floor guards a bar drawn
over too few observations — one observation drawn as a bar is a single colour
claiming to be a distribution. None of these is a distribution: one printed
table is one printed table, one dated appointment is one dated appointment, and
one mark is one sentence with its evidence attached.

**The numbers, as printed, computes nothing.** The figures are the tokens the
document printed, in the scale it declared, rendered server-side by the same
`renderResultsValue` the wire line uses (`currentDisplay` / `priorDisplay`) — a
second implementation of the currency mark in the browser is a second thing to
keep in step. No change, margin, growth rate or percentage is derived from two
figures: `results-line.ts` holds the argument, and a competitor's rescaled line
published a margin of 13.32% where its own numbers give 13.23%. The basis is
spelled out in full with the heading that fixed it in its title, because the
consolidated and standalone statements in one filing differ by tens of per cent.
An identical table filed twice — three of the fifteen companies did that — is
shown once, keyed on the CONTENT and not on the quarter, so a **restatement**
still draws two blocks.

**What's next holds no vocabulary and no calendar.** `claim-commitment.ts` owns
the scheduling words and the two date shapes it will read; the server sends
`commitments` on each claim, computed on read against `istDayKey(now)`. IST rolls
at 18:30 UTC, so a browser deciding "still ahead" for itself would show
yesterday's record date all evening. One entry per date and word, because a
company files the same AGM date in four documents in a week.

**The movement marks take the feed's glyphs and no colour.** `DIRECTION_GLYPH`
and `DIRECTION_LABEL` are declared once, in `script-feed.ts`, and the fragments
share a scope. One row per IST **day** rather than per filing — SONATSOFTW filed
five marked documents in one day, and the per-filing version drew five rows under
one date, which reads as five days. Nothing is counted: a tally of increases
against decreases is a verdict on a company, and 13 of the 45 printed decreases
in this collection are falling bad loans, debt, borrowing costs or emissions.

**Plans quotes the span, never the claim text.** The section shows the
document's own bytes at the matched position — the extractor's compressed `text`
appears nowhere in it — dated from the server's `istDay`, with echoes skipped
the way the feed's headlines skip them. A claim is quotable when it carries a
`planEvidence`, which the server computes from **both** the claim's kind and its
span: the extractor filed it as guidance or a target, *and* the sentence itself
printed a word about a period still ahead. The kind alone is 22% right, so the
browser is told the verdict rather than the vocabulary, and the words that
decided it are in each item's `title`. It computes nothing: no count, no
comparison between one filing's guidance and the next, which is why it carries
no "what a count would mean" note. It has **no floor** where the two bars above
it do, because one quoted sentence says exactly as much as it says while one
observation drawn as a bar is a single colour claiming to be a distribution.

## Admin

| Name | What it is |
| --- | --- |
| `stat-total` … `stat-pending` | the counters across the top |
| `category` / `group` / `state` / `amount` / `tier` / `limit` | the filter selects |
| `refusal-chip` / `clear` | the active refusal filter, and the reset |
| `rows` | the filings table body |
| `page-info` / `prev` / `next` | pagination |

## The account

The two header buttons are a **sibling of `nav.tabs`, not a child of it** — a
non-tab child of a `role="tablist"` is an ARIA violation, so they share the
tab's styling by class and take none of its role. Both start `hidden` and stay
hidden until `api/me` answers: "we do not know yet" is a third state, and
drawing either of the other two through it makes the header flicker on load.

| Name | What it is |
| --- | --- |
| `account` | the wrapper, between the tabs and the live indicator |
| `signin` / `signout` | the two header buttons. Exactly one is ever visible |
| `auth-panel` (`auth-back`) | the sign-in / register modal, in this document |
| `auth-form` | `auth-email`, `auth-password`, `auth-go`, `auth-alt`, `auth-close` |
| `auth-title` / `auth-lead` | swap between Sign in and Create an account |
| `auth-error` | one line, written with `textContent`, empty when there is nothing to say |

The panel says in plain words that there is no self-serve password reset yet.
That is not a placeholder: reset needs email, email needs a verified sending
domain, and that is the same domain the TLS certificate needs.

## Watching

| Name | What it is |
| --- | --- |
| `tab-watching` | the fourth tab. **Hidden when signed out** |
| `tab-watching-count` | the unread badge. **Absent at zero**, never a `0` |
| `watch-count` | "N of 50 companies watched" |
| `watch-feed` | the same card grid the feed uses, drawn by `renderFeedInto` |
| `watch-empty` | shown **instead of** the grid, and it says which of the two empties this is |
| `watch` (`data-ui`) | the star. Repeated, and each carries `data-symbol="<symbol>"` |
| `co-watch` | the company page's star, inside `company-head` after `co-industry` |

The star is **drawn in CSS, not typed**: `page.spec.ts` rejects the emoji range
`U+2600`-`U+27BF`, which holds both star glyphs, and rejects any CSS reference
to a remote asset. It is a `clip-path` polygon, filled when watching and
punched out when not, and it carries a text label as well — a clip-path shape
is invisible to a screen reader.

**The star is absent, not disabled, when signed out.** A control that is
permanently greyed out and never explains itself reads as a broken page.

**Watched state lives in `state.watched`, keyed by symbol.** The feed repaints
every four seconds and no DOM node survives a poll, so a star kept in the DOM
would un-fill itself under the reader's cursor — the same rule `state.expanded`
follows. Keyed by symbol rather than by `seqId` because one company files
repeatedly and the star belongs to the company.

While the Watching tab is open the four-second poll is **authenticated** — one
indexed session read per poll. On every other tab the poll is anonymous and
touches no session.

## Rules that hold across all of it

- **No `innerHTML`, ever.** Every value reaches the DOM through `textContent` or
  `createElement`. Exchange text is untrusted.
- **No URL is built here** and no link is created before `safeHref` has checked
  its scheme.
- **No timestamp is formatted in the browser.** The server owns the one IST
  definition; a browser on UTC would be wrong by 5½ hours and look fine doing it.
- **The script fragments share one scope.** They are joined in order into a
  single IIFE, so a function declared in one is visible to all the others.
- **No backtick and no `${` inside a fragment.** Both are eaten by the composing
  template literal before the browser sees them. A test asserts this.
- **`getJson` reads and `postJson` writes**, and they are siblings rather than
  one function with a flag: a failed read is "refresh failed", and a failed
  write carries a message the reader has to see (`WATCHLIST_FULL`,
  `UNKNOWN_SYMBOL`, `INVALID_CREDENTIALS`). A JSON body goes only to
  `api/auth/*`; watchlist mutations carry their parameter in the path or the
  query string, which is what keeps body parsing mounted on one prefix.
