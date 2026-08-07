/**
 * The Brief's stylesheet, concatenated onto `PAGE_STYLE` by `page.ts`.
 *
 * WHY IT IS ITS OWN FILE. `page-style.ts` is past the 800-line ceiling
 * CLAUDE.md sets, and the deck's rules are a self-contained layout for one
 * view rather than more of the feed's — so they file separately instead of
 * making a file that is already too long worse.
 *
 * NOTHING here may reference a URL, for the reason `page-style.ts` gives: this
 * page must render identically on a machine with no network at all.
 *
 * NO BACKTICK, NO `${`, AND NO BACKSLASH may appear inside the literal below —
 * this is a TypeScript template literal, so a backslash before a digit is read
 * as an octal escape and rejected, and that is true of a comment as much as of
 * a rule, because a comment inside a template literal is still string content.
 */
export const PAGE_STYLE_BRIEF = `

/* ========================================================================
   THE BRIEF: the day as a finite, countable deck.

   THE MECHANISM IS scroll-snap AND NOTHING ELSE. No timer advances a card and
   no script hijacks a scroll: a reader who looks away must not lose their
   place, and a deck that plays itself is a video, which is a different product
   with a different cost. This is also the least portable thing in the
   codebase — iOS Safari, Android Chrome and Firefox differ on dvh during
   URL-bar collapse and on overscroll inside a snap container — and the
   alternative, JS-driven paging, is worse and is what everyone regrets.
   ======================================================================== */

/* THE DECK OWNS THE VIEWPORT WHILE IT IS OPEN, and the class is set by
   showView() rather than inferred, so exactly one view is ever in this mode.

   dvh, NOT vh. iOS Safari's collapsing URL bar makes a card measured in vh
   taller than the visible viewport, which would put the footer of every card
   under the browser chrome — the one part of a card a reader has to be able to reach,
   because it holds the source document. */
body.briefing {
  padding: 0;
  height: 100dvh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  max-width: none;
}
body.briefing .topbar { padding: 10px 16px; margin: 0; gap: 12px; }
/* The page's own account of itself is eight paragraphs. It belongs under the
   feed and the admin panel; under a deck sized to the viewport it is content
   nobody can reach and a scrollbar nobody asked for.

   THE CHILD COMBINATOR IS LOAD-BEARING. Written as a descendant selector this
   rule also hid every CARD's footer — the row holding the tier badge, Copy and
   the only link to the source document — and did it invisibly, because a card
   whose foot is display:none still lays out and still reads as finished. The
   browser test caught it; no string test could have. */
body.briefing > footer { display: none; }
body.briefing #view-brief { flex: 1 1 auto; min-height: 0; }

#view-brief { display: flex; flex-direction: column; min-height: 0; }
/* The id beats .view[hidden] on specificity, so the hidden rule is restated
   here. Without this line the deck is visible in every view at once. */
#view-brief[hidden] { display: none; }

/* --- the rail ----------------------------------------------------------- */

/* A PROMISE ABOUT TIME, drawn as one segment per card: twelve of these is
   about a minute. Suppressed below three cards by the script, because a
   two-segment progress bar is chrome rather than information. */
#brief-rail {
  display: flex;
  gap: 3px;
  flex: 0 0 auto;
  padding: 0 16px 10px;
}
#brief-rail[hidden] { display: none; }
[data-ui="brief-rail-seg"] {
  flex: 1 1 0;
  height: 3px;
  border-radius: 2px;
  background: var(--line);
  transition: background 180ms ease;
}
[data-ui="brief-rail-seg"].on { background: var(--text); }

/* --- the deck ----------------------------------------------------------- */

/* position: relative so a card's offsetTop is measured against the deck's own
   content box, which is what the keyboard step compares to scrollTop. */
#brief-deck {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  scroll-snap-type: y mandatory;
  overscroll-behavior-y: contain;
  scroll-behavior: smooth;
}
#brief-deck[hidden] { display: none; }

/* EVERY CARD IS EXACTLY ONE VIEWPORT, which is what lets the lede be set at
   25px without any card in the deck changing height: a 120-character claim —
   the hard cap claim-verify.ts enforces — wraps to four lines at 390px and
   occupies about 128px, and the card has room for that at its maximum.

   100% of the deck rather than of the window, because the tab bar is above the
   deck and a card measured against the window would hide its own footer behind
   it. The deck's own height comes from body.briefing's 100dvh. */
.bcard {
  min-height: 100%;
  scroll-snap-align: start;
  display: flex;
  flex-direction: column;
  padding: 20px 22px calc(20px + env(safe-area-inset-bottom));
  border-top: 1px solid var(--line);
}
.bcard:focus { outline: none; }
.bcard:focus-visible { outline: 2px solid var(--accent); outline-offset: -4px; }

/* --- one company-day ---------------------------------------------------- */

/* THE TIME SITS WITH THE NAME, NOT WITH THE TICKER, and that is measured
   rather than a preference. UNIVCABLES at 34px plus the server's whole IST
   string is 430px of content in the 346px a 390px phone leaves, so on the
   ticker's line the timestamp ran out through the card's own padding. On the
   13px line it is 295px and fits, and it wraps rather than overflowing when a
   company name is long. */
.bmeta {
  display: flex;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 2px;
}
.bsym {
  font-size: 34px;
  font-weight: 700;
  letter-spacing: -0.02em;
  font-family: inherit;
  background: transparent;
  border: 0;
  padding: 0;
  color: var(--text);
  cursor: pointer;
  text-align: left;
}
.bsym:hover { color: var(--accent); }
.bwhen {
  margin-left: auto;
  font-size: 12px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.bname { font-size: 13px; color: var(--muted); min-width: 0; }

/* THE CLAIM IS THE CARD. Set at the size of a headline because it is one, and
   because MAX_CLAIM_CHARS = 120 guarantees it fits: no other string in this
   product can be given a whole screen without a truncation rule.

   overflow-wrap because claim text is exchange-derived and can carry a very
   long unbroken token, and a card that overflows sideways breaks the one
   gesture this view has. */
.blede {
  font-size: 25px;
  line-height: 1.28;
  font-weight: 500;
  margin: 26px 0 0;
  overflow-wrap: anywhere;
}
/* The figures the document printed, marked and not computed. Brighter and a
   touch larger, tabular so a column of them lines up. */
.blede .fig {
  font-size: 1.12em;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: #fff;
}
.brest {
  list-style: none;
  margin: 20px 0 0;
  padding: 0;
  font-size: 15px;
  line-height: 1.4;
  color: var(--muted);
  overflow-wrap: anywhere;
}
.brest li { margin-bottom: 9px; padding-left: 14px; position: relative; }
.brest li::before {
  content: "";
  position: absolute;
  left: 0;
  top: 8px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--line);
}
.brest .fig { font-variant-numeric: tabular-nums; color: var(--text); }

.bmore {
  align-self: flex-start;
  margin-top: 14px;
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  background: transparent;
  border: 0;
  padding: 0;
  font: inherit;
  font-size: 13px;
  color: var(--accent);
  cursor: pointer;
}

/* The topic, and the way back into the feed filtered by it. Pushed to the
   bottom of the card with the foot, so the claim keeps the top of the screen
   whatever the card holds. */
.btopic {
  align-self: flex-start;
  margin-top: auto;
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: transparent;
  border: 0;
  padding: 0;
  font: inherit;
  font-size: 13px;
  color: var(--muted);
  cursor: pointer;
}
.btopic:hover { color: var(--text); }

/* ONE AUTO MARGIN PER CARD, NOT TWO. Both the topic and the foot want to sit
   at the bottom, and giving both margin-top: auto splits the free space
   BETWEEN them — which drew 180px of nothing under the topic dot. The topic
   takes the auto when it is there; the adjacent-sibling rule below takes it
   back off the foot, and the foot keeps it when there is no topic. */
.bfoot {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: auto;
  padding-top: 12px;
  border-top: 1px solid var(--line);
  font-size: 11px;
}
.btopic + .bfoot { margin-top: 12px; }
.bcat {
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
/* Every control on the foot is a 44px tap target including its padding: this
   is the row a thumb reaches for on a moving train. */
.bfoot .copy, .bfoot .srclink {
  min-height: 44px;
  display: inline-flex;
  align-items: center;
}

/* --- card 0, the day ---------------------------------------------------- */

.bcover { justify-content: center; gap: 14px; }
.bday { font-size: 13px; color: var(--muted); font-variant-numeric: tabular-nums; }
.btitle { font-size: 30px; font-weight: 680; letter-spacing: -0.02em; margin: 0; }
.bcover .mix { height: 8px; }
.bcoverline { font-size: 15px; line-height: 1.45; }
/* THE ORDERING RULE, and it is the load-bearing sentence of the whole view.
   Quieter than the numbers above it and never hidden behind a control: a
   selection is only honest when it comes with a stated cut. */
.bcoverrule { font-size: 12.5px; line-height: 1.55; color: var(--muted); }
.bhint { font-size: 12px; color: var(--muted); margin-top: 6px; }

/* --- the last card ------------------------------------------------------ */

.bend { justify-content: center; gap: 16px; }
.bendline { font-size: 15px; line-height: 1.5; color: var(--muted); max-width: 34em; }
#brief-to-feed { align-self: flex-start; min-height: 44px; }

/* --- nothing qualified -------------------------------------------------- */

#brief-empty { padding: 56px 22px; font-size: 15px; line-height: 1.5; color: var(--muted); }
#brief-empty[hidden] { display: none; }

/* --- above a phone ------------------------------------------------------ */

/* ONE CODEPATH, ONE SET OF BUGS. The same deck, centred in a reading column,
   with cards a little shorter than the viewport so the next one shows its top
   edge and the scroll affordance is visible on a device with no thumb. */
@media (min-width: 431px) {
  #brief-deck { max-width: 480px; margin: 0 auto; width: 100%; }
  #brief-rail { max-width: 480px; margin: 0 auto; width: 100%; }
  .bcard { min-height: 78%; }
}

@media (prefers-reduced-motion: reduce) {
  #brief-deck { scroll-behavior: auto; }
  [data-ui="brief-rail-seg"] { transition: none; }
}
`;
