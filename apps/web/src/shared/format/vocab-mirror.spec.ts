import { readFileSync } from 'fs';
import { join } from 'path';
import { DIRECTION_MARK } from '../ui/DirectionMark';
import {
  DIRECTION_LABEL,
  TIER_TITLE,
  TOPIC_LABEL,
  METRIC_LABEL,
  FIGURE,
} from './vocab';

/**
 * The vocabulary is a PORT, so every entry is asserted against the server
 * fragment it was copied from, the way tokens.spec.ts asserts the palette.
 * A drift here is two vocabularies for one thing on one product — the exact
 * bug TOPIC_LABEL's own comment warns about ("acquisition" beside "Deals").
 *
 * The fragments are template literals whose regex backslashes are DOUBLED so
 * the compiler delivers single ones to the browser; the FIGURE comparison
 * collapses that doubling before comparing, because this module is a real one
 * and writes its regex once.
 */
const FRAGMENTS = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'dashboard',
  'src',
  'ui',
  'script',
);

const feedSource = readFileSync(join(FRAGMENTS, 'script-feed.ts'), 'utf8');
const baseSource = readFileSync(join(FRAGMENTS, 'script-base.ts'), 'utf8');
const companySource = readFileSync(
  join(FRAGMENTS, 'script-company.ts'),
  'utf8',
);

const entriesAppearIn = (
  table: ReadonlyMap<string, string>,
  source: string,
): void => {
  for (const [key, value] of table) {
    expect(source, `key ${key}`).toContain(key);
    expect(source, `value for ${key}`).toContain(value);
  }
};

describe('the vocabulary mirrors the server fragments', () => {
  // The GLYPHS are the server fragment's alone — this client draws the mark
  // (ui/DirectionMark.tsx). What must still match is which directions exist:
  // a fourth one added to the extractor and rendered by only one client is
  // the same two-vocabularies bug this file exists to catch.
  it('DIRECTION_MARK draws the three directions script-feed.ts knows', () => {
    for (const key of DIRECTION_MARK.keys()) expect(feedSource).toContain(key);
    expect([...DIRECTION_MARK.keys()]).toEqual([...DIRECTION_LABEL.keys()]);
    expect(DIRECTION_MARK.size).toBe(3);
    // Deliberately absent: three-quarters of claims are unrated and a missing
    // key draws nothing, which is the same statement.
    expect(DIRECTION_MARK.has('unrated')).toBe(false);
  });

  it('DIRECTION_LABEL matches script-feed.ts', () => {
    entriesAppearIn(DIRECTION_LABEL, feedSource);
    expect(DIRECTION_LABEL.size).toBe(3);
  });

  it('TIER_TITLE matches script-base.ts', () => {
    entriesAppearIn(TIER_TITLE, baseSource);
    expect([...TIER_TITLE.keys()]).toEqual(['verified', 'stated', 'labelled']);
  });

  it('TOPIC_LABEL matches script-company.ts', () => {
    entriesAppearIn(TOPIC_LABEL, companySource);
    expect(TOPIC_LABEL.size).toBe(9);
  });

  it('METRIC_LABEL matches script-company.ts', () => {
    entriesAppearIn(METRIC_LABEL, companySource);
    expect(METRIC_LABEL.size).toBe(6);
  });

  it('FIGURE matches script-feed.ts with the doubling collapsed', () => {
    const inFragment = feedSource.match(/var FIGURE = \/(.+)\/gi;/);
    expect(inFragment).not.toBeNull();
    expect(FIGURE.source).toBe((inFragment?.[1] ?? '').replace(/\\\\/g, '\\'));
    expect(FIGURE.flags).toBe('gi');
  });
});
