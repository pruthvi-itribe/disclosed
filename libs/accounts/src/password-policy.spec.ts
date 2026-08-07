import {
  checkPassword,
  COMMON_PASSWORDS,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from './password-policy';

/**
 * The password rules, and the rules this deliberately does NOT have.
 *
 * NIST SP 800-63B is explicit that composition rules ("one capital, one digit,
 * one symbol") and forced rotation both make passwords worse, so neither is
 * here and both are asserted absent below — a future "hardening" pass has to
 * delete a test that says why before it can add one.
 */

const OK = 'correct horse battery staple';

describe('checkPassword — length', () => {
  it('accepts a long passphrase with no symbols in it at all', () => {
    expect(checkPassword(OK)).toEqual({ ok: true });
  });

  it(`refuses anything under ${MIN_PASSWORD_LENGTH} characters`, () => {
    const verdict = checkPassword('a'.repeat(MIN_PASSWORD_LENGTH - 1));

    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toBe('too-short');
    // The reason is SPECIFIC on purpose. This is about the secret the caller
    // just submitted, not about whether an account exists, so the
    // no-enumeration rule does not apply and vagueness here only costs the
    // person a second attempt they cannot diagnose.
    expect(verdict.message).toContain(String(MIN_PASSWORD_LENGTH));
  });

  it('accepts exactly the minimum', () => {
    // Not `abcdefghijkl`: the deny-list holds that one, which is the two gates
    // working as intended rather than a length failure.
    expect(checkPassword('rhubarbstool')).toEqual({ ok: true });
  });

  it(`refuses anything over ${MAX_PASSWORD_LENGTH} characters`, () => {
    // The maximum bounds WORK, not policy: every submitted password costs one
    // argon2id hash at 19 MiB, and there is no bcrypt-style truncation problem
    // to make a short maximum a security requirement.
    const verdict = checkPassword('a'.repeat(MAX_PASSWORD_LENGTH + 1));

    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toBe('too-long');
  });

  it('accepts exactly the maximum', () => {
    expect(checkPassword('a'.repeat(MAX_PASSWORD_LENGTH))).toEqual({
      ok: true,
    });
  });

  it('counts characters the way a person types them, not bytes', () => {
    // 12 emoji-free non-ASCII characters is a 12-character password. Counting
    // UTF-8 bytes would accept it and then a byte-bounded store would truncate.
    expect(checkPassword('ಅಆಇಈಉಊಋಎಏಐಒಓ')).toEqual({ ok: true });
  });
});

describe('checkPassword — the deny-list', () => {
  it('refuses a long password that is nonetheless one of the commonest', () => {
    const verdict = checkPassword('qwertyuiop123');

    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toBe('common');
  });

  it('matches the list case-insensitively', () => {
    // Breach lists are lowercase and `Qwertyuiop123` is the same guess.
    expect(checkPassword('Qwertyuiop123').ok).toBe(false);
  });

  it('matches past surrounding whitespace', () => {
    expect(checkPassword(' qwertyuiop123 ').ok).toBe(false);
  });

  it('leaves an ordinary passphrase alone', () => {
    expect(checkPassword('rhubarb tuesday lantern').ok).toBe(true);
  });

  it('holds only entries the length gate would not already have refused', () => {
    // THE POINT OF THE LIST, and the reason it is not a thousand entries. With
    // a 12-character minimum, every one of the famous short passwords —
    // `password`, `123456`, `qwerty` — is already refused by length, and an
    // entry the length gate eats first is a line that can never fire. So the
    // list carries the LONG ones only, and this test is what keeps it that way.
    for (const entry of COMMON_PASSWORDS) {
      expect([entry, entry.length >= MIN_PASSWORD_LENGTH]).toEqual([
        entry,
        true,
      ]);
    }
  });

  it('is stored lowercased, so the lookup cannot miss on case', () => {
    for (const entry of COMMON_PASSWORDS) {
      expect([entry, entry]).toEqual([entry, entry.toLowerCase()]);
    }
  });

  it('cannot be walked into the prototype chain', () => {
    // A Set rather than an object literal: `constructor` is a key on every
    // object literal's prototype, and an unguarded lookup would refuse it as a
    // common password while accepting a real one.
    expect(checkPassword('constructorconstructor').ok).toBe(true);
  });
});

describe('checkPassword — the rules that are deliberately absent', () => {
  it.each([
    ['no digit', 'rhubarb tuesday lantern'],
    ['no capital', 'rhubarb tuesday lantern 42'],
    ['no symbol', 'Rhubarb Tuesday Lantern 42'],
    ['nothing but lowercase letters', 'rhubarbtuesdaylantern'],
  ])('accepts a password with %s', (_label, password) => {
    expect(checkPassword(password)).toEqual({ ok: true });
  });

  it('refuses a value that is not a string rather than throwing', () => {
    const verdict = checkPassword(undefined as unknown as string);
    expect(verdict.ok).toBe(false);
  });
});
