/**
 * The focus card's rules.
 *
 * ITS OWN FILE because `page-style.ts` is 954 lines against this project's
 * 800-line ceiling, and the Brief's stylesheet already files separately for the
 * same reason. Concatenated into the one `<style>` element by `page.ts`.
 *
 * Same rules as its siblings: no url(), no font, no import.
 */
export const PAGE_STYLE_FOCUS = `
/* THE CARD ANNOUNCES THAT IT OPENS. Cursor and a hairline lift on hover, which
   is the whole affordance — a permanent "expand" control on every card would be
   chrome on the densest surface in the product. */
.card.openable { cursor: pointer; }
.card.openable:hover { border-color: #3a4553; transform: translateY(-1px); }
.card.openable:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

/* The backdrop. FIXED, not absolute: the feed scrolls and an absolutely
   positioned overlay would scroll away from the reader it is modal to. */
.focusback {
  position: fixed; inset: 0; z-index: 60;
  display: flex; align-items: center; justify-content: center;
  padding: 24px 16px;
  background: rgba(4, 7, 12, .72);
  /* Blurred rather than merely darkened, so the feed behind reads as OUT OF
     REACH rather than as dim. -webkit- first for Safari, which still needs it. */
  -webkit-backdrop-filter: blur(7px);
  backdrop-filter: blur(7px);
  opacity: 0;
  transition: opacity .16s ease;
  overflow-y: auto;
}
.focusback[hidden] { display: none; }
.focusback.open { opacity: 1; }

.focuscard {
  background: var(--panel); border: 1px solid var(--line);
  border-radius: 18px; padding: 20px 22px 18px;
  width: 100%; max-width: 720px;
  max-height: calc(100vh - 48px);
  display: flex; flex-direction: column;
  /* MEASURED, NOT DECORATIVE. A flex item's default minimum is its CONTENT
     width, so the monospaced results line inside — set 'nowrap' — made the
     panel as wide as the longest filing and scrolled the whole page sideways
     on a phone. 'e2e/focus.spec.ts' caught it at 390px. This is what lets the
     results line's own 'overflow-x' do the scrolling instead of the document. */
  min-width: 0;
  /* The card it came from is 400px of text in a grid; this is the same object
     at reading size, so it gets a shadow the flat feed never uses. */
  box-shadow: 0 24px 64px rgba(0, 0, 0, .55);
  transform: scale(.96);
  opacity: 0;
  transition: transform .16s cubic-bezier(.2, .8, .3, 1), opacity .16s ease;
}
.focusback.open .focuscard { transform: scale(1); opacity: 1; }

.focushead {
  display: flex; align-items: baseline; gap: 10px;
  padding-bottom: 13px; border-bottom: 1px solid var(--line); margin-bottom: 4px;
}
.focushead .who { min-width: 0; flex: 1 1 auto; }
.focushead .sym { font-size: 20px; }
.focushead .when { margin-left: 0; }
.focusclose {
  flex: 0 0 auto; align-self: flex-start;
  background: transparent; border: 1px solid var(--line); border-radius: 9px;
  color: var(--muted); font: inherit; font-size: 20px; line-height: 1;
  /* 34px square. A dialog is opened as often on a phone as on a laptop and a
     16px glyph is not a thumb target. */
  width: 34px; height: 34px; cursor: pointer; padding: 0;
}
.focusclose:hover { color: var(--text); border-color: var(--muted); }
.focusclose:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

/* The scrolling half. Only this scrolls, so the identity above and the controls
   below stay put through a filing with eleven claims. */
.focusbody { overflow-y: auto; padding: 14px 2px 4px; min-width: 0; }

/* Full size, and no cap on how many. That is the entire point of the dialog:
   the card stops at two because a grid row is as tall as its tallest card, and
   nothing here is in a grid. */
.focusbody .insights { gap: 16px; min-width: 0; }
/* A claim carrying a token with no break opportunity — a scrip code, a URL, a
   run of digits — would otherwise widen the panel rather than wrap. */
.focusbody .insights li {
  font-size: 16px; min-width: 0; overflow-wrap: anywhere;
}

/* THE SPAN, UNDER ITS CLAIM. Muted, because it is evidence rather than the
   line — a reader takes the claim and checks the quote, not the other way
   round. Quoted with real quotation marks and never merged with a neighbouring
   sentence: two quotes from two places in a document run together is a forged
   sentence, which is the rule 'script-cells.ts' states for the detail row. */
.focusspan {
  margin: 7px 0 0; padding: 8px 12px;
  border-left: 2px solid rgba(88, 166, 255, .32);
  background: rgba(88, 166, 255, .05);
  border-radius: 0 8px 8px 0;
  color: var(--muted); font-size: 13px; line-height: 1.55;
  overflow-wrap: anywhere;
}
.focusspanlabel {
  display: block; font-size: 10px; text-transform: uppercase;
  letter-spacing: .1em; opacity: .8; margin-bottom: 3px;
}

/* A claim the document printed no span for cannot happen on a verified filing,
   so this is the honest empty rather than a blank gap. */
.focusnospan { color: var(--muted); font-size: 12.5px; font-style: italic; margin-top: 6px; }

.focusresults {
  font-family: var(--mono); font-size: 13px; line-height: 1.5;
  background: var(--panel-2); border: 1px solid var(--line);
  border-radius: 8px; padding: 9px 12px; margin-bottom: 16px;
  overflow-x: auto; white-space: nowrap;
}

/* The exchange's own sentence, when nothing was verified. Not a claim and never
   dressed as one. */
.focusstated { color: var(--muted); font-size: 14px; line-height: 1.5; margin: 0; }

.focusfoot {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding-top: 13px; margin-top: 4px; border-top: 1px solid var(--line);
  font-size: 11px;
}
.focusfoot .cardcat { flex: 1 1 auto; }

@media (max-width: 560px) {
  .focusback { padding: 0; align-items: flex-end; }
  /* Full-bleed sheet on a phone, anchored to the bottom where a thumb is. */
  .focuscard {
    max-width: none; border-radius: 18px 18px 0 0;
    max-height: 92vh; padding: 18px 16px 14px;
  }
  .focusback.open .focuscard { transform: scale(1); }
  .focuscard { transform: translateY(14px) scale(1); }
}

/* HONOURED, NOT APPROXIMATED. Somebody who has asked their system for less
   motion gets none: no scale, no slide, no fade-in on the panel. The dialog
   still appears and still closes; it simply arrives rather than animating.
   Written as a separate block rather than by zeroing a duration, so the
   transform never runs at all. */
@media (prefers-reduced-motion: reduce) {
  .focusback, .focuscard { transition: none; }
  .focuscard, .focusback.open .focuscard { transform: none; }
  .card.openable:hover { transform: none; }
}
`;
