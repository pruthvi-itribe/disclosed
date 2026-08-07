module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  // `e2e/` is Playwright's, and it uses the same `.spec.ts` suffix. Without
  // this Jest picks those files up, fails on the `@playwright/test` import, and
  // reports a broken suite for a suite that is not its own. Kept as an ignore
  // rather than by renaming the files, because `.spec.ts` is what both runners
  // and every editor integration expect.
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/e2e/'],
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  collectCoverageFrom: ['apps/**/*.(t|j)s', 'libs/**/*.(t|j)s'],
  coverageDirectory: './coverage',
  // The 80% bar from the project standards, enforced rather than aspirational.
  // Set just below what the suite currently measures, so it fails on a
  // REGRESSION rather than on the next line of code: a threshold pinned to the
  // exact current number turns every honest refactor into a red build, and one
  // pinned at 80 would let a third of the coverage rot away before it spoke.
  //
  // `main.ts` and `ingest.module.ts` stay IN the report at 0% rather than being
  // excluded to flatter the global figure: they are composition rather than
  // logic and are verified by running the process, but hiding them would also
  // hide `main.ts`'s shutdown re-entrancy latch, which is real behaviour that
  // no test covers. The global bar is set to accommodate them and still catch
  // a regression anywhere else.
  coverageThreshold: {
    global: { statements: 90, branches: 93, functions: 90, lines: 90 },
  },
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@app/common(|/.*)$': '<rootDir>/libs/common/src/$1',
    '^@app/filings(|/.*)$': '<rootDir>/libs/filings/src/$1',
    '^@app/notify(|/.*)$': '<rootDir>/libs/notify/src/$1',
  },
};
