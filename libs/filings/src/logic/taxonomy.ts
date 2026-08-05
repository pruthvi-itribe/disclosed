/**
 * Categories (NSE `desc` field) that carry no market signal and no content value.
 * Anything not listed here is treated as non-routine: the gate fails open at this
 * stage so an unrecognised category is reviewed rather than silently discarded.
 */
export const ROUTINE_CATEGORIES: ReadonlySet<string> = new Set([
  'updates',
  'general updates',
  'copy of newspaper publication',
  'trading window',
  'trading window-xbrl',
  'statement of deviation(s) or variation(s) under reg. 32',
]);

const normalise = (category: string): string => category.trim().toLowerCase();

export const isRoutine = (category: string): boolean =>
  ROUTINE_CATEGORIES.has(normalise(category));
