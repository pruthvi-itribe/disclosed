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
  ignorePatterns: ['.eslintrc.js', 'apps/web/'],
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
  },
};
