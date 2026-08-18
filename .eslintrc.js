module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: 'tsconfig.json',
    tsconfigRootDir: __dirname,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint/eslint-plugin'],
  extends: [
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended',
  ],
  root: true,
  env: {
    node: true,
    jest: true,
  },
  // `apps/web/` is linted by its OWN config (`apps/web/.eslintrc.cjs`, run by
  // `npm --prefix apps/web run lint:ci`), which extends this file and adds the
  // React rules. It is ignored here because the root `lint:ci` glob is
  // `{apps,libs,tools}/**/*.ts` and would otherwise hand the client's files to
  // a parser pointed at the root tsconfig — which excludes them, so every one
  // would fail as "not found by the project" before a single rule ran. The
  // rules are not relaxed; the ownership is moved.
  ignorePatterns: ['.eslintrc.js', 'apps/web/', 'apps/mobile/'],
  rules: {
    '@typescript-eslint/interface-name-prefix': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
    // typescript-eslint v8 defaults ignoreRestSiblings to false, which makes the
    // standard omit-a-key idiom (`const { field, ...rest } = record`) an error.
    // That idiom is used deliberately in tests to build records with a key
    // absent, so allow it. Severity stays at the recommended config's 'error'.
    '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }],
    // THE 800-LINE FILE CEILING, ENFORCED. CLAUDE.md has carried the rule
    // since the start, and three files drifted past it while it was only a
    // sentence in a doc — each now carries a visible in-file exemption
    // naming its reason, so the debt lives where the file does. Total lines,
    // comments included, because that is how the documented rule counts.
    'max-lines': [
      'error',
      { max: 800, skipBlankLines: false, skipComments: false },
    ],
  },
  overrides: [
    {
      // SPECS ARE EXEMPT, and it is practice rather than laxity: a suite
      // enumerating one behaviour's cases (page.spec.ts holds 2,494 lines of
      // served-document assertions) is cohesive at sizes a module is not,
      // and splitting it scatters a single behaviour's evidence across
      // files. The web project's own config caps ITS specs at 300 along
      // with everything else, which is the direction of travel.
      files: ['**/*.spec.ts'],
      rules: { 'max-lines': 'off' },
    },
  ],
};
