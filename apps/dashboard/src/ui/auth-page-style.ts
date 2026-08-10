/**
 * The sign-in page's own rules, on top of `LANDING_STYLE`.
 *
 * CONCATENATED WITH THE LANDING STYLESHEET rather than restating its tokens.
 * The palette, the two font stacks and the `.go` button are already defined
 * there, and a second copy is a second place for the accent colour to drift —
 * which on a sign-in page means the one screen where a visitor is deciding
 * whether to trust this thing looks subtly like a different site.
 *
 * Same rules as everywhere else here: no `url(...)`, no font, no import. The
 * gstatic relaxation this page carries is for the Firebase SDK and for nothing
 * else — a stylesheet or a typeface from a third party would be a second
 * exception, and the whole point of naming one is that there is one.
 */
export const AUTH_PAGE_STYLE = `
/* Vertically centred until the content outgrows the viewport, at which point it
   scrolls normally. A minimum height rather than a fixed one is what makes that
   true: fixed, the error line pushes the panel off the top of a short screen. */
.authshell {
  min-height: 100dvh;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  padding: 28px 20px 40px;
}
/* THE BRAND MOMENT ON THIS PAGE IS THE PANEL'S TOP EDGE. A 3px band of the
   tile's gradient, drawn as the panel's own background-image rather than as a
   border or an extra element: 'background-size: 100% 3px' with no repeat paints
   the band and lets --panel show through everywhere else, and the panel's
   18px radius clips its ends for free.

   ORDER MATTERS IN THESE FOUR DECLARATIONS. 'background' is a shorthand and
   resets background-image to none, so it has to come FIRST; the longhand then
   puts the gradient back over the colour it just set. Written the other way
   round the band silently disappears. */
.authpanel {
  width: 100%; max-width: 400px;
  background: var(--panel);
  background-image: var(--brand-gradient);
  background-repeat: no-repeat;
  background-size: 100% 3px;
  border: 1px solid var(--line);
  border-radius: 18px; padding: 26px 24px 22px;
}
.authback { margin-bottom: 22px; font-size: 13px; }
/* The one caller that resizes the logo, and it does it with one declaration:
   logo.ts sizes the mark in em, so the geometry is not restated here. */
.authpanel .logo { display: flex; margin-bottom: 10px; font-size: 24px; }
.authtitle { margin: 0; font-size: 21px; font-weight: 640; letter-spacing: -0.02em; }
.authlead { margin: 7px 0 20px; color: var(--muted); font-size: 14px; line-height: 1.5; }

/* Full-width and tall enough to be a comfortable thumb target on a phone,
   which is where a sign-in link is opened. */
.authbtn {
  display: flex; align-items: center; justify-content: center; gap: 10px;
  width: 100%; min-height: 46px;
  border-radius: 11px; font: inherit; font-size: 15px; font-weight: 600;
  cursor: pointer; text-decoration: none; padding: 11px 16px;
  border: 1px solid var(--line); background: var(--panel-2); color: var(--text);
}
.authbtn:hover:enabled { border-color: var(--muted); }
.authbtn:disabled { opacity: .5; cursor: default; }
.authbtn.primary { background: var(--brand-gradient); border-color: transparent; color: var(--brand-ink); }
.authbtn.primary:hover:enabled { filter: brightness(1.08); border-color: transparent; }
.authbtn:focus-visible { outline: 2px solid var(--text); outline-offset: 2px; }

/* Google's mark, drawn in CSS. NO REMOTE IMAGE and no emoji: the SDK may come
   from gstatic, a logo file may not, and the emoji range is rejected by the
   page tests. A bordered "G" in GOOGLE's own blue — #4285f4, theirs, not a
   token of ours — is unmistakable at this size and costs one element. */
.gmark {
  flex: 0 0 auto; width: 20px; height: 20px; border-radius: 50%;
  background: #fff; color: #4285f4;
  font-weight: 700; font-size: 13px; line-height: 20px; text-align: center;
}

.authsep {
  display: flex; align-items: center; gap: 12px;
  margin: 18px 0; color: var(--muted); font-size: 12px;
  text-transform: uppercase; letter-spacing: .1em;
}
.authsep::before, .authsep::after {
  content: ""; flex: 1 1 auto; height: 1px; background: var(--line);
}

.authfield { display: block; margin-bottom: 13px; }
.authfield span {
  display: block; margin-bottom: 5px;
  font-size: 12px; color: var(--muted); letter-spacing: .03em;
}
.authfield input {
  width: 100%; min-height: 44px;
  background: var(--bg); color: var(--text);
  border: 1px solid var(--line); border-radius: 10px;
  padding: 10px 12px; font: inherit; font-size: 16px;
}
.authfield input:focus { outline: 2px solid var(--accent); outline-offset: 1px; }

.authalt {
  background: transparent; border: 0; color: var(--accent);
  font: inherit; font-size: 13.5px; cursor: pointer; padding: 4px 0;
}
.authalt:hover { text-decoration: underline; }
.authrow { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 14px; }

/* Two message lines, and they are DIFFERENT ELEMENTS on purpose. A refusal and
   a "check your inbox" are opposite outcomes, and rendering both through one
   red box teaches a reader to read every message as a failure. */
.autherr, .authok {
  margin-top: 14px; padding: 10px 12px; border-radius: 10px;
  font-size: 13.5px; line-height: 1.5;
}
.autherr { border: 1px solid rgba(248, 81, 73, .5); background: rgba(248, 81, 73, .09); }
.authok { border: 1px solid rgba(63, 185, 80, .5); background: rgba(63, 185, 80, .09); }
.autherr[hidden], .authok[hidden] { display: none; }

.authnote { margin-top: 16px; color: var(--muted); font-size: 12.5px; line-height: 1.55; }

/* The unconfigured state. Warn-coloured rather than error-coloured: nothing is
   broken, something has not been done yet, and the difference is what the
   operator reading it needs to know. */
.authmissing {
  border: 1px solid rgba(210, 153, 34, .5); background: rgba(210, 153, 34, .08);
  border-radius: 12px; padding: 14px 16px; font-size: 13.5px; line-height: 1.55;
}
.authmissing ul { margin: 9px 0 0; padding-left: 20px; }
.authmissing code {
  font-family: var(--mono); font-size: 12.5px; color: var(--warn);
}
`;
