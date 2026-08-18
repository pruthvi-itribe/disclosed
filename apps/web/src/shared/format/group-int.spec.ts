import { groupInt } from './group-int';

describe('groupInt', () => {
  // Plain thousands grouping, not lakh/crore — ported as-is from the old
  // client, which made the same choice.
  it('groups thousands', () => {
    expect(groupInt(0)).toBe('0');
    expect(groupInt(999)).toBe('999');
    expect(groupInt(1000)).toBe('1,000');
    expect(groupInt(9459)).toBe('9,459');
    expect(groupInt(1234567)).toBe('1,234,567');
  });

  it('returns an em dash for nothing', () => {
    expect(groupInt(null)).toBe('—');
    expect(groupInt(undefined)).toBe('—');
  });
});
