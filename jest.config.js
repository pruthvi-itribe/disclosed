module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  collectCoverageFrom: ['apps/**/*.(t|j)s', 'libs/**/*.(t|j)s'],
  coverageDirectory: './coverage',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@app/filings(|/.*)$': '<rootDir>/libs/filings/src/$1',
    '^@app/notify(|/.*)$': '<rootDir>/libs/notify/src/$1',
  },
};
