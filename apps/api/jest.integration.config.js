/** @type {import('jest').Config} */
module.exports = {
  displayName: 'integration',
  moduleFileExtensions: ['js', 'json', 'ts'],

  // Root is the package dir (not src/) so we can reference migrations, etc.
  rootDir: '.',
  testMatch: ['<rootDir>/src/test/integration/**/*.integration.spec.ts'],

  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: '<rootDir>/tsconfig.json',
    }],
  },

  testEnvironment: 'node',

  // Container startup + migration can take up to 90s;
  // each test gets an additional window on top of that.
  testTimeout: 120_000,

  // Run suites serially — containers are shared within a file but we don't
  // want multiple files spinning up simultaneous containers.
  maxWorkers: 1,

  // Forward Testcontainers log output to Jest console (useful for debugging)
  verbose: true,

  setupFiles: ['<rootDir>/src/test-setup.ts'],

  moduleNameMapper: {
    '^@invoice/shared-types$': '<rootDir>/../../packages/shared-types/src',
  },
};
