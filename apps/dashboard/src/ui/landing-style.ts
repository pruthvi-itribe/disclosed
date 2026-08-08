/**
 * The landing page's stylesheet, inlined.
 *
 * SAME RULES AS `page-style.ts`, and they are not relaxed for a marketing page:
 * no `@import`, no `url(...)`, no web font, no CDN. A landing page that pulls a
 * typeface from a third party gives that third party a request log of everyone
 * who has ever considered signing up, and it does it on the one page served to
 * people who have not agreed to anything yet.
 *
 * SAME TOKENS AS THE PRODUCT, on purpose. The palette, the two font stacks and
 * the card geometry are lifted from `page-style.ts` rather than reinvented, so
 * the moment after sign-in looks like the moment before it. A landing page in a
 * different visual language is a promise the product then breaks.
 *
 * PHONE FIRST, and this file is written in that order: every rule below is the
 * narrow layout, and the two media queries at the bottom add columns. The feed
 * is a desktop object and the Brief is a phone object — see `page.ts` — but a
 * landing page is overwhelmingly a phone object, because that is where a link
 * gets opened.
 */
export const LANDING_STYLE = `
:root {
  --bg: #0d1117;
  --panel: #161b22;
  --panel-2: #1c2430;
  --line: #2a323d;
  --text: #e6edf3;
  --muted: #8b949e;
  --accent: #58a6ff;
  --ok: #3fb950;
  --warn: #d29922;
  --bad: #f85149;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --sans: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  background: var(--bg);
  color: var(--text);
  font-family: var(--sans);
  font-size: 16px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}
/* Every band shares one measure, so nothing on the page is ragged against
   anything else. 1080px rather than the app's 1680: this is prose and cards
   read at prose width, not at dashboard width. */
/* LONGHANDS, NOT THE SHORTHAND, and this cost a real bug. '.wrap' and '.band'
   are used together on one element, so two 'padding' shorthands collided: the
   media query at the bottom re-declared '.wrap { padding: 0 32px }' and wiped
   '.band''s 72px top padding, collapsing every section break on screens wider
   than 700px to nothing. Longhands cannot do that to each other. */
.wrap {
  width: 100%; max-width: 1080px; margin: 0 auto;
  padding-left: 20px; padding-right: 20px;
}
.muted { color: var(--muted); }
.mono { font-family: var(--mono); font-variant-numeric: tabular-nums; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }

/* ------------------------------------------------------------- topbar ---- */
.top {
  display: flex; align-items: center; gap: 12px;
  padding: 16px 0; border-bottom: 1px solid var(--line);
}
/* The wordmark and its mark are logo.ts, so this page, the app and the
   sign-in page cannot end up with three slightly different logos. */
.grow { flex: 1 1 auto; }

/* The one control in the header, and it is the same control as the one in the
   hero. Two different-looking sign-in buttons on one page is two products. */
.go {
  display: inline-block;
  background: var(--accent); color: #08111f;
  border: 1px solid var(--accent); border-radius: 10px;
  font: inherit; font-weight: 620; font-size: 15px;
  padding: 11px 22px; cursor: pointer; text-decoration: none;
  white-space: nowrap;
}
.go:hover { text-decoration: none; filter: brightness(1.08); }
.go:focus-visible { outline: 2px solid var(--text); outline-offset: 2px; }
.go.small { font-size: 13px; padding: 7px 14px; border-radius: 8px; }
.go.ghost { background: transparent; color: var(--text); border-color: var(--line); }
.go.ghost:hover { border-color: var(--muted); filter: none; }

/* --------------------------------------------------------------- hero ---- */
.hero { padding-top: 44px; padding-bottom: 8px; }
.h1 {
  margin: 0;
  /* Fluid rather than stepped. The headline is the one element whose size at
     360px and at 1080px genuinely differs, and two media-query breakpoints
     would put an ugly jump in the middle of the only sentence that matters. */
  font-size: clamp(30px, 7.4vw, 54px);
  line-height: 1.08;
  letter-spacing: -0.035em;
  font-weight: 680;
  max-width: 15ch;
}
.h1 em { font-style: normal; color: var(--accent); }
.lede {
  margin: 18px 0 0;
  font-size: clamp(16px, 4.2vw, 19px);
  line-height: 1.5;
  color: var(--muted);
  max-width: 56ch;
}
.lede strong { color: var(--text); font-weight: 600; }
.cta { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-top: 26px; }
.ctanote { color: var(--muted); font-size: 13px; }

/* -------------------------------------------------------------- stats ---- */
/* THE THREE ARE INVARIANTS, NOT MEASUREMENTS, and the styling follows from
   that: no live dot, no "as of", nothing that implies a clock. A landing page
   quoting a count from a database it read four months ago is the same class of
   error as a stale comment, and it is one a visitor cannot check. */
.stats {
  display: grid; grid-template-columns: 1fr; gap: 2px;
  margin: 38px 0 0; border: 1px solid var(--line); border-radius: 14px;
  overflow: hidden; background: var(--line);
}
.stat { background: var(--bg); padding: 18px 20px; }
.statvalue {
  font-family: var(--mono); font-variant-numeric: tabular-nums;
  font-size: 30px; font-weight: 620; letter-spacing: -0.02em; line-height: 1.1;
}
.statvalue.accent { color: var(--ok); }
.statlabel { margin-top: 6px; font-size: 14px; font-weight: 560; }
.statnote { margin-top: 3px; color: var(--muted); font-size: 12.5px; line-height: 1.45; }

/* ------------------------------------------------------------- bands ----- */
.band { padding-top: 52px; }
.band:last-of-type { padding-bottom: 60px; }
.eyebrow {
  font-size: 11px; text-transform: uppercase; letter-spacing: .13em;
  color: var(--muted); font-weight: 640; margin: 0 0 10px;
}
.h2 {
  margin: 0; font-size: clamp(21px, 5.2vw, 28px); line-height: 1.2;
  letter-spacing: -0.025em; font-weight: 660; max-width: 24ch;
}
.body { margin: 12px 0 0; color: var(--muted); max-width: 62ch; font-size: 15.5px; }
.body strong { color: var(--text); font-weight: 600; }

/* THE EXAMPLE LABEL. Loud enough that nobody reaches a card without having read
   it: a warn-coloured rule and the word "examples" before the first ticker. It
   is the one piece of chrome on this page that exists to make the page mean
   LESS than it appears to. */
.examplenote {
  display: flex; align-items: flex-start; gap: 10px;
  margin: 18px 0 16px; padding: 11px 14px;
  border: 1px solid rgba(210, 153, 34, .45);
  background: rgba(210, 153, 34, .08);
  border-radius: 10px; font-size: 13.5px; line-height: 1.5;
}
.examplenote strong { color: var(--warn); font-weight: 640; }

.cards { display: grid; grid-template-columns: 1fr; gap: 14px; }
/* Lifted from page-style.ts so a card here is the card there. */
.card {
  background: var(--panel); border: 1px solid var(--line);
  border-radius: 14px; padding: 16px 18px;
  display: flex; flex-direction: column;
  position: relative;
  /* MEASURED, NOT DECORATIVE. A grid item's default minimum is its CONTENT
     width, so the results line below — one monospaced row set 'nowrap' — made
     the column as wide as the longest filing rather than as wide as the phone.
     At 390px the document scrolled 243px sideways, which 'e2e/landing.spec.ts'
     caught. 'min-width: 0' is what lets the item shrink and lets the results
     line's own 'overflow-x' do the scrolling instead of the page. */
  min-width: 0;
}
/* The badge sits ON the card rather than beside it, so a screenshot of one card
   carries its own disclaimer. */
.card .exbadge {
  position: absolute; top: -1px; right: 14px;
  background: var(--warn); color: #1b1400;
  font-size: 10px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase;
  padding: 3px 8px; border-radius: 0 0 6px 6px;
}
/* WRAPS RATHER THAN TRUNCATES, unlike the feed's version of this row, and the
   difference is the column width. In the app a card sits in a 400px grid
   column and the name is one of sixty on screen, so an ellipsis is the right
   trade. Here there are three cards, each one is an argument, and
   "Northfield Steel Works Limited" rendered as "North…" makes the example look
   like a bug rather than like a filing. The time drops to its own line when the
   name needs the room. */
.cardhead {
  display: flex; align-items: baseline; gap: 4px 10px; flex-wrap: wrap;
  margin-bottom: 10px; padding-right: 74px;
}
.who { display: flex; align-items: baseline; gap: 8px; min-width: 0; flex: 1 1 auto; flex-wrap: wrap; }
.sym { font-size: 17px; font-weight: 680; letter-spacing: -0.01em; }
.coname { color: var(--muted); font-size: 12.5px; min-width: 0; }
.when { color: var(--muted); font-size: 12px; white-space: nowrap; }

.resultsline {
  font-family: var(--mono); font-size: 13px; line-height: 1.5;
  color: var(--text); background: var(--panel-2);
  border: 1px solid var(--line); border-radius: 8px;
  padding: 8px 11px; margin-bottom: 11px;
  overflow-x: auto; white-space: nowrap;
}

.insights { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 9px; }
.insights { min-width: 0; }
/* A quoted span from a PDF can carry a token with no break opportunity in it —
   a URL, a scrip code, a run of digits — and one of those in a 390px column
   widens the column rather than wrapping. 'anywhere' is the only value that
   breaks mid-token as a last resort. */
.insights li {
  font-size: 15.5px; line-height: 1.45; font-weight: 480;
  padding-left: 14px; position: relative;
  min-width: 0; overflow-wrap: anywhere;
}
.insights li::before {
  content: ""; position: absolute; left: 0; top: .62em;
  width: 5px; height: 5px; border-radius: 50%; background: var(--accent);
}
.insights .fig { font-variant-numeric: tabular-nums; font-weight: 620; color: #fff; }
/* NO COLOUR ON THE MARK. The product's rule, restated in the product's own
   words in page-style.ts: red and green are a view about the company, and the
   third card below is a decrease that is good news. */
.insights .dir { color: inherit; font-size: 11px; margin-right: 6px; vertical-align: 1px; opacity: .75; }

/* The span, under its claim. In the app this lives one click down; here it is
   the reason the page exists, so it is always open. */
.span {
  margin: 7px 0 0 14px; padding: 8px 12px;
  border-left: 2px solid rgba(88, 166, 255, .35);
  background: rgba(88, 166, 255, .045);
  border-radius: 0 8px 8px 0;
  color: var(--muted); font-size: 13px; line-height: 1.55;
}
.spanlabel {
  display: block; font-size: 10px; text-transform: uppercase;
  letter-spacing: .1em; color: var(--muted); opacity: .8; margin-bottom: 3px;
}
.spantext { color: var(--text); font-weight: 420; }

.cardfoot {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  margin-top: 14px; padding-top: 11px; border-top: 1px solid var(--line);
  font-size: 11px;
}
.tier {
  border-radius: 999px; padding: 2px 9px; font-size: 11px;
  border: 1px solid var(--line); white-space: nowrap;
}
.tier-verified { color: var(--ok); border-color: rgba(63, 185, 80, 0.55); background: rgba(63, 185, 80, 0.12); }
.cardcat { color: var(--muted); flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.grouptag {
  border-radius: 999px; padding: 2px 9px; border: 1px solid var(--line);
  color: var(--muted); white-space: nowrap;
}

/* -------------------------------------------------------------- proof ---- */
/* The three steps, as one numbered column. Numbered because the order is the
   argument: the span is matched BEFORE anything is published, not audited
   afterwards. */
.steps { list-style: none; margin: 22px 0 0; padding: 0; display: grid; gap: 2px; border-radius: 14px; overflow: hidden; background: var(--line); border: 1px solid var(--line); }
.step { background: var(--bg); padding: 18px 20px; display: flex; gap: 14px; align-items: flex-start; }
.stepnum {
  flex: 0 0 auto; width: 26px; height: 26px; border-radius: 50%;
  border: 1px solid var(--line); background: var(--panel);
  font-family: var(--mono); font-size: 12px; font-weight: 640;
  display: flex; align-items: center; justify-content: center; color: var(--muted);
}
.steptitle { font-weight: 600; font-size: 15.5px; }
.stepbody { color: var(--muted); font-size: 14px; margin-top: 3px; line-height: 1.5; }

/* The discarded claim. Struck through, in the refusal colour, with the reason
   the gate gave. */
.discard {
  margin-top: 16px; padding: 14px 16px;
  border: 1px dashed rgba(248, 81, 73, .45); border-radius: 12px;
  background: rgba(248, 81, 73, .05);
}
.discardline { color: var(--muted); text-decoration: line-through; font-size: 15px; }
.discardwhy { margin-top: 7px; font-size: 13.5px; color: var(--muted); line-height: 1.5; }
.discardwhy code {
  font-family: var(--mono); font-size: 12px; color: var(--bad);
  border: 1px solid rgba(248, 81, 73, .3); border-radius: 5px; padding: 1px 5px;
}

/* --------------------------------------------------------- never does ---- */
.nevers { list-style: none; margin: 20px 0 0; padding: 0; display: grid; gap: 10px; }
.never { display: flex; gap: 11px; align-items: flex-start; font-size: 15px; line-height: 1.5; }
/* An em dash in a pseudo-element rather than a cross glyph: the emoji range is
   rejected by the page tests, and a bullet that means "not" is worth spelling
   with the word "No" in the text instead of trusting an icon. */
.never::before { content: "\\2014"; color: var(--bad); flex: 0 0 auto; font-weight: 700; }
.never strong { font-weight: 600; }
.never span { color: var(--muted); }

/* -------------------------------------------------------------- close ---- */
.close {
  margin: 52px 0 0; padding: 32px 24px;
  border: 1px solid var(--line); border-radius: 18px;
  background: var(--panel);
  text-align: center;
}
.close .h2 { max-width: none; margin: 0 auto; }
.close .body { margin: 12px auto 0; }
.close .cta { justify-content: center; }

footer.foot {
  border-top: 1px solid var(--line); margin-top: 52px; padding: 22px 0 40px;
  color: var(--muted); font-size: 13px; line-height: 1.6;
}
.footmark { color: var(--text); font-weight: 600; }

/* ------------------------------------------------------- wider screens --- */
@media (min-width: 700px) {
  .stats { grid-template-columns: repeat(3, 1fr); }
  .hero { padding-top: 64px; }
  .band { padding-top: 72px; }
  .wrap { padding-left: 32px; padding-right: 32px; }
}
@media (min-width: 940px) {
  .cards { grid-template-columns: repeat(3, 1fr); align-items: start; }
}

/* Honoured here as it is in the app. Nothing on this page depends on motion to
   be understood, so the safest reading of the preference is to remove it. */
@media (prefers-reduced-motion: reduce) {
  * { animation: none !important; transition: none !important; }
}
`;
