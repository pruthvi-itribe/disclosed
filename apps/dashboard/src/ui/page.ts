import { BRAND, BRAND_TAGLINE } from './brand';
import { BRAND_FAVICON_LINK, BRAND_LOGO, BRAND_LOGO_STYLE } from './logo';
import { PAGE_SCRIPT } from './page-script';
import { PAGE_STYLE } from './page-style';
import { PAGE_STYLE_BRIEF } from './page-style-brief';
import { PAGE_STYLE_FOCUS } from './page-style-focus';

/**
 * The dashboard page: one self-contained HTML document, in two views.
 *
 * SELF-CONTAINED IS A REQUIREMENT, not a preference. There is no `<link>`, no
 * `<script src>`, no web font, no CDN and no build step — the CSS and the
 * JavaScript are inlined from their own modules and the document references
 * nothing outside its own origin. Two reasons:
 *
 *   - this is a view of a local pipeline, and the moment you most need it is
 *     the moment the network is the suspect; and
 *   - a page that fetches code from a third party at render time is a third
 *     party with script access to a view of an unauthenticated database.
 *
 * ================================================================
 * WHY THERE ARE TWO VIEWS
 * ================================================================
 *
 * Everything on this page used to be one screen: a dense table beside eight
 * panels counting refusal reasons, parse routes, enrichment states and
 * confidence tiers. Every one of those panels is real and useful, and together
 * they answered a question nobody reading the product actually asks. A reader
 * wants to know what companies said this morning. An operator wants to know
 * whether the extractor is refusing more than it did yesterday. Those are
 * different people at different moments, and serving them the same screen meant
 * the wire line — the thing this whole pipeline exists to produce — was the
 * smallest element on it.
 *
 * So FEED is the product and ADMIN is the instrument panel. The split is by
 * QUESTION, not by importance: nothing is hidden because it is unimportant, and
 * nothing moved to Admin stopped being counted or clickable. The refusal
 * breakdown still filters the feed; it just no longer competes with the news.
 *
 * THE MARKUP IS A SHELL. It carries no filing data at all: every value is
 * placed by the script from the JSON routes, which is what lets the page poll
 * without a reload and what keeps exchange-supplied text out of a server-side
 * string concatenation where it would have to be escaped by hand.
 *
 * THE ONE EXCEPTION IS A TAXONOMY, NOT DATA. The category groups are written
 * out as filter chips and `<option>` elements rather than fetched, because the
 * set is closed and owned by this codebase (`libs/filings/src/logic/
 * category-group.ts`), so it cannot arrive late or differ per collection; and
 * because the filter has to work on a page whose first fetch has not returned.
 */
export const renderDashboardPage = (): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${BRAND} — ${BRAND_TAGLINE}</title>
<!--
  THE ONLY LINK ELEMENT ON THIS PAGE, AND IT LOADS NOTHING. The icon is an SVG
  carried in the attribute as a data: URI — see logo.ts. A second link, of any
  kind, is a stylesheet or a font arriving from somewhere, which is what
  page.spec.ts refuses. (No backticks in here: this document is a template
  literal, and one would end the string — see CLAUDE.md.)
-->
${BRAND_FAVICON_LINK}
<!--
  FOUR STYLESHEETS, ONE STYLE ELEMENT. The Brief's rules, the focus card's and
  the logo's are each a self-contained layout for one thing, and page-style.ts is
  already past this project's 800-line file ceiling, so they file separately and
  are concatenated here.
-->
<style>${PAGE_STYLE}${PAGE_STYLE_BRIEF}${PAGE_STYLE_FOCUS}${BRAND_LOGO_STYLE}</style>
</head>
<body>
<header class="topbar" data-ui="top-bar">
  <div class="brand">
    ${BRAND_LOGO}
  </div>
  <nav class="tabs" role="tablist">
    <!--
      THE BRIEF IS FIRST because it is what a phone lands on: at 430px and
      below the script opens this view instead of the feed. The feed's card
      grid is a desktop object — a three-column grid whose card is 400px of
      text — and the deck is a phone object. Each is default where it is right,
      and both tabs are on both, so neither reader is trapped.
    -->
    <button id="tab-brief" class="tab" type="button" role="tab" aria-selected="false" aria-controls="view-brief">Brief</button>
    <button id="tab-feed" class="tab active" type="button" role="tab" aria-selected="true" aria-controls="view-feed">Feed</button>
    <button id="tab-watching" class="tab" type="button" role="tab" aria-selected="false" aria-controls="view-watching" hidden>Watching<span id="tab-watching-count" class="tabcount" hidden></span></button>
    <button id="tab-admin" class="tab" type="button" role="tab" aria-selected="false" aria-controls="view-admin">Admin</button>
  </nav>
  <!--
    A SIBLING OF nav.tabs, NOT A CHILD OF IT. A non-tab child of a
    role="tablist" is an ARIA violation, so this shares the tab's styling by
    class and takes none of its role. '.topbar .status' carries
    'margin-left: auto', so it slots in with no CSS layout change.

    THERE IS NO "SIGN IN" BUTTON HERE ANY MORE, and its absence is the gate.
    A signed-out browser never receives this document — the front door serves
    the landing page instead — so the only account action reachable from here
    is signing out. It starts hidden because until api/me answers, this page
    does not know the address to put on it, and a header that fills in on the
    first poll is quieter than one that flickers.
  -->
  <div class="account" data-ui="account">
    <button id="signout" class="tab" type="button" hidden></button>
  </div>
  <div class="status">
    <span id="live-dot" class="dot"></span>
    <span id="live-text">connecting</span>
    <span id="generated" class="muted mono"></span>
  </div>
</header>

<div id="alert" class="alert" hidden></div>

<!-- ============================ BRIEF =========================== -->
<!--
  THE DAY AS A FINITE, COUNTABLE DECK, and the word finite is the whole design.
  The requirement was "the day's signal in under a minute", which is a
  COMPLETION claim, and nothing endless can make one: an infinite tape of
  claims has no "you are done" state and no honest ordering — 3,420 claims must
  be sorted by something, recency is misleading when 43.6% of filings land in
  four evening hours, and every other key is a materiality judgement, which is
  advisory. Twelve cards have the same ordering problem in a form small enough
  to answer: the cover states the rule, and the last card states the remainder.

  IT COSTS NO NEW ROUTE. api/filings?tier=verified&limit=200 plus the summary
  the page already polls; the grouping, the ordering and the cap are done in
  the browser over that one payload.

  THE SHELL IS EMPTY, like every other view here. The cards are built by the
  script with createElement and textContent, because a claim is exchange-
  derived text and this page has one absolute rule about that.
-->
<section id="view-brief" data-ui="view-brief" class="view" role="tabpanel" aria-labelledby="tab-brief" hidden>

  <!-- One segment per card, filled up to the card the reader is on. Drawn by
       the script only at three cards or more. -->
  <div id="brief-rail" class="brail" aria-hidden="true" hidden></div>

  <div id="brief-deck" class="bdeck" role="region" aria-roledescription="card deck"
       aria-label="The day, one company per card" tabindex="0">

    <!-- Card 0: the day, before any of its content. Orientation first, and it
         costs one widget that already exists — the same group bar and the same
         colours the feed's day bar draws. -->
    <article id="brief-cover" class="bcard bcover">
      <div id="brief-day" class="bday">—</div>
      <!-- Not "in twelve cards": the deck is capped at twelve and often holds
           fewer, and a heading that states a number the deck does not have is
           the first thing a reader could catch this view lying about. The
           counts are on the two lines below, from the data. -->
      <h1 class="btitle">The day, card by card</h1>
      <div id="brief-mix" class="mix"></div>
      <div id="brief-cover-line" class="bcoverline"></div>
      <div id="brief-cover-rule" class="bcoverrule"></div>
      <div class="bhint">Scroll for the cards. There is an end.</div>
    </article>

    <!-- The company cards are inserted here, before the end card. -->

    <!-- THE REMAINDER, STATED. Twelve cards is about five per cent of the
         companies that said something a document verified, and a reader who
         only ever opens the Brief would otherwise believe they had seen the
         market. This is the mitigation, and it lives in copy, which is the
         weakest place to put a guarantee — so it is also the loudest thing on
         the last card. -->
    <article id="brief-end" class="bcard bend">
      <h2 class="btitle">That is the day.</h2>
      <div id="brief-end-line" class="bendline"></div>
      <button id="brief-to-feed" type="button" class="more">Open the feed</button>
    </article>
  </div>

  <!-- Shown INSTEAD of the deck when nothing qualified, with the real number
       of filings looked at. "Nothing was found" and "nothing was looked for"
       are different facts and must not render the same. -->
  <div id="brief-empty" class="bempty" hidden></div>
</section>

<!-- ============================ FEED ============================ -->
<section id="view-feed" data-ui="view-feed" class="view" role="tabpanel" aria-labelledby="tab-feed">

  <div class="hero" data-ui="feed-hero">
    <div class="herostat">
      <div id="hero-today" class="herovalue">—</div>
      <div class="herolabel">filings today</div>
    </div>
    <div class="herostat">
      <div id="hero-insights" class="herovalue accent">—</div>
      <div class="herolabel">verified insights</div>
    </div>
    <div class="herostat">
      <div id="hero-lag" class="herovalue">—</div>
      <div class="herolabel">since the last one</div>
    </div>
  </div>


  <div class="feedbar" data-ui="feed-controls">
    <!--
      A COMBOBOX, spelled out in ARIA rather than left as a styled input.

      The listbox is a sibling of the input inside a positioned wrapper, not a
      child of it, because an input cannot contain elements. Everything a screen
      reader needs to follow the arrow keys is on the input: aria-expanded
      tracks whether the list is open, aria-controls names it, and the script
      sets aria-activedescendant to the highlighted option's id — which is how
      a highlight that never moves DOM focus is still announced.

      The list is EMPTY IN THE MARKUP. Every option is built by the script with
      createElement and textContent, because a company name is exchange-supplied
      text and this page has one absolute rule about that.
    -->
    <div class="searchbox" data-ui="search">
      <input id="symbol" type="search" placeholder="Search a company, a category, or what was said…"
             autocomplete="off" spellcheck="false"
             role="combobox" aria-expanded="false" aria-autocomplete="list"
             aria-controls="suggest" aria-label="Search filings">
      <ul id="suggest" class="suggest" role="listbox" aria-label="Suggestions" hidden></ul>
    </div>
    <!--
      TOPIC CHIPS, a second row and a different question from the one above.
      The group chips ask what KIND of filing this is, which is NSE's taxonomy;
      these ask what its claims are ABOUT. The two disagree constantly and both
      are right — a dividend declaration arrives as an Outcome of Board Meeting
      and says something about a payout — and before topics existed there was no
      way to ask the second question at all, because 67% of claims sat under one
      kind called 'operational'.
    -->
    <!--
      ONE ROW OF FILTERS, and it is the TOPIC axis rather than NSE's category
      groups. There were two rows and twenty chips, four of which were pairs
      sharing a name one line apart — "Results" above "Results", "Orders" above
      "Orders" — meaning different things and returning different sets.

      Measured over the whole collection, the topic wins every one of those
      pairs outright: topic 'financial' finds 368 filings against group
      'results' 152, 'acquisition' 129 against 'mna' 31, 'orders' 48 against 22.
      The reason is structural. NSE's category names the DOCUMENT TYPE, and a
      company reporting results files an Outcome of Board Meeting AND a press
      release AND a presentation — three different groups, one event. The topic
      follows what was said, so it catches all three.

      The group filter is not gone: it is a select in Admin, where the question
      "what kind of document is this" belongs to whoever is inspecting the
      pipeline rather than reading the news.
    -->
    <div id="topics" class="chips topics">
      <button class="chip active" type="button" data-topic="">Everything</button>
      <button class="chip" type="button" data-topic="financial">Financials</button>
      <button class="chip" type="button" data-topic="dividend">Dividends</button>
      <button class="chip" type="button" data-topic="orders">Order wins</button>
      <button class="chip" type="button" data-topic="acquisition">Deals</button>
      <button class="chip" type="button" data-topic="capacity">Capacity</button>
      <button class="chip" type="button" data-topic="product">Product</button>
      <button class="chip" type="button" data-topic="ratings">Ratings</button>
      <!--
        A DIFFERENT AXIS IN THE SAME ROW, and it is the only chip here that is
        not a topic. The topics ask what a claim is ABOUT; this asks what SHAPE
        it is — 'guidance' or 'target', the two kinds in which a company states
        something about its own future, narrowed to the ones whose sentence
        says so. Measured on 2026-08-08: 813 of 3,994 stored claims carry one of
        those two kinds, 179 of those print a word about a period still ahead,
        and those 179 sit in 128 filings.

        IN THIS ROW RATHER THAN A ROW OF ITS OWN because a reader uses it the
        same way they use the chip beside it — one lens at a time — and a second
        row holding a single chip is furniture on the densest control in the
        product. The cost is a rule the script has to keep: picking this clears
        the topic and picking a topic clears this, so exactly one chip is lit.

        NOTHING IS DERIVED BY ASKING FOR IT. Every claim behind this filter is a
        span matched character for character against the source document, so
        what the reader gets is the company's own printed sentence about its own
        plans — the answer to "what happens next" that this pipeline is allowed
        to give, and the one the update-signal design settled on when it refused
        to author improvement commentary about a named listed company.
      -->
      <button class="chip" type="button" data-plans="only"
              title="Filings carrying a sentence in which the company stated its own guidance or a target it has set.">Plans</button>
    </div>
    <!--
      THE LEGEND FOR THE MOVEMENT MARKS, hidden until a marked card is on
      screen. Only 23.2% of verified claims carry a mark, so a permanent legend
      would explain glyphs that are usually not there.

      The last sentence is not a disclaimer bolted on: a triangle is the most
      rating-shaped thing this product has ever drawn, and the difference
      between a direction the filing printed and a view about the company is
      the difference between reporting a disclosure and publishing unregistered
      research on a named listed scrip.
    -->
    <!-- ONE LINE. It was three, and standing chrome is the wrong place to
         spend a reader's attention on every visit; the regulatory core — the
         mark is the filing's word, never a view on the company — survives in
         nine words, and the long form lives in the title for whoever hovers. -->
    <div id="dir-legend" class="dirlegend" data-ui="direction-legend" hidden
         title="The direction word and the figure the document printed beside it. They describe what the filing said about its own numbers — not a recommendation, and ${BRAND} publishes none.">
      ▲ ▼ ◆ mark movement the document itself printed — not a view on the company or its shares.
    </div>
    <div id="search-note" class="searchnote" hidden></div>
    <label class="onlyinsights">
      <input id="only-insights" type="checkbox" checked>
      <span>Only filings that said something</span>
    </label>
  </div>

  <div id="feed" class="feed" data-ui="feed"></div>
  <div class="feedfoot">
    <span id="feed-info" class="muted"></span>
    <button id="feed-more" type="button" class="more">Load more</button>
  </div>
</section>

<!-- =========================== COMPANY ========================== -->
<!--
  A third view, entered by clicking a symbol in the feed. It costs no new route
  and no new index: it is 'api/filings?symbol=X' — which the existing
  'symbol_1_category_1_disseminatedAt_-1' index serves — and every widget in it
  is derived in the browser from that one payload.

  THE COVERAGE LINE IS NOT DECORATION. Measured on 2026-08-08, this collection
  holds 3,900 filings across 1,286 companies, and most companies have filed
  once or twice. Any distribution drawn over that is computed from one or two
  observations, so the page states what it was computed over before it states
  anything else. 'context-line.ts' already wrote the rule: a claim about thirty
  days of data, made by a database holding four, is the most confident lie the
  system is capable of.

  WHAT THIS PAGE STOPPED DRAWING, AND WHY. It used to open with a filing strip
  — one square per filing, one column per IST day — and a stacked bar of the
  categories a company files under. Both were pictures of OUR pipeline rather
  than of the company: a reader learns nothing from knowing that four squares
  arrived on a Tuesday, and "57% of this company's filings are routine
  paperwork" is a fact about NSE's category list. They are replaced by three
  sections that answer a reader's own questions — what the numbers were, what
  is coming, and which way the documents said things moved — each of which is
  ABSENT when the collection cannot support it. Measured with
  'npm run company:sections' on 2026-08-08: the figures section draws for 15 of
  1,286 companies, what's next for 50, and the movement marks for 282.
-->
<section id="view-company" data-ui="view-company" class="view" role="tabpanel" hidden>
  <button id="company-back" class="back" type="button">Back to feed</button>

  <div class="cohead" data-ui="company-head">
    <div class="coident">
      <span id="co-symbol" class="cosym"></span>
      <span id="co-name" class="coname"></span>
      <span id="co-industry" class="tag" hidden></span>
      <!-- Hidden until api/me says somebody is signed in; renderCompany sets
           the label and the flag the same way it already does the industry
           tag. '.cohead' is flex with '.cocoverage' at margin-left:auto, so
           nothing moves. -->
      <button id="co-watch" class="watch" type="button" hidden></button>
    </div>
    <div id="co-coverage" class="cocoverage"></div>
  </div>

  <div class="hero">
    <div class="herostat">
      <div id="co-filings" class="herovalue">—</div>
      <div class="herolabel">filings held</div>
    </div>
    <div class="herostat">
      <div id="co-verified" class="herovalue accent">—</div>
      <div class="herolabel">verified</div>
    </div>
    <div class="herostat">
      <div id="co-last" class="herovalue">—</div>
      <div class="herolabel">last filed</div>
    </div>
  </div>

  <!--
    THE NUMBERS, AS PRINTED.

    The figures a results filing's own table carried, in the scale that table
    declared, with the row each one was read from in its title. NOTHING IS
    COMPUTED: no change, no growth rate, no margin, no percentage of anything.
    'results-line.ts' holds the argument at length — a competitor rescaled this
    exact class of figure and published an EBITDA margin of 13.32% where its own
    two numbers give 13.23% — and the rule it reached is that every figure a
    reader sees can be found in the source document by searching for the
    characters printed here.

    HIDDEN FOR ALMOST EVERYONE, and that is the section working rather than
    failing. Measured 2026-08-08 with 'npm run company:sections': 15 of the
    1,286 companies held carry a verified table at all, over 19 filings and 52
    figures, and every one of them is Q1 FY27 — this collection is 32 days old
    and a quarter is 90. A section that filled the gap with derived percentages
    would be inventing exactly what the pipeline refuses to.
  -->
  <div id="co-figures-wrap" data-ui="company-figures" hidden>
    <h2 class="bucket">The numbers, as printed</h2>
    <p class="sectionnote" data-ui="company-figures-note">
      The filing's own table, in the filing's own scale. Nothing here is
      rescaled and no change, margin or percentage is computed from it — the
      table row each figure was read from is in its title.
    </p>
    <div id="co-figures" class="figures"></div>
  </div>

  <!--
    WHAT'S NEXT — the only forward-looking thing on this page that is a DATE.

    A record date, an AGM, an e-voting window: appointments the filing itself
    printed, quoted from the sentence that printed them, and shown only while
    they are still ahead of the server's IST day. 'claim-commitment.ts' owns the
    word list and the date shapes and this page holds neither, the same way the
    plans section holds neither the kinds nor the forward-looking words.

    THE SERVER DECIDES "STILL AHEAD". IST rolls at 18:30 UTC and a browser
    deciding it locally would show yesterday's record date as upcoming all
    evening. Measured 2026-08-08: 50 of 1,286 companies carry one.
  -->
  <div id="co-next-wrap" data-ui="company-next" hidden>
    <h2 class="bucket">What's next</h2>
    <p class="sectionnote" data-ui="company-next-note">
      Dates this company's own filings printed and that have not passed yet,
      with the sentence each was read from. Their calendar, not our forecast.
    </p>
    <ul id="co-next" class="plans"></ul>
  </div>

  <!--
    MOVEMENT, IN THE ORDER THE FILINGS PRINTED IT — and this is what replaced
    the category bar that used to sit here.

    One mark per claim whose own sentence printed a direction, grouped under the
    IST day it was filed on, oldest first. It counts nothing and totals nothing:
    "four increases and one decrease" is a characterisation of a company, and
    this page publishes none. Each mark carries the document's characters that
    decided it, which is the only reason a derived glyph may appear at all.

    NO COLOUR, and the reason is in 'page-style.ts' at length: 13 of the 45
    printed decreases in this collection are falling bad loans, debt, borrowing
    costs or emissions, so red and green would be a view about the company that
    the collection says would be wrong.
  -->
  <div id="co-marks-wrap" data-ui="company-marks" hidden>
    <h2 class="bucket">Movement, as the filings printed it</h2>
    <p class="sectionnote" data-ui="company-marks-note">
      One mark for each claim whose sentence printed a direction, oldest first.
      A mark is not good or bad news — a falling number is a fall in bad loans
      as often as in profit — so there is no colour, and the words the document
      printed are in each mark's title.
    </p>
    <div id="co-marks" class="marks"></div>
  </div>

  <!-- The other axis. "What they file" is the document's category and "what
       they say" is the claims inside it, and the two disagree constantly: a
       Board Meeting Outcome is governance paperwork that declares a dividend.
       Both bars, or neither answers the question a reader arrived with. -->
  <div id="co-topics-wrap" data-ui="company-topic-mix" hidden>
    <h2 class="bucket">What they say</h2>
    <div id="co-topics" class="mix"></div>
    <div id="co-topics-legend" class="mixlegend"></div>
  </div>

  <!--
    WHAT THE COMPANY SAYS IT PLANS, AND IT IS A QUOTE RATHER THAN A SUMMARY.

    Every line in this list is a span the claim gate matched character for
    character against the source filing, kept only when the extractor filed it
    as guidance or a target AND the sentence itself printed a word about a
    period still ahead. Nothing here is composed, counted or characterised: the
    page quotes and dates, and stops.

    BOTH CONDITIONS, because the kind alone does not support the heading:
    measured on 2026-08-08, only 179 of the 813 claims stored under those two
    kinds (22.0%) point forward, and the rest are last quarter's figures, a
    declared dividend or an AGM date. 'claim-plan.ts' holds the rule and the
    measurement; the server sends 'planEvidence' and this page shows only the
    claims that carry one.

    THAT IS THE WHOLE REASON IT MAY SHIP. The founder asked for a rating that
    said "how can it improve"; improvement commentary about a named listed
    company can be checked against nothing, is authored by us rather than by the
    filer, and is the analytic core of a research note. The company's own
    forward-looking sentences answer the same question — what happens next —
    with words a reader can verify against the PDF. See
    'docs/superpowers/specs/2026-08-08-update-signal-design.md' section 2.5.

    NO FLOOR, unlike the two bars above it. A bar drawn over one observation is
    a single colour claiming to be a distribution; one quoted sentence is one
    quoted sentence. 75 of the 113 companies with a quotable plan hold one.
  -->
  <div id="co-plans-wrap" data-ui="company-plans" hidden>
    <h2 class="bucket">Plans, in their words</h2>
    <p class="sectionnote" data-ui="company-plans-note">
      Quoted from the filings held here, where the company itself pointed at a
      period still ahead — its own guidance, or a target it has set. Their
      words, not our forecast, and not a view on the company.
    </p>
    <ul id="co-plans" class="plans"></ul>
  </div>

  <h2 class="bucket">Filings</h2>
  <div id="company-feed" class="feed" data-ui="company-feed"></div>
</section>

<!-- =========================== WATCHING ========================= -->
<!--
  THE v1 ALERT SURFACE, and it is a QUERY rather than a channel.

  It needs no fan-out, no outbox, no delivery state, no sender rate limiter and
  no third party: it is 'api/watchlist/feed', which is the filings collection
  filtered to the symbols this reader picked. That is the single largest
  simplification in the accounts design.

  THE HONEST COST, stated where a reader of this file will see it: an in-app
  view is NOT a push channel. Somebody who is not looking at this page learns
  nothing until they look. The latency promise this product is built on returns
  with a real push channel (web push or a Telegram DM), and until then the
  alerting must not be described to anyone as real-time.

  THE BODY IS 'renderFeedInto', UNCHANGED. Same cards, same claim lines, same
  Copy and Source, same createElement/textContent/safeHref discipline — a
  second card renderer would be a second place for exchange text to reach the
  DOM.

  IT OPENS WITH THE WATCHLIST, NOT WITH THE FEED, and that ordering is a fix
  rather than a preference. The feed below is the newest 'limit' filings ACROSS
  the whole watchlist, so a company that files less often than its neighbours
  contributes no card — and while the roster did not exist, that company had no
  row anywhere on the page and watching it looked broken rather than quiet.
  'watch-roster' lists every watched company whatever the feed holds, and
  'watch-feed-note' states in numbers what the feed below is leaving out.
-->
<section id="view-watching" data-ui="view-watching" class="view" role="tabpanel" aria-labelledby="tab-watching" hidden>
  <div class="watchhead" data-ui="watching-head">
    <h2 class="bucket" style="margin:0">Companies you watch</h2>
    <span id="watch-count" class="watchcount"></span>
  </div>
  <p id="watch-roster-note" class="sectionnote" data-ui="watching-roster-note">
    Every company you watch is here, the quiet ones included, with when it last
    filed anything held in this collection. The star takes one off the list.
  </p>
  <ul id="watch-roster" class="roster" data-ui="watching-roster"></ul>

  <div id="watch-feed-head" class="watchhead" data-ui="watching-feed-head">
    <h2 class="bucket" style="margin:0">What they have said</h2>
  </div>
  <p id="watch-feed-note" class="sectionnote" data-ui="watching-feed-note" hidden></p>
  <div id="watch-empty" class="watchempty" hidden></div>
  <div id="watch-feed" class="feed" data-ui="watching-feed"></div>
</section>

<!-- ============================ ADMIN =========================== -->
<section id="view-admin" data-ui="view-admin" class="view" role="tabpanel" aria-labelledby="tab-admin" hidden>

  <section class="stats">
    <div class="stat">
      <div class="label">Total filings</div>
      <div id="stat-total" class="value">—</div>
      <div class="note">stored</div>
    </div>
    <div class="stat">
      <div class="label">Today</div>
      <div id="stat-today" class="value">—</div>
      <div id="stat-today-note" class="note">—</div>
    </div>
    <div class="stat">
      <div class="label">Feed lag</div>
      <div id="stat-lag" class="value">—</div>
      <div class="note">since newest filing</div>
    </div>
    <div class="stat">
      <div class="label">Newest filing</div>
      <div id="stat-newest" class="value mono" style="font-size:15px">—</div>
      <div class="note">disseminated, IST</div>
    </div>
    <div class="stat">
      <div class="label">Cursor</div>
      <div id="stat-cursor" class="value" style="font-size:19px">—</div>
      <div class="note">max seqId</div>
    </div>
    <div class="stat">
      <div class="label">Outcome coverage</div>
      <div id="stat-outcome" class="value">—</div>
      <div id="stat-outcome-note" class="note">—</div>
    </div>
    <div class="stat">
      <div class="label">Amounts read</div>
      <div id="stat-amounts" class="value">—</div>
      <div id="stat-amounts-note" class="note">—</div>
    </div>
    <div class="stat">
      <div class="label">Awaiting read</div>
      <div id="stat-pending" class="value">—</div>
      <div id="stat-pending-note" class="note">source PDFs</div>
    </div>
  
  <!-- THE METHODOLOGY, MOVED OFF THE READER'S FLOOR. This block stood at the
       bottom of every view and is a wall: twelve lines a reader scrolls past
       daily and an operator needs once. It lives with the other operator
       reading now. Nothing was cut — the tier meanings, the traceability
       story, the arrow rule and the "read the claim, not the arrow" warning
       are all still on the page, where the tests can still hold them. -->
<footer>
  This view never writes to the filings collection. All times are IST (UTC+05:30).
  Every insight is traceable: the symbol and category are stored verbatim, the action phrase is a fixed lookup,
  and the amount and counterparty quote the source document.
  A refused amount degrades the headline to the exchange's own words.
  Every claim carries the sentence it was read from, matched against the source document before it is shown;
  a claim whose sentence is not in the document is discarded, and the discard is kept under Admin with the rule that refused it.
  Verified means a span of the source was matched character for character and is the only tier allowed near an alert;
  exchange-stated means NSE's own summary said it and nobody has checked it against the attached document;
  category only means all that is known is what kind of filing this is.
  Category only is an honest floor, not a failure — an investor presentation nobody verified is still an investor presentation.
  A ▲, ▼ or ◆ appears on a claim only where the document printed both a direction — up, down, grew, declined —
  and the amount, as a percentage or in basis points. Where a filing did not print both, no mark appears;
  that is the case for about three-quarters of verified claims, and an absent mark means the filing was silent, not that nothing happened.
  A fall is not bad news and a rise is not good news: these marks follow the figure, not the company.
  In the current collection, 13 of 45 marked decreases are falling bad loans, debt, borrowing costs or emissions —
  a decrease every reader would call an improvement. Read the claim, not the arrow.
  ${BRAND} does not rate companies or securities. It reports what documents say and shows you where they say it.
  Amount-path refusals are diagnostics, not headlines: no-candidate and ambiguity-keyword together accounted for
  95% of a collection none of whose rows are blank, so they are still counted and still filterable under Diagnostics
  rather than shouted from every row. The panel is collapsed and not removed, and its summary carries the live
  refusal total, because an extractor whose refusals are invisible is indistinguishable from one that is not running.
</footer>
</section>

  <section class="filters">
    <label for="category">Category</label>
    <select id="category"><option value="">All categories</option></select>
    <label for="group">Group</label>
    <select id="group">
      <option value="">All groups</option>
      <option value="results">Results</option>
      <option value="narrative">Narrative</option>
      <option value="orders">Orders</option>
      <option value="mna">M&amp;A</option>
      <option value="ratings">Ratings</option>
      <option value="capital">Capital</option>
      <option value="governance">Governance</option>
      <option value="legal">Legal</option>
      <option value="verification">Verification</option>
      <option value="routine">Routine</option>
      <option value="other">Other</option>
    </select>
    <label for="state">Enrichment</label>
    <select id="state">
      <option value="">Any state</option>
      <option value="enriched">enriched</option>
      <option value="pending">pending</option>
      <option value="unparseable">unparseable</option>
      <option value="failed">failed</option>
    </select>
    <label for="amount">Amount</label>
    <select id="amount">
      <option value="">Any</option>
      <option value="extracted">extracted</option>
      <option value="refused">refused</option>
    </select>
    <label for="tier">Confidence</label>
    <select id="tier">
      <option value="">Any confidence</option>
      <option value="verified">verified</option>
      <option value="unverified">unverified</option>
    </select>
    <label for="limit">Rows</label>
    <select id="limit">
      <option value="25" selected>25</option>
      <option value="50">50</option>
      <option value="100">100</option>
      <option value="200">200</option>
      <option value="500">500</option>
    </select>
    <button id="clear" type="button">Clear</button>
    <span id="refusal-chip"></span>
    <span style="flex:1 1 auto"></span>
    <span id="page-info" class="muted mono">—</span>
    <button id="prev" type="button" disabled>Prev</button>
    <button id="next" type="button" disabled>Next</button>
  </section>

  <main class="grid">
    <div class="panel">
      <h2><span>Recent filings</span><span class="muted">newest first — click a row for the detail behind it</span></h2>
      <div class="scroll">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Symbol</th>
              <th>What was said</th>
              <th>Group</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody id="rows"></tbody>
        </table>
      </div>
    </div>

    <div class="side">
      <div class="panel">
        <h2><span>Notable claims</span><span class="muted">click to filter</span></h2>
        <div id="claims"></div>
      </div>
      <div class="panel">
        <h2><span>Financial results</span><span class="muted">click to filter</span></h2>
        <div id="results"></div>
      </div>
      <div class="panel">
        <h2><span>Confidence</span><span class="muted">click to filter</span></h2>
        <div id="tiers" class="rows"></div>
      </div>
      <div class="panel">
        <h2><span>Category groups</span><span class="muted">click to filter</span></h2>
        <div id="groups" class="rows"></div>
      </div>
      <div class="panel">
        <h2><span>Categories</span><span class="muted">click to filter</span></h2>
        <div id="categories" class="rows scroll"></div>
      </div>
      <div class="panel">
        <h2><span>How documents were read</span><span class="muted">no filter accepts a parser</span></h2>
        <div id="reading"></div>
      </div>
      <div class="panel">
        <h2><span>Filings per IST day</span></h2>
        <div id="days" class="days"></div>
        <div class="dayaxis"><span id="day-from">—</span><span id="day-to">—</span></div>
      </div>
      <details class="panel diagnostics" id="diagnostics">
        <summary><span>Diagnostics</span><span id="diag-count" class="muted"></span></summary>
        <div class="panel-body">
          <h2><span>Why amounts were refused</span><span class="muted">click to filter</span></h2>
          <div id="refusals"></div>
        </div>
      </details>
    </div>
  </main>
</section>

<!-- ========================= FOCUS CARD ========================= -->
<!--
  ONE CARD, FULL SIZE, WITH EVERYTHING IT HAS.

  It replaces the inline "+ N more" expansion. That control grew the card in
  place, which pushed every other card in its grid row down, reflowed the feed
  under whoever clicked it, and still could not show the one thing a reader
  stops on a card to see — the sentence in the document each claim was matched
  against. Those spans lived in the Admin table's detail row, which is a
  different view for a different person.

  THE SHELL IS EMPTY, like every other view here. The dialog's contents are
  built by the script with createElement and textContent for one absolute
  reason: a claim, a company name and a quoted span are all exchange-derived
  text.

  OUTSIDE #feed ON PURPOSE. The feed rebuilds itself every four seconds and no
  node inside it survives a poll; a dialog rendered into the card it came from
  would close itself under the reader mid-read.
-->
<div id="focus-back" class="focusback" data-ui="focus-back" hidden>
  <div id="focus" class="focuscard" data-ui="focus-card"
       role="dialog" aria-modal="true" aria-labelledby="focus-symbol">
    <header class="focushead">
      <div class="who">
        <span id="focus-symbol" class="sym"></span>
        <span id="focus-name" class="coname"></span>
      </div>
      <span id="focus-when" class="when"></span>
      <!-- The X. A real button with a real accessible name: a bare glyph is
           unreachable to a screen reader and unhittable with a thumb. -->
      <button id="focus-close" class="focusclose" type="button" aria-label="Close">
        <span aria-hidden="true">&times;</span>
      </button>
    </header>
    <div id="focus-body" class="focusbody"></div>
    <footer id="focus-foot" class="focusfoot"></footer>
  </div>
</div>

<!-- ========================== SIGN IN =========================== -->
<!--
  THERE IS NO SIGN-IN PANEL ON THIS PAGE ANY MORE, and the empty space is the
  point rather than an omission.

  It was a modal inside this document: two inputs, a mode toggle and a form that
  posted to api/auth. Every part of it is now unreachable, because a browser
  with no session never receives this document — the front door answers a
  signed-out visitor with the landing page. Leaving it would be a second sign-in
  form on one origin, kept green by tests, drifting away from the one people
  actually use.

  The sign-in surface is '/auth', built from the resolved AUTH_MODE: Google plus
  a password form, or the in-house password form, or an honest panel naming the
  environment variables that have not been set. See 'ui/auth-page.ts'.
-->


<script>${PAGE_SCRIPT}</script>
</body>
</html>
`;
