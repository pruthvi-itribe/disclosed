import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';

/**
 * Every instant a response carries ships a server-formatted companion.
 *
 * IST IS SERVER-OWNED AND THE BROWSER FORMATS NO TIMESTAMP. That is a stated
 * invariant, and until now it held only because the files behind these views
 * happened to agree: `dashboard.types.ts` declares the pairs,
 * `filing-query.service.ts` fills the `*Ist` half through the one definition in
 * `libs/common/src/ist.ts`, and the page prints the string it is handed. A
 * convention across several files and no check anywhere. This makes those files
 * fail the build instead.
 *
 * WHAT IT COSTS TO LOSE: nothing visible, which is the whole argument. A field
 * that ships its raw instant and no companion forces whoever draws it to format
 * in the browser, and a browser that is not set to IST then renders every
 * filing at the wrong time while looking entirely normal doing it — no error,
 * no blank cell, no missing row, just a plausible wrong number. That is why the
 * lock arrives WITH the Bearer work on this branch rather than after it: a
 * Bearer token is what makes a phone in another timezone a client at all.
 *
 * READ AS TEXT, DELIBERATELY. The property is about field NAMES appearing in
 * pairs, which no TypeScript check expresses — `disseminatedAt: string` and
 * `disseminatedAtIst: string` are the same type, and the type system has no
 * opinion about whether the second one exists.
 *
 * ================================================================
 * WHICH FILES ARE CHECKED, AND WHY IT IS A WALK RATHER THAN A LIST
 * ================================================================
 *
 * EVERY `.ts` FILE UNDER `apps/dashboard/src` THAT IS NOT A SPEC. Derived by
 * walking the tree, so a file written tomorrow is covered tomorrow and nobody
 * has to remember to extend a list. That matters because the first version of
 * this lock read exactly one file — `dashboard.types.ts` — and the reasoning
 * behind that choice ("the response DTOs live there") was true of the DTOs
 * somebody had thought about and false of the rest: `WatchedCompany.addedAt`,
 * declared in `auth/watchlist.controller.ts`, shipped a raw instant with no
 * companion for as long as the lock existed and the lock reported no gaps the
 * whole time. A guard whose scope is a guess is a guard that agrees with the
 * guess.
 *
 * The walk is deliberately WIDER than "files that declare a response type".
 * Narrowing it would mean deciding, in this file, which types reach a client —
 * a question whose wrong answer is invisible, and the exact wrong answer that
 * cost us `addedAt`. The trade is one-sided: a missed response type is a wrong
 * time on somebody's phone, and an over-covered internal type is a spare field.
 *
 * Specs are excluded because a fixture is not a response — and because this
 * file spells holes in its own body, which the walk would otherwise read back
 * as real gaps.
 *
 * A `Date` IS NOT A WIRE INSTANT AND IS SKIPPED. `DirectorySnapshot.builtAt`
 * and `Signedin.lastSeenWatchlistAt` are domain values that never leave the
 * process in that form; the point at which an instant becomes something a
 * browser could misformat is the `.toISOString()` in a mapper, and what it
 * lands in is a `string` field this check does cover. Anything else — an epoch
 * `number`, an `unknown` — is NOT skipped, because a field named for an instant
 * and typed as neither a Date nor a string is a thing somebody should explain.
 *
 * THE `readonly` ANCHOR BOUNDS THE REACH. Every response type here is an
 * interface of `readonly` members, so that is what the pattern looks for; an
 * instant declared inside an inline type literal on a route signature is
 * outside it and carries its companion by hand.
 */
const SERVER_ROOT = join(__dirname, '..');

/**
 * A field naming an instant: `somethingAt`, its declared type, and not already
 * the companion.
 *
 * `attemptedAtIst` and its siblings are skipped because `At` is not what
 * precedes their colon, which is the intent: the companion does not need a
 * companion.
 *
 * The optional marker is admitted because AN OPTIONAL INSTANT FIELD IS STILL AN
 * INSTANT FIELD. None is optional today — `echo?` is `dashboard.types.ts`'s only
 * optional member — but the shape is already live in that file, and a pattern
 * that silently walked past `readonly firstSeenAt?:` would report an empty list
 * while checking nothing, which is the exact failure this suite exists to make
 * impossible.
 */
const INSTANT_FIELD = /^\s*readonly (\w+At)\??: (.*)$/;

/** A domain instant, not a wire one. See the header on why it is skipped. */
const DOMAIN_DATE = /\bDate\b/;

/** Every non-spec TypeScript file under a directory, recursively. */
const serverFiles = (dir: string): readonly string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return serverFiles(path);
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.spec.ts'))
      return [];
    return [path];
  });

const wireInstantsIn = (source: string): readonly string[] =>
  source
    .split('\n')
    .map((line) => INSTANT_FIELD.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .filter((match) => !DOMAIN_DATE.test(match[2]))
    .map((match) => match[1]);

/**
 * The companion must be the WHOLE identifier, not a prefix of one.
 *
 * `includes('readonly addedAtIst')` is satisfied by `readonly addedAtIstXX`,
 * so a typo in the companion's name would leave the field unpaired and this
 * lock green — found by renaming a real companion and watching the check pass.
 * The trailing class ends the identifier at whatever legally follows it: `:`,
 * `?`, or a space before either.
 */
const withoutCompanion = (source: string): readonly string[] =>
  wireInstantsIn(source).filter(
    (name) => !new RegExp(`readonly ${name}Ist\\s*[?:]`).test(source),
  );

/**
 * Every unpaired wire instant across the walked files, as `path: field`.
 *
 * Takes its reader so the failing test below can hand it a tree with a hole in
 * it — the whole walk exercised, not just the pattern.
 */
const gapsAcross = (
  files: readonly string[],
  read: (path: string) => string,
): readonly string[] =>
  files.flatMap((path) =>
    withoutCompanion(read(path)).map(
      (name) => `${relative(SERVER_ROOT, path)}: ${name}`,
    ),
  );

const onDisk = (path: string): string => readFileSync(path, 'utf8');

describe('the IST contract', () => {
  const files = serverFiles(SERVER_ROOT);

  /**
   * The walk reached the files that actually declare response bodies.
   *
   * NAMED EXPLICITLY, because everything below iterates the walk's own output
   * and would therefore stay green if the walk quietly returned a short list —
   * a directory renamed, a `readdirSync` that stopped recursing. These three
   * are where the types in the controllers' `ApiEnvelope<...>` signatures are
   * declared: `dashboard.types.ts` (the filings, summary, enrichment and
   * suggestion views), `watchlist.controller.ts` (`WatchedCompany`), and
   * `auth.controller.ts` (`MeView`).
   */
  it('walks past the one file this lock used to read', () => {
    const found = files.map((path) => relative(SERVER_ROOT, path));

    expect(found).toEqual(
      expect.arrayContaining([
        join('filings', 'dashboard.types.ts'),
        join('auth', 'watchlist.controller.ts'),
        join('auth', 'auth.controller.ts'),
      ]),
    );
  });

  it('gives every instant field an Ist companion', () => {
    expect(gapsAcross(files, onDisk)).toEqual([]);
  });

  /**
   * THE LOCK IS PROVEN TO FAIL, not merely observed to pass. A guard that
   * cannot fail is a guard that is green for the wrong reason, and this
   * repository has shipped that bug more than once — a suite whose pattern
   * matched nothing, passing on every commit and asserting nothing at all.
   *
   * The hole is spelled the way these files spell every one of their
   * declarations: one per line, indented, inside an interface body. A hole
   * written as a single line — `interface Hole { readonly publishedAt: string; }`
   * — does NOT trip the pattern, because `^\s*readonly` anchors to the start of
   * a line, and a fixture that fails to reproduce the regression proves the
   * opposite of what it sets out to prove.
   *
   * Both admitted shapes are holed, required and optional, because a branch of
   * the pattern that no test exercises is not a branch anybody has checked.
   *
   * DRILLED THROUGH EVERY WALKED FILE IN TURN, not one of them. That is what
   * makes the walk's membership mean something: a file the reader never opens
   * is a file whose hole nobody would see, and this says of each one that its
   * hole is seen.
   */
  it('fails when an instant field has no companion, in any walked file', () => {
    const HOLE = [
      'interface Hole {',
      '  readonly publishedAt: string;',
      '  readonly retiredAt?: string;',
      '}',
    ].join('\n');

    for (const holed of files) {
      const read = (path: string): string =>
        path === holed ? `${onDisk(path)}\n${HOLE}` : onDisk(path);
      const where = relative(SERVER_ROOT, holed);

      expect(gapsAcross(files, read)).toEqual([
        `${where}: publishedAt`,
        `${where}: retiredAt`,
      ]);
    }
  });

  /**
   * The `Date` skip is a skip, not a blind spot: the same field name typed as
   * a string is still caught. Without this, narrowing the pattern to wire
   * instants could be narrowed all the way to nothing and stay green.
   */
  it('skips a Date and still catches the same name as a string', () => {
    expect(withoutCompanion('  readonly builtAt: Date;')).toEqual([]);
    expect(withoutCompanion('  readonly builtAt: Date | null;')).toEqual([]);
    expect(withoutCompanion('  readonly builtAt: string;')).toEqual([
      'builtAt',
    ]);
  });
});

/**
 * The companion check itself, proven in both directions.
 *
 * A prefix match is the failure this guards: the first version accepted
 * `addedAtIstXX` as the companion for `addedAt`, which means a typo in the
 * companion's NAME would have left the field unpaired with the lock green.
 * Found by renaming a real companion and watching the check pass.
 */
describe('the companion must be the whole identifier', () => {
  const withField = (companion: string): string =>
    [
      'interface Row {',
      '  readonly addedAt: string;',
      `  ${companion}`,
      '}',
    ].join('\n');

  it.each(['readonly addedAtIst: string;', 'readonly addedAtIst?: string;'])(
    'accepts %s',
    (companion) => {
      expect(withoutCompanion(withField(companion))).toEqual([]);
    },
  );

  it.each([
    'readonly addedAtIstXX: string;',
    'readonly addedAtIstanbul: string;',
  ])('refuses %s, which only starts with the right name', (companion) => {
    expect(withoutCompanion(withField(companion))).toEqual(['addedAt']);
  });
});
