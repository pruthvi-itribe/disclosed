import type { IconShape } from './icons';

/**
 * The shell's own drawings, in the exact grammar of icons.ts (24-unit box,
 * stroke inherited from the root) — but in their OWN file: icons.ts is a
 * verbatim mirror of the old client's fragment and its spec compares every
 * attribute, while these have no old-client counterpart to mirror. The
 * Watching tab reuses ICON_STAR from the shared set.
 *
 * IN shared/ui, not in the bottom bar's folder: the search mark and the
 * cross are wanted by two features now (the bar and the Watching screen's
 * add box), and a feature importing another feature's file is the coupling
 * every slot in this client exists to avoid.
 */

// A stack of cards seen edge-on: the deck.
export const ICON_NAV_BRIEF: readonly IconShape[] = [
  ['rect', 'x', '5', 'y', '4', 'width', '14', 'height', '10', 'rx', '2'],
  ['path', 'd', 'M5 17.5h14'],
  ['path', 'd', 'M7 21h10'],
];

// Rows with leading points: the feed.
export const ICON_NAV_FEED: readonly IconShape[] = [
  ['circle', 'cx', '5', 'cy', '6', 'r', '1'],
  ['path', 'd', 'M9 6h10'],
  ['circle', 'cx', '5', 'cy', '12', 'r', '1'],
  ['path', 'd', 'M9 12h10'],
  ['circle', 'cx', '5', 'cy', '18', 'r', '1'],
  ['path', 'd', 'M9 18h10'],
];

// The magnifier.
export const ICON_NAV_SEARCH: readonly IconShape[] = [
  ['circle', 'cx', '10.5', 'cy', '10.5', 'r', '6.5'],
  ['path', 'd', 'M15.5 15.5L21 21'],
];

// A head and shoulders.
export const ICON_NAV_PROFILE: readonly IconShape[] = [
  ['circle', 'cx', '12', 'cy', '8', 'r', '4'],
  ['path', 'd', 'M4.5 20.5a7.5 7.5 0 0 1 15 0'],
];

// The funnel: what the sheet actually is (direction 2026-08-18 — 'it's
// more like a filter icon, right? then it's a filter view').
export const ICON_NAV_FILTER: readonly IconShape[] = [
  ['path', 'd', 'M4 5h16l-6.2 7.2V18l-3.6 2.4v-8.2Z'],
];

// The cross, for the floating control while its sheet is open: the one
// thing on screen that both opens and closes the filters.
export const ICON_CLOSE: readonly IconShape[] = [
  ['path', 'd', 'M6.5 6.5l11 11'],
  ['path', 'd', 'M17.5 6.5l-11 11'],
];
