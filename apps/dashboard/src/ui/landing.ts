import { BRAND, BRAND_DOMAIN, BRAND_TAGLINE } from './brand';
import { LANDING_STYLE } from './landing-style';
import { BRAND_FAVICON_LINK, BRAND_LOGO, BRAND_LOGO_STYLE } from './logo';
import {
  SAMPLE_CARDS,
  type SampleCard,
  type SampleClaim,
} from './landing-samples';

/**
 * What a signed-out visitor gets, and the only page they get.
 *
 * ================================================================
 * IT PERFORMS NO READ
 * ================================================================
 *
 * Not a throttled read, not a cached read, not a read of aggregates — none.
 * Every filing route on this application is behind the session guard, and this
 * page is what makes that a complete statement rather than an almost-complete
 * one: it is a constant string, it fetches nothing, and it carries no script at
 * all. There is no endpoint it could call and no state it could leak, so the
 * gate has no exception to argue about.
 *
 * The consequence, accepted deliberately: every number and every card on this
 * page is an EXAMPLE, and the page says so beside each of them rather than in
 * small print at the bottom. See `landing-samples.ts` for why the companies are
 * invented — briefly, a plausible figure beside a real ticker on a marketing
 * page is `results-line.ts`'s APOLLOTYRE failure with none of the pipeline's
 * defences in front of it.
 *
 * ================================================================
 * IT IS WRITTEN FOR SOMEBODY WHO HAS NEVER READ A FILING
 * ================================================================
 *
 * NOT ONE WORD OF THIS PROJECT'S VOCABULARY REACHES THE READER. No spans, no
 * claims, no gates, no verbatim, no pipeline steps, no example of something the
 * system refused — every one of those is a word we invented for ourselves, and a
 * stranger who has to learn it before the promise makes sense has been handed
 * the work this page exists to do. `landing.spec.ts` holds that as a test over
 * the page's visible text, because the vocabulary is right there in the module
 * comments and it leaks into copy the moment somebody edits quickly.
 *
 * The trust story did not go anywhere; it changed language. "Every claim matched
 * character for character against a span" is now "the exact line from the
 * document, in the company's own words" — the same guarantee, said in the way a
 * reader would repeat it to somebody else.
 *
 * ================================================================
 * NO SCRIPT, AND THAT IS THE SECURITY POSTURE
 * ================================================================
 *
 * `page.ts` inlines 100 KB of client code because the dashboard is live. This
 * page is not live. It has one interaction — a link to `/auth` — and a link
 * needs no JavaScript, so this document contains no `<script>` element of any
 * kind. It is the most-served, least-authenticated page on the origin and it is
 * the one with the smallest attack surface, which is the right way round.
 *
 * SELF-CONTAINED, like everything else here: no CDN, no font, no external host.
 * `landing.spec.ts` asserts the document contains no `https?://` at all, which
 * is the same assertion `page.spec.ts` makes about the dashboard. The one
 * relaxation on this origin is `/auth`, which loads the Firebase Web SDK from
 * gstatic — stated in `auth-page.ts`'s header and in CLAUDE.md, and reachable
 * from here only by following a link.
 *
 * ================================================================
 * THE MARKUP IS A CONSTANT, WHICH IS WHY INTERPOLATION IS SAFE HERE
 * ================================================================
 *
 * `page.ts` refuses to concatenate data into HTML because its data is
 * exchange-supplied text from an unauthenticated database. NOTHING on this page
 * comes from anywhere but the two modules beside it, both of which are source
 * code in this repository. The values are still escaped on the way in — see
 * `escapeHtml` — not because a threat is expected but because the alternative is
 * a rule with an exception, and an exception is what the next person copies.
 */

/**
 * The five characters that change meaning inside HTML.
 *
 * Applied to every interpolated value, including ones this file wrote itself.
 * It costs nothing and it means a future edit that puts an ampersand in a
 * company name — "Smith & Co" is an ordinary name — cannot produce a broken
 * entity, let alone anything worse.
 */
export const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/**
 * The movement mark, by the document's own vocabulary.
 *
 * The same three glyphs `script-feed.ts` draws, and the same deliberate absence
 * of a fourth: a claim whose document printed no direction gets no mark, because
 * three-quarters of them print none and a badge on three-quarters of a feed is
 * furniture. Outside the emoji range the page tests reject.
 */
const DIRECTION_GLYPH: Readonly<Record<string, string>> = {
  expansion: '▲',
  contraction: '▼',
  mixed: '◆',
};

/**
 * Spelled out for a reader who cannot see the glyph. Describes the DOCUMENT.
 *
 * "The document reported" rather than "printed direction": these are read aloud
 * to a stranger, and the sentence has to work without the rest of this page.
 */
const DIRECTION_LABEL: Readonly<Record<string, string>> = {
  expansion: 'the document reported an increase',
  contraction: 'the document reported a decrease',
  mixed: 'the document reported both',
};

/**
 * A figure the document printed, set apart.
 *
 * THE SAME PATTERN `script-feed.ts` USES, and it is typography rather than
 * arithmetic: it finds characters that are already in the sentence and wraps
 * them. Nothing here computes, converts, rounds or compares a number.
 *
 * Written as a normal regex rather than with the doubled backslashes the script
 * fragments need — this file is TypeScript that runs on the server, not a
 * template-literal fragment, so a single backslash means what it says. That
 * difference is exactly the sharp edge CLAUDE.md records, and it cuts the other
 * way here.
 */
const FIGURE =
  /((?:₹|Rs\.?|INR|USD|\$)?\s?\d[\d,]*(?:\.\d+)?\s?(?:%|bps|crore|cr|lakh|lakhs|million|mn|billion|bn|MW|MTPA|x)?)/gi;

/** Escapes a claim and marks its figures. Escaping happens FIRST, always. */
const writeClaim = (text: string): string =>
  escapeHtml(text).replace(FIGURE, (match) =>
    /\d/.test(match) ? `<span class="fig">${match}</span>` : match,
  );

/** One claim line: the mark the document printed, the claim, and the span. */
const renderClaim = (claim: SampleClaim): string => {
  const glyph = Object.prototype.hasOwnProperty.call(
    DIRECTION_GLYPH,
    claim.direction,
  )
    ? `<span class="dir" data-ui="claim-direction" data-direction="${escapeHtml(claim.direction)}" aria-label="${escapeHtml(DIRECTION_LABEL[claim.direction])}">${DIRECTION_GLYPH[claim.direction]}</span>`
    : '';

  return `      <li>${glyph}${writeClaim(claim.text)}
        <div class="span">
          <span class="spanlabel">the company's own words</span>
          <span class="spantext">&ldquo;${escapeHtml(claim.span)}&rdquo;</span>
        </div>
      </li>`;
};

/** One example card. The fields a real card carries, and no others. */
const renderCard = (card: SampleCard): string => `
  <article class="card" data-ui="sample-card">
    <span class="exbadge">Example</span>
    <header class="cardhead">
      <div class="who">
        <span class="sym">${escapeHtml(card.symbol)}</span>
        <span class="coname">${escapeHtml(card.companyName)}</span>
      </div>
      <span class="when">${escapeHtml(card.when)}</span>
    </header>
${
  card.resultsLine === null
    ? ''
    : `    <div class="resultsline">${escapeHtml(card.resultsLine)}</div>\n`
}    <ul class="insights">
${card.claims.map(renderClaim).join('\n')}
    </ul>
    <footer class="cardfoot">
      <span class="tier tier-${escapeHtml(card.tier)}">${escapeHtml(card.tierLabel)}</span>
      <span class="grouptag">${escapeHtml(card.categoryGroupLabel)}</span>
      <span class="cardcat">${escapeHtml(card.category)}</span>
    </footer>
  </article>`;

/**
 * The three numbers, and none of them is a measurement.
 *
 * THIS IS THE HARD PART OF AN HONEST LANDING PAGE. The obvious three are
 * filings held, companies covered and claims verified — and every one of them is
 * either a live read (which this page does not perform) or a figure quoted from
 * a database pass months ago, which is a stale number a visitor cannot check.
 * The company-page spec already learned what a stale quoted number costs: one
 * was wrong by a factor of 7.6.
 *
 * So the three are INVARIANTS — properties of how the system is built, true on
 * every day it runs, checkable by anyone who signs in and looks. "Zero numbers
 * we work out ourselves" is not a boast about volume; it is the rule this
 * product is built on, said in the reader's words rather than in ours.
 */
const STATS: ReadonlyArray<{
  value: string;
  accent?: boolean;
  label: string;
  note: string;
}> = [
  {
    value: 'NSE + BSE',
    label: 'both exchanges, all day',
    note: 'We watch announcements as companies file them, and a document filed on both exchanges shows up once rather than twice.',
  },
  {
    value: '100%',
    accent: true,
    label: 'of what you read is quoted from the document',
    note: 'Under every line is the sentence it came from, word for word. If we cannot show you where a sentence came from, we do not show you the sentence.',
  },
  {
    value: '0',
    label: 'numbers we work out ourselves',
    note: 'No margins, no growth rates, no ratios. If the company did not print the number, you will not read it here.',
  },
];

const renderStat = (stat: (typeof STATS)[number]): string => `
      <div class="stat">
        <div class="statvalue${stat.accent === true ? ' accent' : ''}">${escapeHtml(stat.value)}</div>
        <div class="statlabel">${escapeHtml(stat.label)}</div>
        <div class="statnote">${escapeHtml(stat.note)}</div>
      </div>`;

/**
 * What a reader gets, in the order they would ask for it.
 *
 * THE THREE ARE BENEFITS, NOT STAGES, and the list is unnumbered for that
 * reason: a numbered list promises an order, and there is none here. Each one is
 * a sentence a reader could repeat to somebody else, which is the test this copy
 * has to pass and the old "how it works" section did not.
 */
const GETS: ReadonlyArray<{ head: string; body: string }> = [
  {
    head: 'Everything, as it arrives',
    body: 'Both exchanges, all through the trading day. Nothing to refresh and nothing to go looking for.',
  },
  {
    head: 'The exact line, every time',
    body: "Under everything we show you is the sentence it came from, in the company's own words. You never have to take our word for it.",
  },
  {
    head: 'Only the companies you care about',
    body: 'Follow a company and everything it files collects in one place, in plain English, in the order it happened.',
  },
];

/** The things this product refuses to do, said before anyone signs up. */
const NEVERS: ReadonlyArray<{ head: string; body: string }> = [
  {
    head: 'We never tell you what to buy.',
    body: `${BRAND} shows you what a company said and where it said it. It has no view on the company or on its shares, and it never will.`,
  },
  {
    head: 'We never do the maths for you.',
    body: 'A margin worked out from two numbers in a document is a number the company never published, and there is no way for you to check it.',
  },
  {
    head: 'An arrow follows the number, not the company.',
    body: 'A falling bad-loan figure points down, and that is good news. The words beside the arrow are what you read.',
  },
  {
    head: 'One document, one company.',
    body: 'If a filing covers several companies at once, we leave it out rather than guess which one it was about.',
  },
];

/**
 * The landing page: one self-contained HTML document, no script, no reads.
 *
 * Returns a constant. It takes no arguments on purpose — a landing page that
 * varied with request state would be a landing page with request state to get
 * wrong, and this one is served identically to everyone who is not signed in.
 */
export const renderLandingPage = (): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="dark">
<title>${BRAND} — ${BRAND_TAGLINE}</title>
<meta name="description" content="See what Indian companies told the exchange today, with the exact line from the document under everything you read.">
<!-- The icon travels in the attribute; nothing is fetched. See logo.ts. -->
${BRAND_FAVICON_LINK}
<style>${LANDING_STYLE}${BRAND_LOGO_STYLE}</style>
</head>
<body>

<header class="top">
  <div class="wrap" style="display:flex;align-items:center;gap:12px">
    ${BRAND_LOGO}
    <span class="grow"></span>
    <a class="go small" href="/auth" data-ui="signin-top">Sign in</a>
  </div>
</header>

<main>

<!-- ============================= HERO ============================== -->
<!--
  THE HEADLINE SAYS ONE FALSIFIABLE THING, IN THE READER'S WORDS. Not "the
  fastest", not "AI-powered", not a number nobody can check — and not this
  project's own vocabulary either. Nobody outside this repository knows what a
  span or a verbatim gate is, and a stranger who has to learn a word before the
  promise makes sense has been asked to do the work the page exists to do.
  Everything below says what a reader gets and what they can check.
-->
<section class="wrap hero">
  <h1 class="h1">See what companies <em>actually told</em> the exchange.</h1>
  <p class="lede">
    Every listed company in India has to tell the exchange when something
    happens — results, a big order, a change at the top. We read those documents
    as they arrive and show you what the company said, <strong>with the exact
    line from the document underneath. Never our opinion.</strong>
  </p>
  <div class="cta">
    <a class="go" href="/auth" data-ui="signin-hero">Sign in or create an account</a>
    <span class="ctanote">Free while in early access.</span>
  </div>

  <div class="stats" data-ui="landing-stats">${STATS.map(renderStat).join('')}
  </div>
</section>

<!-- ============================ EXAMPLES =========================== -->
<section class="wrap band">
  <p class="eyebrow">What a day looks like</p>
  <h2 class="h2">The company's own words, under every line.</h2>
  <p class="body">
    Each card is one document a company filed. The lines are what the company
    said, and under each one is the sentence it came from — so you can check it
    yourself in a second, without taking anyone's word for it.
  </p>

  <!--
    THE DISCLAIMER IS ABOVE THE CARDS, NOT BELOW THEM, and each card repeats it
    on its own corner. A visitor must not be able to reach a ticker without
    having passed the word "example", and a screenshot of one card has to carry
    its own label.
  -->
  <div class="examplenote" data-ui="sample-notice">
    <div>
      <strong>These are examples, not filings.</strong>
      The companies, figures and quoted sentences below are made up, to show what
      a card looks like. You are not signed in, so this page shows you nothing
      from our records — sign in to see what companies actually filed today.
    </div>
  </div>

  <div class="cards" data-ui="sample-cards">${SAMPLE_CARDS.map(renderCard).join('')}
  </div>
</section>

<!-- ============================ WHAT YOU GET ======================= -->
<!--
  WHAT REPLACED THE PIPELINE DIAGRAM. This band used to be three numbered steps
  describing how the system works internally, ending in an example of something
  the system threw away. It was the most honest section on the page and the one
  written entirely for us: a stranger deciding whether to sign up does not need
  to know what happens between the exchange and the screen, only what they get
  and what they can check. The honesty moved into the three reasons below and
  into the limits under them, in words nobody has to learn.
-->
<section class="wrap band">
  <p class="eyebrow">Why people use it</p>
  <h2 class="h2">Read the day in five minutes, not fifty documents.</h2>

  <ul class="gets" data-ui="what-you-get">
${GETS.map(
  (get) => `    <li class="get">
      <div class="gettitle">${escapeHtml(get.head)}</div>
      <div class="getbody">${escapeHtml(get.body)}</div>
    </li>`,
).join('\n')}
  </ul>
</section>

<!-- =========================== NEVER DOES ========================== -->
<section class="wrap band">
  <p class="eyebrow">Where we stop</p>
  <h2 class="h2">Four things we will never do.</h2>

  <ul class="nevers">
${NEVERS.map(
  (never) => `    <li class="never">
      <div><strong>${escapeHtml(never.head)}</strong> <span>${escapeHtml(never.body)}</span></div>
    </li>`,
).join('\n')}
  </ul>
</section>

<!-- ============================== CLOSE ============================ -->
<section class="wrap">
  <div class="close">
    <h2 class="h2">See what companies said today.</h2>
    <p class="body">
      Sign in with Google. Follow the companies you care about and everything
      they file collects in one place.
    </p>
    <div class="cta">
      <a class="go" href="/auth" data-ui="signin-close">Sign in or create an account</a>
    </div>
  </div>
</section>

</main>

<footer class="foot">
  <div class="wrap">
    <span class="footmark">${escapeHtml(BRAND)}</span> &middot; ${escapeHtml(BRAND_DOMAIN)}<br>
    A record of Indian corporate filings. Not investment advice, and not a
    recommendation about any company or security. All times are IST.
  </div>
</footer>

</body>
</html>
`;
