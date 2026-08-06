import { matchesOf } from './regex-matches';

describe('matchesOf', () => {
  it('returns every match with its offset', () => {
    expect(
      matchesOf('a1 b2 c3', /[a-z]\d/g).map((m) => [m[0], m.index]),
    ).toEqual([
      ['a1', 0],
      ['b2', 3],
      ['c3', 6],
    ]);
  });

  it('returns nothing when the pattern does not match', () => {
    expect(matchesOf('nothing here', /\d+/g)).toEqual([]);
  });

  // The bug this module exists to prevent: a module-level /g regex carries
  // `lastIndex` between calls, so the SECOND document scanned starts wherever
  // the first stopped and silently loses everything before that point.
  it('does not carry regex state between calls', () => {
    const shared = /x/g;
    expect(matchesOf('x x x', shared)).toHaveLength(3);
    expect(matchesOf('x x x', shared)).toHaveLength(3);
    expect(shared.lastIndex).toBe(0);
  });

  it('preserves capture groups', () => {
    const [match] = matchesOf('Rs 5 crore', /(\d+)\s+(crore)/g);
    expect([match[1], match[2]]).toEqual(['5', 'crore']);
  });

  // An empty match does not advance lastIndex on its own, so a pattern that can
  // match nothing loops forever without the nudge.
  it('terminates on a pattern that matches the empty string', () => {
    expect(matchesOf('ab', /c*/g).map((m) => m.index)).toEqual([0, 1, 2]);
  });
});
