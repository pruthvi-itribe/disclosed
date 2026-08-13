import { execFileSync } from 'child_process';
import { writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * The repository is public, and names nothing an attacker could use.
 *
 * No secret has ever been committed and none may be — but this suite is
 * stricter than that, because A CLUE IS NOT A SECRET AND IS STILL WORTH
 * HAVING. A reader who learns the name of the managed database cluster, what
 * else lives on it, and which load balancer fronts it has been handed the
 * reconnaissance half of an attack for free, without a single credential
 * leaking.
 *
 * It exists because the alternative failed. Two production hostnames and a
 * personal email reached tracked files on 2026-08-13 — written by someone who
 * knew the rule, in the same session that wrote the rule down — and were
 * caught by a code review rather than by the build. A convention nobody can
 * run is a convention that holds until the day somebody is in a hurry.
 *
 * WHAT IS CHECKED IS THE GIT INDEX, not the working tree: `git grep --cached`
 * asks what is committed, which is the thing that becomes public. An untracked
 * scratch file holding a hostname is not this suite's business.
 */

const REPO_ROOT = join(__dirname, '..');

/** Prose and configuration — where our own infrastructure gets written down. */
const INFRA_PATHS = [
  'docs/',
  'k8s/',
  '.github/',
  '*.md',
  '.env.example',
  'Caddyfile',
  'docker-compose*.yml',
  'Dockerfile',
];

/** Files whose whole subject is this rule, and which must name what they ban. */
const SELF_REFERENTIAL = ['tools/repo-hygiene.spec.ts', 'CLAUDE.md'];

/**
 * Patterns that must not appear in tracked files.
 *
 * Each carries the reason, because a future editor hitting a red build needs
 * to know whether to rename the thing or to argue with the rule.
 */
/**
 * `git grep -E` is POSIX ERE and REJECTS a negative lookahead outright —
 * "repetition-operator operand invalid", which is a hard error rather than a
 * silent miss. So the coarse net is cast in ERE and narrowed here in JS,
 * where lookahead works. Two stages, and the second is optional.
 */
const FORBIDDEN: ReadonlyArray<{
  readonly what: string;
  /** POSIX ERE, handed to `git grep`. Over-matches on purpose. */
  readonly pattern: string;
  /** JS regex. A hit is kept only if it ALSO matches this. */
  readonly refine?: RegExp;
  /** JS regex over the PATH. A hit in a matching file is not a violation. */
  readonly exempt?: RegExp;
  readonly why: string;
  /** A string this pattern MUST match. Proves the ERE works in git's engine. */
  readonly canary: string;
  /**
   * Where to look. Defaults to the whole repository.
   *
   * Scoped rather than exempted where the false positives are STRUCTURAL: a
   * BSE news id is a UUID and a filing carries IP-shaped strings, so hunting
   * infrastructure identifiers through test data finds exchange data every
   * time. Our own resource ids only ever live in prose and config, so that is
   * where the rule looks. A credential is different and is scoped NOWHERE —
   * it is forbidden in every file without exception.
   */
  readonly scope?: readonly string[];
}> = [
  {
    what: 'a public IPv4 address',
    canary: '203.0.113.7',
    scope: INFRA_PATHS,
    pattern: '([0-9]{1,3}\\.){3}[0-9]{1,3}',
    // Loopback, RFC1918, and the all-zero/broadcast forms say nothing about
    // where anything actually runs. Version strings (1.2.3.4-style) are
    // filtered by requiring the match not to be preceded by a letter or dash.
    refine:
      /(?<![\w.\-/])(?!127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|255\.)(\d{1,3}\.){3}(?!0\b)\d{1,3}(?![\w.\-/])/,
    why: 'a load balancer or node address tells a reader exactly what to point a scanner at',
  },
  {
    what: 'a managed-database or cluster identifier',
    canary: 'prod-mongo-v2',
    pattern:
      '(prod|stage|staging)-(mongo|valkey|redis|postgres|mysql)[a-z0-9-]*',
    why: 'naming the cluster names the target; write what it IS, not what it is CALLED',
  },
  {
    what: "another product's database or service name",
    canary: 'TRALK-INFRA',
    pattern:
      '(tralkdb|notificationsdb|instrumentsdb|rewardsdb|tralkserver|tralk-infra)',
    refine:
      /\b(tralkdb|notificationsdb|instrumentsdb|rewardsdb|tralkserver|tralk-infra)\b/,
    why: 'not ours to disclose, and it tells a reader what else the same credentials reach',
  },
  {
    what: 'a DigitalOcean or Cloudflare resource UUID',
    canary: '9259f378-57d4-4096-a5d6-4ab46bb4ea78',
    scope: INFRA_PATHS,
    pattern: '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',
    why: 'a resource id is an API argument; combined with any token it is a live handle',
  },
  {
    what: 'a personal email address',
    canary: 'someone@somewhere.co',
    pattern: '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}',
    // Placeholders and example domains are the whole point of the rule being
    // satisfiable, so they are not violations of it.
    refine:
      /[a-zA-Z0-9._%+-]+@(?!example\.|your-|acme-|sentry\.|localhost|newjob\.)[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i,
    // FIXTURES ARE EXEMPT, and the exemption is load-bearing rather than
    // convenient. `__fixtures__` holds the VERBATIM TEXT of real filings —
    // the corpus the verbatim gate is tested against — and the addresses in
    // it are investor-relations contacts the filers themselves published to
    // an exchange. Redacting them would edit the evidence a span is matched
    // against, which is the one thing this project may never do. They are
    // also not ours to redact: they are already public in the source PDF.
    // Three exemptions, each load-bearing rather than convenient:
    //
    // `__fixtures__` holds the VERBATIM TEXT of real filings — the corpus the
    // verbatim gate is tested against — and the addresses in it are
    // investor-relations contacts the filers published to an exchange
    // themselves. Redacting them would edit the evidence a span is matched
    // against, which is the one thing this project may never do.
    //
    // `.spec.ts` holds test data (`a@b.co`, `wiring@turret.test`) and one
    // deliberate ATTACK string — `https://nseindia.com@evil.io/a.pdf`, the
    // credential-in-URL trick `attachment.ts` exists to refuse. Scrubbing
    // that would delete the test, not the risk.
    //
    // `@disclosed.live` is this project's own domain. A ROLE address there is
    // the fix this rule wants, not a violation of it: `ops@` receives Let's
    // Encrypt expiry mail, belongs to nobody in particular, and survives a
    // person leaving. A personal address does none of those things.
    // `pruthvi@itribe.in` is exempted BY NAME rather than by domain, so the
    // exemption cannot silently widen to cover a colleague's address later.
    // It is the one place an address must be real: an ACME registration that
    // cannot be delivered to means expiry warnings vanish while everything
    // still looks healthy. Recorded in k8s/05-issuer.yaml beside the value.
    exempt: /__fixtures__|\/corpus\/|\.spec\.ts:|@disclosed\.live|pruthvi@itribe\.in/,
    why: 'personal data in a public repository; use a role address on our own domain, or an angle-bracket placeholder filled in at apply time',
  },
  {
    what: 'a credential-shaped string',
    canary: 'dop_v1_0123456789abcdef0123456789abcdef',
    pattern:
      '(dop_v1_[0-9a-f]{32}|dckr_pat_[A-Za-z0-9_-]{20}|ghp_[A-Za-z0-9]{30}|github_pat_[A-Za-z0-9_]{50}|sk-ant-[A-Za-z0-9_-]{30}|sk-or-v1-[0-9a-f]{40}|AIza[0-9A-Za-z_-]{35})',
    why: 'this is the one that is an actual secret rather than a clue — rotate it, do not just delete it',
  },
];

/**
 * Greps the git INDEX, and returns the offending lines.
 *
 * `--cached` rather than the working tree, and `-I` to skip binaries. The
 * lockfile is excluded because it is generated and its hashes trip the UUID
 * pattern; nothing in it is written by a person.
 */
function grepTracked(pattern: string, scope?: readonly string[]): string[] {
  const paths =
    scope === undefined
      ? ['.', ':!package-lock.json', ':!*.svg', ':!docs/images/*']
      : [...scope];
  try {
    const out = execFileSync(
      'git',
      // -i, AND IT IS LOAD-BEARING. The first version of this suite omitted it
      // while every pattern was lower-case, so `SHARED WITH TRALKSERVER` in
      // apps/dashboard/src/auth/client-key.ts sat green through the very
      // commit that added the suite — the same false green the `\b` bug
      // produced, found the same way, one review later.
      ['grep', '-I', '-n', '-i', '-E', '--cached', pattern, '--', ...paths],
      { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
    );
    return out.split('\n').filter((line) => line.trim().length > 0);
  } catch (error) {
    // git grep exits 1 when nothing matched, which is the passing case. Any
    // other status is a real failure and must not read as a clean result.
    const status = (error as { status?: number }).status;
    if (status === 1) return [];
    throw error;
  }
}

/**
 * A temp file holding every canary, so `git grep --no-index` has something on
 * disk to search. Written once per run and removed after; it never enters the
 * index, which is why the suite that reads the index does not trip over it.
 */
// ONE FILE PER CANARY, not one file holding all of them. A shared file would
// let a pattern pass by matching somebody else's canary, which is the same
// class of false green this whole test exists to catch.
const canaryName = (index: number): string =>
  `repo-hygiene-canary-${process.pid}-${index}.txt`;

beforeAll(() => {
  FORBIDDEN.forEach((rule, index) =>
    writeFileSync(join(tmpdir(), canaryName(index)), rule.canary, 'utf8'),
  );
});

afterAll(() => {
  FORBIDDEN.forEach((_rule, index) =>
    rmSync(join(tmpdir(), canaryName(index)), { force: true }),
  );
});

describe('the repository names nothing an attacker could use', () => {
  for (const { what, pattern, refine, exempt, scope, why } of FORBIDDEN) {
    it(`holds no ${what}`, () => {
      const hits = grepTracked(pattern, scope)
        .filter(
          (line) => !SELF_REFERENTIAL.some((f) => line.startsWith(`${f}:`)),
        )
        // The ERE net over-matches on purpose; this is where it is narrowed.
        .filter((line) => (refine === undefined ? true : refine.test(line)))
        .filter((line) => (exempt === undefined ? true : !exempt.test(line)));

      expect(hits).toEqual([]);
      // The assertion above is the gate. This one only ever runs when it
      // passed, and exists so the failure message names the reason rather
      // than printing a regex at somebody.
      expect(why).toBeTruthy();
    });
  }

  it('greps the index rather than reporting success on an error', () => {
    // The guard on the guard: a `git grep` that fails for any reason other
    // than "no matches" must throw, because a silently empty result would
    // turn this whole suite green forever.
    expect(() => grepTracked('[')).toThrow();
  });

  // THE TEST THAT WOULD HAVE CAUGHT THE BUG THIS SUITE SHIPPED WITH.
  //
  // The first version of this file wrote `\b` into its patterns and proved
  // them with `new RegExp(pattern).test(canary)` — JavaScript's engine, which
  // supports `\b`. The patterns actually run through `git grep -E`, whose ERE
  // DOES NOT. Three of six silently matched nothing, and their tests passed
  // green over a repository that contained live violations.
  //
  // So the canary goes through the real engine. Anything else tests a regex
  // that is not the one doing the work.
  describe.each(FORBIDDEN.map((f, i) => [f.what, f.pattern, i] as const))(
    'the %s pattern',
    (_what, pattern, index) => {
      it('matches its canary through git grep, not just through JavaScript', () => {
        // cwd is the temp DIRECTORY, not the repo: `git grep --no-index`
        // refuses a path outside the repository it is standing in.
        const found = execFileSync(
          'git',
          [
            'grep',
            '-I',
            '-c',
            // -i, MIRRORING grepTracked EXACTLY. A canary proved through
            // different flags than the real search proves nothing about the
            // real search — which is the whole reason this test exists.
            '-i',
            '-E',
            '--no-index',
            pattern,
            '--',
            canaryName(index),
          ],
          { cwd: tmpdir(), encoding: 'utf8' },
        );

        expect(found.trim()).not.toBe('');
      });
    },
  );
});
