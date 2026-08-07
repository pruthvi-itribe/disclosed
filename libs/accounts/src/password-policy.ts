/**
 * What this accepts as a password, and — more importantly — what it refuses to
 * demand.
 *
 * NO COMPOSITION RULES AND NO FORCED ROTATION. NIST SP 800-63B is explicit that
 * both make passwords worse: "one capital, one digit, one symbol" produces
 * `Password1!` across a whole organisation, and 90-day rotation produces
 * `Password2!`. The two rules that are here are a length floor, which is the
 * only requirement that reliably buys entropy, and a deny-list, which catches
 * the guesses an attacker tries first.
 */

/**
 * The floor. Twelve, because argon2id makes offline cracking expensive per
 * guess and length is what makes the guess space large; a shorter floor is
 * carried by the hash parameters alone, which is one control instead of two.
 */
export const MIN_PASSWORD_LENGTH = 12;

/**
 * The ceiling, and it is about BOUNDING WORK rather than about policy.
 *
 * Every submitted password costs one argon2id hash at 19 MiB whether it is
 * right or wrong, so an unbounded field is an unbounded input to the most
 * expensive operation this application performs. argon2 has no bcrypt-style
 * 72-byte truncation problem, so the number can be generous rather than
 * security-critical.
 */
export const MAX_PASSWORD_LENGTH = 128;

/**
 * The guesses an attacker makes first, that a 12-character floor does NOT
 * already refuse.
 *
 * WHY IT IS NOT A THOUSAND ENTRIES. The famous list — `123456`, `password`,
 * `qwerty`, `letmein` — is famous precisely because those strings are short,
 * and every one of them is already refused by `MIN_PASSWORD_LENGTH` before this
 * set is consulted. An entry the length gate eats first is a line that can
 * never fire, and a deny-list padded with them would report a size that
 * overstates what it does. A spec asserts every entry here clears the floor.
 *
 * What survives a 12-character floor is a different population: keyboard walks
 * (`1qaz2wsx3edc`), doubled words (`passwordpassword`), word-plus-run
 * (`password123456`), and long single words people reach for. That is what this
 * holds.
 *
 * THE REAL ANSWER IS A CORPUS, NOT A LITERAL. A k-anonymity lookup against Have
 * I Been Pwned covers ~10^9 leaked passwords and is follow-on F6 — deliberately
 * not on the login path on day one, because it puts an outbound third-party
 * request inside authentication. Until it lands this is a floor, not a
 * substitute, and it is written to be honest about that.
 *
 * A `Set`, not an object literal: `constructor` is a key on every literal's
 * prototype chain, and an unguarded lookup would reject a password nobody has
 * ever leaked while accepting one that has.
 */
export const COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  // Keyboard walks long enough to clear the floor.
  '1qaz2wsx3edc',
  '1qaz2wsx3edc4rfv',
  'qazwsxedcrfv',
  '1q2w3e4r5t6y',
  '1q2w3e4r5t6y7u8i',
  'q1w2e3r4t5y6',
  'zaq12wsxcde3',
  '123qweasdzxc',
  'qweasdzxc123',
  'qwertyuiop123',
  'qwertyuiop1234',
  'qwertyuiop12345',
  'qwertyuiopasdfghjkl',
  'qwertyuiopasdfghjklzxcvbnm',
  'asdfghjklzxcvbnm',
  'asdfghjkl1234',
  'asdfghjkl123456',
  'zxcvbnmasdfgh',
  'qwerty12345678',
  'qwerty123456789',
  '1234567890qwertyuiop',
  // Runs and repeats.
  '123456789012',
  '1234567890123',
  '12345678901234',
  '123456789101112',
  '111111111111',
  '000000000000',
  'aaaaaaaaaaaa',
  'abcdefghijkl',
  'abcdefghijklm',
  'abcdefghijklmnop',
  '123123123123',
  '121212121212',
  '123456123456',
  'abc123abc123',
  'qwe123qwe123',
  'asd123asd123',
  // The word, extended past the floor.
  'password1234',
  'password12345',
  'password123456',
  'passwordpassword',
  'password1password1',
  'passw0rd1234',
  'p@ssw0rd1234',
  'mypassword123',
  'secretpassword',
  'temppassword',
  'newpassword1',
  'newpassword123',
  'changeme1234',
  'changemenow1',
  'defaultpass1',
  'letmein123456',
  'letmeinplease',
  'welcome123456',
  'welcome1welcome1',
  'welcome@1234',
  'adminadmin123',
  'administrator',
  'administrator1',
  'administrator123',
  'guestguest12',
  'supervisor12',
  'manager12345',
  'employee1234',
  'trustno1trustno1',
  // Long single words and phrases people reach for.
  'iloveyou1234',
  'iloveyousomuch',
  'iloveyouforever',
  'iloveyoubaby',
  'princess1234',
  'sunshine1234',
  'superman1234',
  'batman123456',
  'football1234',
  'basketball12',
  'liverpoolfc1',
  'manchesterunited',
  'harleydavidson',
  'michaeljordan',
  'harrypotter1',
  'starwars1234',
  'pokemon12345',
  'minecraft123',
  'fortnite1234',
  'monkeymonkey',
  'chocolate123',
  'butterfly123',
  'strawberry12',
  'whatever1234',
  'computer1234',
  'internet1234',
  'instagram123',
  'facebook1234',
  'google123456',
  'youtube12345',
  'samsung12345',
  'iphone123456',
  'androidphone',
  'developer123',
  'engineer1234',
  'marketing123',
  'corporate123',
  'business1234',
  'company12345',
  'student12345',
  'teacher12345',
  'december2024',
  'november2024',
  'september123',
  'october12345',
  'august123456',
  'january12345',
  'summer123456',
  'winter123456',
  'spring123456',
  'autumn123456',
]);

/** Why a password was refused. Each names a different fix. */
export type PasswordRefusal =
  'not-a-string' | 'too-short' | 'too-long' | 'common';

/**
 * The verdict.
 *
 * DELIBERATELY SPECIFIC, unlike every other message on the auth path. The
 * no-enumeration rule governs answers about whether an ACCOUNT exists; this is
 * an answer about the secret the caller just typed, which they already know.
 * Being vague here costs a person an attempt they cannot diagnose and protects
 * nothing.
 */
export type PasswordVerdict =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: PasswordRefusal;
      readonly message: string;
    };

const refuse = (reason: PasswordRefusal, message: string): PasswordVerdict => ({
  ok: false,
  reason,
  message,
});

/**
 * Checks a password against the floor, the ceiling and the deny-list.
 *
 * Length is counted in CODE POINTS via the spread, not in UTF-16 units and not
 * in bytes: a passphrase in an Indic script is as long as it looks to the
 * person who typed it.
 */
export const checkPassword = (password: string): PasswordVerdict => {
  if (typeof password !== 'string') {
    return refuse('not-a-string', 'Password must be text.');
  }

  const length = [...password].length;

  if (length < MIN_PASSWORD_LENGTH) {
    return refuse(
      'too-short',
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters. Length is ` +
        'the only requirement here — there are no rules about capitals, digits ' +
        'or symbols, because those make passwords worse rather than better.',
    );
  }

  if (length > MAX_PASSWORD_LENGTH) {
    return refuse(
      'too-long',
      `Password must be at most ${MAX_PASSWORD_LENGTH} characters.`,
    );
  }

  if (COMMON_PASSWORDS.has(password.trim().toLowerCase())) {
    return refuse(
      'common',
      'That password appears on public lists of the passwords attackers try ' +
        'first. Pick another.',
    );
  }

  return { ok: true };
};
