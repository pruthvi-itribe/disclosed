import {
  isPlausibleEmail,
  MAX_EMAIL_LENGTH,
  normaliseEmail,
} from './email-normalise';

/**
 * Email is the identity, so this module decides who two people are.
 *
 * The tests that matter here are the ones asserting what is NOT done: dot
 * stripping and `+tag` removal are provider-specific folk knowledge, they
 * differ between providers, and getting one wrong merges two people's accounts.
 */

describe('normaliseEmail', () => {
  it('lowercases, because the unique index is on the normalised form', () => {
    expect(normaliseEmail('Asha@Example.COM')).toBe('asha@example.com');
  });

  it('trims, because a pasted address carries whitespace', () => {
    expect(normaliseEmail('  asha@example.com \n')).toBe('asha@example.com');
  });

  it('keeps a plus tag, which belongs to the address', () => {
    // Stripping it merges asha+turret@ with asha@, who may be two mailboxes on
    // a provider that does not implement tagging the way Gmail does.
    expect(normaliseEmail('asha+turret@example.com')).toBe(
      'asha+turret@example.com',
    );
  });

  it('keeps dots in the local part, which are significant almost everywhere', () => {
    expect(normaliseEmail('a.sha@example.com')).toBe('a.sha@example.com');
  });

  it('is idempotent, so a stored value normalises to itself', () => {
    const once = normaliseEmail('  Asha@Example.com ');
    expect(normaliseEmail(once)).toBe(once);
  });
});

describe('isPlausibleEmail', () => {
  it.each([
    'asha@example.com',
    'a.sha+turret@mail.example.co.in',
    "o'brien@example.org",
    'a@b.co',
  ])('accepts %s', (address) => {
    expect(isPlausibleEmail(address)).toBe(true);
  });

  it.each<[string, string]>([
    ['an empty string', ''],
    ['no at sign', 'ashaexample.com'],
    ['two at signs', 'asha@@example.com'],
    ['no local part', '@example.com'],
    ['no domain', 'asha@'],
    ['a domain with no dot', 'asha@example'],
    ['a domain ending in a dot', 'asha@example.'],
    ['a domain starting with a dot', 'asha@.example.com'],
    ['an inner space', 'asha smith@example.com'],
    ['a newline, which is a header-injection shape', 'asha@example.com\nBcc:'],
    ['a tab', 'asha\t@example.com'],
  ])('refuses %s', (_label, address) => {
    expect(isPlausibleEmail(address)).toBe(false);
  });

  it('refuses an address longer than the bound', () => {
    // A conservative pattern plus a bound, not an RFC 5322 parser: the parser
    // is a well-known source of catastrophic backtracking and this value comes
    // from an unauthenticated POST body.
    const local = 'a'.repeat(MAX_EMAIL_LENGTH);
    expect(isPlausibleEmail(`${local}@example.com`)).toBe(false);
  });

  it('accepts an address exactly at the bound', () => {
    const domain = '@example.com';
    const local = 'a'.repeat(MAX_EMAIL_LENGTH - domain.length);
    expect(`${local}${domain}`).toHaveLength(MAX_EMAIL_LENGTH);
    expect(isPlausibleEmail(`${local}${domain}`)).toBe(true);
  });

  it('judges the NORMALISED form, so surrounding whitespace is not a refusal', () => {
    expect(isPlausibleEmail('  Asha@Example.com  ')).toBe(true);
  });

  it('returns false rather than throwing for a value that is not a string', () => {
    // It is fed from a JSON body. `{"email": {"$gt": ""}}` is the classic Mongo
    // auth bypass, and while the DTO refuses it first, this must not be the
    // layer that throws a 500 on it.
    expect(isPlausibleEmail(undefined as unknown as string)).toBe(false);
    expect(isPlausibleEmail({ $gt: '' } as unknown as string)).toBe(false);
  });
});
