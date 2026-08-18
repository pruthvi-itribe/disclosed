import { describeKey } from './describe';

/**
 * A lookup that cannot be walked into the prototype chain. The keys come from
 * the server and are a closed set, but the old client's plain-object tables
 * had to guard 'constructor' by hand; a Map has no prototype to walk into.
 */
describe('describeKey', () => {
  const table = new Map([['verified', 'the long explanation']]);

  it('returns the value for a known key', () => {
    expect(describeKey(table, 'verified')).toBe('the long explanation');
  });

  it('falls back to the key itself', () => {
    expect(describeKey(table, 'unknown')).toBe('unknown');
  });

  it('does not resolve prototype names', () => {
    expect(describeKey(table, 'constructor')).toBe('constructor');
    expect(describeKey(table, 'toString')).toBe('toString');
  });
});
