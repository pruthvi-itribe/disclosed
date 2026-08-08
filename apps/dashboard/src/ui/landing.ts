import { BRAND, BRAND_DOMAIN, BRAND_MARK, BRAND_TAGLINE } from './brand';
import { LANDING_STYLE } from './landing-style';
import {
  SAMPLE_CARDS,
  SAMPLE_DISCARD,
  WORKED_EXAMPLE,
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

/** Spelled out for a reader who cannot see the glyph. Describes the DOCUMENT. */
const DIRECTION_LABEL: Readonly<Record<string, string>> = {
  expansion: 'increase printed',
  contraction: 'decrease printed',
  mixed: 'both printed',
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
          <span class="spanlabel">matched in the filing</span>
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
 * every day it runs, checkable by anyone who signs in and looks. "Zero figures
 * we calculate" is not a boast about volume; it is the verbatim gate, stated as
 * a number.
 */
const STATS: ReadonlyArray<{
  value: string;
  accent?: boolean;
  label: string;
  note: string;
}> = [
  {
    value: 'NSE + BSE',
    label: 'both exchanges, all session',
    note: 'Announcements are polled as they are disseminated, and the same filing arriving on both is recognised as one.',
  },
  {
    value: '100%',
    accent: true,
    label: 'of published claims quote the filing',
    note: 'Every claim is matched character for character against a span of the source document. One that cannot be matched is discarded, not softened.',
  },
  {
    value: '0',
    label: 'figures calculated by us',
    note: 'No margins, no growth rates, no ratios. If the filing did not print the number, you will not read it here.',
  },
];

const renderStat = (stat: (typeof STATS)[number]): string => `
      <div class="stat">
        <div class="statvalue${stat.accent === true ? ' accent' : ''}">${escapeHtml(stat.value)}</div>
        <div class="statlabel">${escapeHtml(stat.label)}</div>
        <div class="statnote">${escapeHtml(stat.note)}</div>
      </div>`;

/** The things this product refuses to do, said before anyone signs up. */
const NEVERS: ReadonlyArray<{ head: string; body: string }> = [
  {
    head: 'No ratings, targets or recommendations.',
    body: `${BRAND} reports what documents say and shows you where they say it. It does not have a view on a company or its shares.`,
  },
  {
    head: 'No calculated figures.',
    body: 'A margin derived from two numbers in a filing is a number the filing never printed, and nothing downstream can tell a right one from a wrong one.',
  },
  {
    head: 'No sentiment.',
    body: 'A movement mark follows the figure, never the company. A falling default rate points down and is good news; the claim beside it is what you read.',
  },
  {
    head: 'No guessing at a shared document.',
    body: 'A filing that covers several companies is refused rather than attributed to one of them.',
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
<meta name="description" content="Every claim matched, character for character, against the filing it came from. Indian corporate announcements from NSE and BSE.">
<style>${LANDING_STYLE}</style>
</head>
<body>

<header class="top">
  <div class="wrap" style="display:flex;align-items:center;gap:12px">
    <span class="mark">${BRAND_MARK.word}<span class="dotmark">${BRAND_MARK.accent}</span></span>
    <span class="grow"></span>
    <a class="go small" href="/auth" data-ui="signin-top">Sign in</a>
  </div>
</header>

<main>

<!-- ============================= HERO ============================== -->
<!--
  THE HEADLINE MAKES ONE CLAIM AND IT IS A FALSIFIABLE ONE. Not "the fastest",
  not "AI-powered", not a number nobody can check — a statement about method
  that anybody who signs in can test against any card on the feed.
-->
<section class="wrap hero">
  <h1 class="h1">What Indian companies <em>disclosed</em> today.</h1>
  <p class="lede">
    Corporate filings from NSE and BSE, read as they land — and
    <strong>every claim matched, character for character, against a span of the
    document it came from</strong>. A claim that cannot be checked is a claim
    that does not ship.
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
  <h2 class="h2">The card is the claim, and the claim quotes the filing.</h2>
  <p class="body">
    Each card is one filing. The lines are what the company said; underneath each
    one is the sentence from the document that it was matched against, so you can
    check it without taking anyone's word for it.
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
      The companies, figures and quoted sentences below are invented to show the
      shape of a card. Signed-out visitors read no data from this service at all
      — sign in to see what was actually filed today.
    </div>
  </div>

  <div class="cards" data-ui="sample-cards">${SAMPLE_CARDS.map(renderCard).join('')}
  </div>
</section>

<!-- ============================== PROOF ============================ -->
<section class="wrap band">
  <p class="eyebrow">How a claim gets published</p>
  <h2 class="h2">Three steps, and the third one is the product.</h2>

  <ol class="steps" data-ui="how-it-works">
    <li class="step">
      <span class="stepnum">1</span>
      <div>
        <div class="steptitle">The filing arrives</div>
        <div class="stepbody">
          An announcement is disseminated by the exchange. The attachment — usually
          a PDF — is fetched and read into text.
        </div>
      </div>
    </li>
    <li class="step">
      <span class="stepnum">2</span>
      <div>
        <div class="steptitle">A claim is proposed, and a span is looked for</div>
        <div class="stepbody">
          A model reads the document and proposes what it says. Each proposal is
          then searched for in the document itself, character for character.
        </div>
      </div>
    </li>
    <li class="step">
      <span class="stepnum">3</span>
      <div>
        <div class="steptitle">Whatever was not found is thrown away</div>
        <div class="stepbody">
          Not flagged, not shown with a warning, not published at lower
          confidence. Discarded — and kept, with the rule that refused it, so the
          gate can be audited rather than trusted.
        </div>
      </div>
    </li>
  </ol>

  <p class="body" style="margin-top:22px">
    <strong>This is what step two looks like.</strong>
    The claim on the left of the card above, and the sentence in the document
    that admitted it:
  </p>

  <div class="card" style="margin-top:14px">
    <span class="exbadge">Example</span>
    <ul class="insights">
${renderClaim(WORKED_EXAMPLE)}
    </ul>
  </div>

  <!--
    THE DENOMINATOR, AND IT IS THE LEAST MARKETING-SHAPED THING ON THIS PAGE.
    Three verified cards and nothing else hides that a fourth claim was proposed
    and refused. The precision claim means nothing without this, so it is on the
    landing page rather than in a methodology note nobody opens.
  -->
  <p class="body" style="margin-top:26px">
    <strong>And this is what step three looks like.</strong>
    The same document also produced this, and it is not on the card:
  </p>

  <div class="discard" data-ui="sample-discard">
    <div class="discardline">${escapeHtml(SAMPLE_DISCARD.text)}</div>
    <div class="discardwhy">
      <code>${escapeHtml(SAMPLE_DISCARD.reason)}</code>
      &nbsp;${escapeHtml(SAMPLE_DISCARD.why)}
    </div>
  </div>
</section>

<!-- =========================== NEVER DOES ========================== -->
<section class="wrap band">
  <p class="eyebrow">What it will not do</p>
  <h2 class="h2">The limits are the point, so they are on the front page.</h2>

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
    <h2 class="h2">See what was filed today.</h2>
    <p class="body">
      Sign in with Google, or with an email address and a password. Pick the
      companies you care about and everything they file collects in one place.
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
