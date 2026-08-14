/**
 * The web project's own rules, extending the repository's.
 *
 * `dangerouslySetInnerHTML` is an ERROR rather than a warning: exchange text
 * is untrusted and React's escaping is the whole defence. The rule is what
 * stops somebody reaching for it to render a claim with emphasis in it.
 *
 * `parserOptions` is re-stated rather than inherited. The root config points
 * typed linting at the ROOT tsconfig, which now excludes `apps/web` so that
 * the server's `tsc --noEmit` never compiles JSX; inheriting it would make
 * every file here "not found by the project". This config points at this
 * project's own tsconfig instead, so the two trees stay type-checked by the
 * compiler that owns them.
 */
module.exports = {
  root: true,
  extends: ['../../.eslintrc.js'],
  parserOptions: {
    project: './tsconfig.json',
    tsconfigRootDir: __dirname,
    sourceType: 'module',
  },
  // `browser` because this is the one part of the repository that runs in one;
  // the root config declares `node` and `jest`, neither of which is true here.
  env: { browser: true, node: false, jest: false },
  // `react` is present for `react/no-danger` alone. The rest of that plugin's
  // recommended set is not extended: it duplicates what the compiler already
  // proves under `strict`, and this project has no propTypes to validate.
  plugins: ['react', 'react-hooks', 'jsx-a11y'],
  rules: {
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'error',
    'react/no-danger': 'error',
    'jsx-a11y/anchor-is-valid': 'error',
  },
};
