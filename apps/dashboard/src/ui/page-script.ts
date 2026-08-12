/**
 * The dashboard's client script, inlined into the page.
 *
 * Three rules hold this file together, and all three are about the same thing:
 * this page renders EXCHANGE-SUPPLIED TEXT that reached it through an
 * unauthenticated database.
 *
 *   1. Nothing is built with `innerHTML`. Every value goes into the document
 *      through `textContent` or `createElement`, so a company name containing
 *      markup is a company name containing markup, not markup.
 *   2. A link is only ever created after `safeHref` has parsed the URL and
 *      confirmed its scheme. `attachmentUrl` comes from NSE; a `javascript:`
 *      value in that field would otherwise become a click-to-execute link.
 *   3. No timestamp is formatted here. The server sends IST text because the
 *      server is the process that owns the one IST definition; a browser on
 *      UTC formatting these itself would be wrong by five and a half hours and
 *      look completely normal doing it.
 *
 * Written as ES5-flavoured concatenation rather than template literals so the
 * whole thing can live inside a TypeScript template string without every `${`
 * needing an escape — the escaping being exactly where this kind of file
 * historically breaks.
 *
 * NO URL APPEARS IN THIS FILE. Every request is same-origin and path-relative.
 */
import { SCRIPT_ACCOUNT } from './script/script-account';
import { SCRIPT_ADMIN } from './script/script-admin';
import { SCRIPT_BASE } from './script/script-base';
import { SCRIPT_BRIEF } from './script/script-brief';
import { SCRIPT_CELLS } from './script/script-cells';
import { SCRIPT_COMPANY } from './script/script-company';
import { SCRIPT_FEED } from './script/script-feed';
import { SCRIPT_FOCUS } from './script/script-focus';
import { SCRIPT_POLL } from './script/script-poll';
import { SCRIPT_SHARE } from './script/script-share';
import { SCRIPT_SUGGEST } from './script/script-suggest';
import { SCRIPT_VIEWS } from './script/script-views';

/**
 * ================================================================
 * WHY THE SCRIPT IS TEN FILES AND ONE FUNCTION
 * ================================================================
 *
 * It was 2,660 lines in a single template literal, 1,660 of them code, against
 * a 800-line ceiling — and the length was not the expensive part. A stray
 * backtick or `${` anywhere inside a string that large is consumed by the
 * TypeScript compiler before a browser ever sees it, and what ships is a page
 * that serves 200, contains every element a test looks for, and throws on load.
 * That exact failure shipped more than once. The bigger the string, the likelier
 * it is, and the harder it is to see which line did it.
 *
 * THE FRAGMENTS SHARE ONE SCOPE, so this is a change of filing and not of
 * structure. They are joined in their original order into one IIFE, and a name
 * declared in `script-base` is as visible to `script-views` as it was when the
 * two were adjacent lines of one file. Nothing was renamed, moved between
 * fragments, or rewritten.
 *
 * WHAT MAKES THAT CLAIM CHECKABLE: `page-script.spec.ts` holds the composed
 * output to the byte, and asserts no fragment carries a backtick of its own.
 */

/**
 * The one value the server writes INTO the script rather than sending as JSON.
 *
 * `ADMIN_ENABLED` decides whether the operator panel exists, and the fragments
 * read it at load time — before the first fetch returns — to decide what to
 * wire up. It cannot arrive from `api/summary` for the same reason the tab
 * cannot be hidden with CSS: by then the listeners are already bound to elements
 * that are not there.
 *
 * A BOOLEAN LITERAL, NOT INTERPOLATED TEXT. The only two strings this can ever
 * produce are `true` and `false`, so there is nothing here for a value to escape
 * from — which is the property every other value on this page gets by going
 * through `textContent` instead.
 */
const adminFlag = (enabled: boolean): string =>
  `  var ADMIN_ENABLED = ${enabled ? 'true' : 'false'};`;

/** The fragments, in the order they execute. */
const fragments = (admin: boolean): readonly string[] => [
  SCRIPT_BASE,
  SCRIPT_CELLS,
  // Before every fragment that draws a Copy button, which is what it is for:
  // one definition of what a filing looks like when somebody sends it to
  // somebody else.
  SCRIPT_SHARE,
  SCRIPT_FEED,
  // After `script-feed`, and that is a dependency rather than a preference:
  // every claim the dialog puts on screen goes through that fragment's
  // `writeInsight`, and `feedCard` calls this one's `openFocus`. The two are
  // adjacent so the pair reads as one surface.
  SCRIPT_FOCUS,
  // After `script-feed`, and that is a dependency rather than a preference:
  // every string the deck puts on screen goes through that fragment's
  // `writeClaim`, and no other way.
  SCRIPT_BRIEF,
  SCRIPT_COMPANY,
  // THE WHOLE PANEL, OR NONE OF IT. Off, this fragment is not in the document
  // at all — not hidden, not dead behind a flag. Its renderers are its only
  // callers outside `script-poll`, and those calls are guarded by
  // `ADMIN_ENABLED`, so the joined script defines nothing it does not use. See
  // `configuration.ts` for why the surface is removed rather than gated.
  ...(admin ? [SCRIPT_ADMIN] : []),
  SCRIPT_POLL,
  SCRIPT_SUGGEST,
  // Before `script-views`, which ends with the page's three bootstrap lines.
  // `api/me` has to be asked before the first refresh, or the first paint
  // draws a signed-in reader as signed out.
  SCRIPT_ACCOUNT,
  SCRIPT_VIEWS,
];

/**
 * One fragment's source.
 *
 * Each is quoted as a template literal opening and closing on its own line,
 * which adds a newline at each end that was never part of the script. Removing
 * exactly those two puts the joined body back to the single file it came from —
 * which is why the byte-for-byte test can exist at all.
 */
const body = (fragment: string): string =>
  fragment.replace(/^\n/, '').replace(/\n$/, '');

/**
 * THE SHELL IS CONCATENATION, NOT A TEMPLATE LITERAL, and that is the point of
 * the exercise rather than a stylistic preference. There is no longer any
 * outer string for a backtick to escape from; the only template literals left
 * are the fragments themselves, each small enough to read.
 */
export const pageScript = (admin: boolean): string =>
  "\n(function () {\n  'use strict';\n" +
  adminFlag(admin) +
  '\n' +
  fragments(admin).map(body).join('\n') +
  '\n})();\n';

/**
 * The script as a local host serves it, with the panel in.
 *
 * Kept as a constant because that is what nearly every spec is about, and
 * because the composed-output test has to hold ONE known string to the byte.
 */
export const PAGE_SCRIPT = pageScript(true);
