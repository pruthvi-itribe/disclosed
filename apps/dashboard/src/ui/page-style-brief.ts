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
   with a different cost. That principle survives the story layout below
   unchanged — the axis moved, the autoplay did not arrive. This is also the
   least portable thing in the codebase — iOS Safari, Android Chrome and
   Firefox differ on dvh during URL-bar collapse and on overscroll inside a
   snap container — and the alternative, JS-driven paging, is worse and is what
   everyone regrets.

   ON A PHONE THE DECK PAGES SIDEWAYS, like the story format every reader of
   this view already has the gesture for. Above 900px it pages down the reading
   column, which is what a pointer and a wheel expect. ONE STYLESHEET DECIDES
   WHICH; the script reads the resolved scroll-snap-type off the deck and steps
   along whichever axis it names, so there is one stepper, one rail and one
   keyboard handler for both.
   ======================================================================== */

/* THE DECK OWNS THE VIEWPORT WHILE IT IS OPEN, and the class is set by
   showView() rather than inferred, so exactly one view is ever in this mode.

   dvh, NOT vh. iOS Safari's collapsing URL bar makes a card measured in vh
   taller than the visible viewport, which would put the footer of every card
   under the browser chrome — the one part of a card a reader has to be able to reach,
   because it holds the source document.

   ONE CONTAINER FOR EVERY TAB. This used to set max-width: none, so the deck
   spanned the whole window while every other view sat inside the body's
   centred 1680px box — and the topbar went with it, which put the brand mark
   at a different x in Brief than in Feed on any monitor wider than the cap.
   Keeping the body's own cap aligns the bar by construction rather than by a
   second rule about the bar: the deck is centred inside a centred box, which
   is the same place on screen it was before, and below 1680px the viewport is
   narrower than the cap so nothing anywhere changes. */
body.briefing {
  padding: 0;
  height: 100dvh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
/* THE SAME BAR IN BOTH MODES, to the pixel. The deck removes the body's
   padding, so the bar carries the identical metrics itself: 16px above,
   20px sides, 12px below, gap 16 — switching Feed to Brief must not move
   the brand or resize anything, or the tab feels like a page change. */
body.briefing .topbar { padding: 16px 20px 12px; margin: 0; gap: 16px; }
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
   two-segment progress bar is chrome rather than information.

   IT IS THE STORY RAIL ON A PHONE, at the top of the view above the deck,
   which is where the format that taught everyone this gesture puts it. It
   already had that shape; what it gains here is the room to be read as one —
   a segment thick enough to see at arm's length and a gap wide enough to
   count. It indexes the COMPANY cards, not the cover and the end: those two
   are the deck's covers rather than its content, and a rail that lit a segment
   for the cover would promise thirteen cards where there are eleven. */
#brief-rail {
  display: flex;
  gap: 4px;
  flex: 0 0 auto;
  padding: 8px 16px 10px;
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

/* A ROW OF FULL-WIDTH CARDS THAT SNAPS SIDEWAYS. A thumb swipes left and right
   for this format everywhere else it meets it, and the tap zones the script
   adds sit on the same axis: forward is right, back is left, in the gesture
   and in the tap.

   position: relative so a card's offsetLeft (offsetTop above 900px) is
   measured against the deck's own content box, which is what the step compares
   the scroll offset to.

   touch-action: pan-x TELLS THE COMPOSITOR WHICH GESTURE THIS IS before the
   first move event, so a vertical drag is not spent hunting for a scroller
   that will not move. THE COST IS THAT A CARD TALLER THAN THE DECK CANNOT BE
   DRAGGED UPWARDS, so a card has to fit, and that is measured rather than
   hoped for: at 390x844 over the live deck of fourteen cards on 2026-08-09 the
   content of a card needs between 195px and 523px against 734px of deck, so
   the tallest card of the day clears by 211px. The card keeps overflow-y: auto
   below as a valve for a keyboard, a trackpad and a screen reader; if the
   measurement ever closes, this line becomes pan-x pan-y and the swipe gets
   less certain rather than a card getting unreadable.

   overscroll-behavior: contain on BOTH axes: a swipe past the last card must
   not become the browser's own navigation, and a flick down must not rubber-
   band the page behind the deck. */
#brief-deck {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: row;
  overflow-x: auto;
  overflow-y: hidden;
  scroll-snap-type: x mandatory;
  overscroll-behavior: contain;
  touch-action: pan-x;
  scroll-behavior: smooth;
  /* NO SCROLLBAR, BECAUSE THE RAIL IS THE PROGRESS INDICATOR. The deck draws
     its own segment-per-card rail above itself; a scrollbar under the cards is
     a second, uglier copy of the same information, and a horizontal one on a
     tablet-width window would sit across the bottom of every card. */
  scrollbar-width: none;
}
#brief-deck::-webkit-scrollbar { width: 0; height: 0; }
#brief-deck[hidden] { display: none; }

/* EVERY CARD IS EXACTLY ONE VIEWPORT, which is what lets the lede be set at
   25px without any card in the deck changing height: a 120-character claim —
   the hard cap claim-verify.ts enforces — wraps to four lines at 390px and
   occupies about 128px, and the card has room for that at its maximum.

   100% of the deck rather than of the window, because the tab bar is above the
   deck and a card measured against the window would hide its own footer behind
   it. The deck's own height comes from body.briefing's 100dvh.

   height RATHER THAN min-height now that the cards sit in a row: a card that
   grew taller than the deck would be clipped by the deck's overflow-y rather
   than extending it, so it scrolls inside itself instead. That is a valve, not
   a layout — see the measurement on the deck above.

   NO BORDER BETWEEN CARDS. The top border separated cards stacked in a column;
   with one card on screen at a time it is a line across the top of every
   screen belonging to nothing. */
.bcard {
  flex: 0 0 100%;
  width: 100%;
  height: 100%;
  overflow-y: auto;
  scroll-snap-align: start;
  display: flex;
  flex-direction: column;
  padding: 20px 22px calc(20px + env(safe-area-inset-bottom));
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
.bsym:hover { color: var(--text); text-decoration: underline; }
.bwhen {
  margin-left: auto;
  font-size: 12px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.bname { font-size: 13px; color: var(--muted); min-width: 0; }

/* THE CLAIM IS THE CARD. Set at the size of a headline because it is one.

   THE FIT NO LONGER FOLLOWS FROM THE NUMBER. This size was chosen when
   MAX_CLAIM_CHARS was 120 — short enough that a claim was guaranteed a whole
   screen without a truncation rule, which no other string in this product
   gets. That constant was raised to 200 on 2026-08-13, because 120 was a wire
   line's bound deleting claims the verbatim gate had already accepted, and 200
   is two thirds longer than anything this rule was ever measured against. The
   size below is unchanged and the guarantee behind it is gone: whether the
   longest stored claim still fits is now an open question to be answered by
   looking at the rendered page, not by arithmetic here.

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
/* The phone's sentence is the default; the desktop query below swaps them. */
.bhintwide { display: none; }

/* --- the last card ------------------------------------------------------ */

.bend { justify-content: center; gap: 16px; }
.bendline { font-size: 15px; line-height: 1.5; color: var(--muted); max-width: 34em; }
#brief-to-feed { align-self: flex-start; min-height: 44px; }

/* --- nothing qualified -------------------------------------------------- */

#brief-empty { padding: 56px 22px; font-size: 15px; line-height: 1.5; color: var(--muted); }
#brief-empty[hidden] { display: none; }

/* --- the pager ---------------------------------------------------------- */

/* NOT ON A PHONE. A thumb has a gesture for a deck; these are for the pointer
   that does not. Display, rather than the hidden attribute, so the phone needs
   no runtime undo. */
.bpager { display: none; }
.bpage {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  border: 1px solid var(--line);
  background: var(--panel);
  color: var(--muted);
  cursor: pointer;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.bpage:hover:not(:disabled) { color: var(--text); border-color: var(--muted); }
.bpage:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
/* AT THE END OF THE DECK THE CONTROL SAYS SO. A button that is still live and
   does nothing is the page pretending it moved; the deck has a first card and
   a last one, and that is the fact worth showing. */
.bpage:disabled { opacity: .35; cursor: default; }
/* The chevron, drawn from two borders on a rotated square. A character would
   need escaping in this template literal, and the two triangles this product
   owns already mean a direction the DOCUMENT printed. */
.bpage::before {
  content: "";
  width: 8px;
  height: 8px;
  border-left: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
}
.bprev::before { transform: rotate(135deg); margin-top: 4px; }
.bnext::before { transform: rotate(-45deg); margin-bottom: 4px; }

/* --- above a phone ------------------------------------------------------ */

/* ONE CODEPATH, ONE SET OF BUGS. The same deck, centred in a reading column,
   so a tablet held in two hands reads at a phone's measure rather than at a
   40-word line.

   THE 78% CARD IS GONE WITH THE VERTICAL AXIS. It existed so the next card
   showed its top edge and the scroll had a visible affordance; sideways, the
   card that is coming is off the side of the screen and the rail above says
   how many are left. */
@media (min-width: 431px) {
  #brief-deck { max-width: 480px; margin: 0 auto; width: 100%; }
  #brief-rail { max-width: 480px; margin: 0 auto; width: 100%; }
}

/* --- a desktop ---------------------------------------------------------- */

/* WHAT WAS WRONG ABOVE 900px, in one sentence: it was a phone screen blown up.
   A 480px column floated in the middle of a 1440px window; every card was a
   fixed 650px tall whatever it held, so a two-line claim sat above 300px of
   nothing; the rail was a hairline above the fold; and the only two things
   that moved the deck — the wheel and the arrow keys — announced themselves
   nowhere at all. Scroll-snap has no affordance, and a pointer has no swipe.

   FOUR CHANGES, AND THEY ARE THE SAME DECK. No second renderer, no second
   codepath in the script, nothing conditional in JS: the cards, the ordering,
   the cap and the keyboard are byte-identical to the phone's. Below 900px not
   one of these rules applies.

     1  a 660px reading column with real gutters, so a 25px lede breaks at
        about 70 characters instead of 44;
     2  the rail turns VERTICAL and stands beside the column, where it reads as
        a chapter marker and costs no vertical space at all;
     3  a card is its natural height with a floor, and is drawn as a card —
        border, radius, panel — so the deck reads as a stack rather than as one
        long document that happens to stop in places;
     4  the pager, which is the affordance scroll-snap does not have.
   -------------------------------------------------------------------------- */
@media (min-width: 900px) {
  /* A ROW: rail, then column. Centring the pair puts the reading column a
     rail's width right of true centre, which is where a margin marker
     belongs. */
  #view-brief {
    flex-direction: row;
    justify-content: center;
    align-items: stretch;
    gap: 26px;
    padding: 4px 24px 24px;
  }

  /* THE RAIL, TURNED. One segment per card down the left edge of the reading
     column: the same promise about time the horizontal bar made, in the
     dimension a desktop has to spare. */
  #brief-rail {
    flex-direction: column;
    width: 3px;
    max-width: none;
    margin: 0;
    padding: 0;
    flex: 0 0 auto;
    align-self: stretch;
  }
  [data-ui="brief-rail-seg"] { width: 3px; height: auto; flex: 1 1 0; }

  /* BACK TO A COLUMN, AND EVERY PART OF THE PHONE'S ROW IS UNDONE HERE. The
     axis is the one thing that differs between the two decks, so it is spelled
     out rather than left half-inherited: a display:flex left over from the
     phone would lay the cards out side by side inside a 660px column. */
  #brief-deck {
    display: block;
    max-width: 660px;
    flex: 1 1 660px;
    margin: 0;
    overflow-x: hidden;
    overflow-y: auto;
    scroll-snap-type: y mandatory;
    /* A pointer has no swipe, so nothing here is a gesture to declare. */
    touch-action: auto;
  }

  /* NATURAL HEIGHT WITH A FLOOR, not one viewport. 100% of the deck made every
     card the same height as the tallest thing a card could ever hold, and most
     hold two lines — so the topic and the footer, which are pushed to the
     bottom, sat under 300px of nothing. The floor keeps a card feeling like a
     card; the snap still lands on its top edge either way. */
  .bcard {
    /* Room for the lede, the topic and the foot without the void. */
    min-height: 340px;
    /* The phone's card is a fixed-width, fixed-height panel in a row; here it
       is a block that takes the column's width and its content's height. */
    width: auto;
    height: auto;
    overflow-y: visible;
    padding: 30px 34px 26px;
    border: 1px solid var(--line);
    border-radius: 14px;
    background: var(--panel);
    margin-bottom: 18px;
    /* The snap lands here rather than on the card's border box, so a card
       arrives with air above it rather than jammed against the top edge. */
    scroll-margin-top: 4px;
  }
  /* The cover and the end card are statements, not filings: they centre, and
     they do not need a filing's floor. */
  .bcover, .bend { min-height: 300px; }
  .blede { font-size: 27px; margin-top: 22px; }
  .brest { font-size: 15.5px; }

  /* A pointer has no swipe and there are no tap zones up here: the pager and
     the wheel are what move this deck, so the cover says so. */
  .bhintnear { display: none; }
  .bhintwide { display: inline; }

  /* THE PAGER SITS BESIDE THE COLUMN, not against the window's edge. Pinned to
     the right margin it was 330px from the card it pages — a control that far
     from its object reads as belonging to the window rather than to the deck.
     A third item in the same flex row keeps it a hand's width away, and the
     row's centring absorbs it: the reading column moves 17px, which is the
     difference between the rail on one side and the buttons on the other. */
  .bpager {
    display: flex;
    flex-direction: column;
    gap: 10px;
    flex: 0 0 auto;
    align-self: center;
  }
}

/* The pager is a pointer's affordance and the window is where a pointer lives,
   but a very short window has no room beside the card for it. */
@media (min-width: 900px) and (max-height: 520px) {
  .bpager { display: none; }
}

@media (prefers-reduced-motion: reduce) {
  #brief-deck { scroll-behavior: auto; }
  [data-ui="brief-rail-seg"] { transition: none; }
}
`;
