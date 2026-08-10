/**
 * The Firebase Web SDK, as this codebase references it.
 *
 * FOUR VALUES, TWO CALLERS. They lived in `auth-page.ts` while `/auth` was the
 * only page that loaded the SDK. The landing page's sign-in buttons now open the
 * same Google popup in place (see `ui/landing.ts`), so the pinned version, the
 * one origin and the script-safe JSON encoder are shared rather than copied — a
 * second copy of a pinned version is how one page ends up a version behind the
 * other on the two pages that face a signed-out visitor.
 *
 * The argument for the relaxation itself is still in `ui/auth-page.ts`'s header,
 * where it has always been, and it is unchanged: both pages render no filing,
 * call no read route and have no database access.
 */

/**
 * The pinned SDK version.
 *
 * PINNED, NEVER `latest`. A floating version means the code these pages execute
 * changes without a deploy, on the two pages that face a signed-out visitor —
 * which is the supply-chain shape the self-contained rule exists to avoid, and
 * the reason a version bump here is a commit rather than a Tuesday.
 */
export const FIREBASE_SDK_VERSION = '10.14.1';

/** The only external origin this application ever references. */
export const FIREBASE_SDK_ORIGIN = 'https://www.gstatic.com';

/** One SDK module's URL: `app` and `auth` are the only two either page imports. */
export const sdkModule = (name: string): string =>
  `${FIREBASE_SDK_ORIGIN}/firebasejs/${FIREBASE_SDK_VERSION}/firebase-${name}.js`;

/**
 * JSON safe to place between `<script>` tags.
 *
 * `</script>` inside a script element ends it, whatever the element's type and
 * whatever quoting the JSON uses — the HTML tokeniser does not parse JavaScript
 * or JSON, it looks for the closing sequence. So the three characters that can
 * start one are escaped as `\\uXXXX`, which `JSON.parse` reads back identically.
 *
 * These values come from environment variables set by an operator, not from a
 * caller, so this is a bug-catcher rather than a defence against an attacker.
 * It is here because "the input is trusted" is how every injection ships:
 * `FIREBASE_PROJECT_ID` is a string somebody types, and a page that breaks
 * confusingly on a typo is worse than one that does not.
 */
export const jsonForScript = (value: unknown): string =>
  JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
