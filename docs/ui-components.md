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
| `apps/dashboard/src/ui/script/script-company.ts` | the company page's widgets |
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
| `topics` | the one row of topic chips |
| `only-insights` | "Only filings that said something" |
| `search-note` | what the current query matched |
| `feed` | the card grid |
| `feed-info` / `feed-more` | the count, and "Load more" |

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
| `company-timeline` (`co-strip`) | one column per IST day, one square per filing |
| `company-group-mix` (`co-mix-wrap`) | **what they file** — categories, over filings. Hidden below 5 filings |
| `company-topic-mix` (`co-topics-wrap`) | **what they say** — claim topics, over claims. Hidden below 4 claims |
| `co-mix` / `co-mix-legend` | the group bar and its top-3 legend |
| `co-topics` / `co-topics-legend` | the topic bar and its top-3 legend |
| `company-feed` | the same card grid, without the repeated company identity |

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
