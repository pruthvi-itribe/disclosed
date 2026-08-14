import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Every instant a response carries ships a server-formatted companion.
 *
 * IST IS SERVER-OWNED AND THE BROWSER FORMATS NO TIMESTAMP. That is a stated
 * invariant, and until now it held only because the files behind these views
 * happened to agree: `dashboard.types.ts` declares the pairs,
 * `filing-query.service.ts` fills the `*Ist` half through the one definition in
 * `libs/common/src/ist.ts`, and the page prints the string it is handed. A
 * convention across several files and no check anywhere. This makes the first
 * of those files fail the build instead.
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
 */
const TYPES_PATH = join(__dirname, 'dashboard.types.ts');

/**
 * A field naming an instant: `somethingAt`, and not already the companion.
 *
 * `attemptedAtIst` and its siblings are skipped because `At` is not what
 * precedes their colon, which is the intent: the companion does not need a
 * companion.
 *
 * The optional marker is admitted because AN OPTIONAL INSTANT FIELD IS STILL AN
 * INSTANT FIELD. None is optional today — `echo?` is the file's only optional
 * member — but the shape is already live in this file, and a pattern that
 * silently walked past `readonly firstSeenAt?:` would report an empty list
 * while checking nothing, which is the exact failure this suite exists to make
 * impossible.
 */
const INSTANT_FIELD = /^\s*readonly (\w+At)\??: /;

const fieldsIn = (source: string): readonly string[] =>
  source
    .split('\n')
    .map((line) => INSTANT_FIELD.exec(line)?.[1])
    .filter((name): name is string => name !== undefined);

const withoutCompanion = (source: string): readonly string[] =>
  fieldsIn(source).filter((name) => !source.includes(`readonly ${name}Ist`));

describe('the IST contract', () => {
  const source = readFileSync(TYPES_PATH, 'utf8');

  it('gives every instant field an Ist companion', () => {
    expect(withoutCompanion(source)).toEqual([]);
  });

  /**
   * THE LOCK IS PROVEN TO FAIL, not merely observed to pass. A guard that
   * cannot fail is a guard that is green for the wrong reason, and this
   * repository has shipped that bug more than once — a suite whose pattern
   * matched nothing, passing on every commit and asserting nothing at all.
   *
   * The hole is spelled the way this file spells every one of its declarations:
   * one per line, indented, inside an interface body. A hole written as a
   * single line — `interface Hole { readonly publishedAt: string; }` — does NOT
   * trip the pattern, because `^\s*readonly` anchors to the start of a line, and
   * a fixture that fails to reproduce the regression proves the opposite of what
   * it sets out to prove.
   *
   * Both admitted shapes are holed, required and optional, because a branch of
   * the pattern that no test exercises is not a branch anybody has checked.
   */
  it('fails when an instant field has no companion', () => {
    const withHole = [
      source,
      'interface Hole {',
      '  readonly publishedAt: string;',
      '  readonly retiredAt?: string;',
      '}',
    ].join('\n');

    expect(withoutCompanion(withHole)).toEqual(['publishedAt', 'retiredAt']);
  });
});
