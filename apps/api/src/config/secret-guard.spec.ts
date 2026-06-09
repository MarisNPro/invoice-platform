import {
  assertProductionSecrets,
  findProductionSecretProblems,
  DEV_IMPERSONATION_SECRET,
  INSECURE_ARCHIVE_KEY,
} from './secret-guard';

// A pair of values that are valid in production.
const GOOD_SECRET = 'x'.repeat(40); // non-default, >= 32 chars
const GOOD_KEY = 'a'.repeat(64); // 64 hex chars

const prodEnv = (overrides: Record<string, string | undefined> = {}) => ({
  NODE_ENV: 'production',
  IMPERSONATION_SECRET: GOOD_SECRET,
  ARCHIVE_ENCRYPTION_KEY: GOOD_KEY,
  ...overrides,
});

describe('secret-guard', () => {
  describe('assertProductionSecrets', () => {
    it('is a no-op outside production even with insecure defaults', () => {
      expect(() =>
        assertProductionSecrets({
          NODE_ENV: 'development',
          IMPERSONATION_SECRET: DEV_IMPERSONATION_SECRET,
          ARCHIVE_ENCRYPTION_KEY: INSECURE_ARCHIVE_KEY,
        }),
      ).not.toThrow();
    });

    it('passes in production when both secrets are strong', () => {
      expect(() => assertProductionSecrets(prodEnv())).not.toThrow();
    });

    it('throws in production on the dev impersonation default', () => {
      expect(() =>
        assertProductionSecrets(
          prodEnv({ IMPERSONATION_SECRET: DEV_IMPERSONATION_SECRET }),
        ),
      ).toThrow(/IMPERSONATION_SECRET/);
    });

    it('throws in production on the all-zeros archive key', () => {
      expect(() =>
        assertProductionSecrets(
          prodEnv({ ARCHIVE_ENCRYPTION_KEY: INSECURE_ARCHIVE_KEY }),
        ),
      ).toThrow(/ARCHIVE_ENCRYPTION_KEY/);
    });

    it('lists every problem when both secrets are unset in production', () => {
      let message = '';
      try {
        assertProductionSecrets({ NODE_ENV: 'production' });
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message).toMatch(/IMPERSONATION_SECRET/);
      expect(message).toMatch(/ARCHIVE_ENCRYPTION_KEY/);
    });
  });

  describe('findProductionSecretProblems', () => {
    it('returns no problems for strong secrets', () => {
      expect(findProductionSecretProblems(prodEnv())).toEqual([]);
    });

    it('rejects an impersonation secret that is too short', () => {
      const problems = findProductionSecretProblems(
        prodEnv({ IMPERSONATION_SECRET: 'short' }),
      );
      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatch(/too short/);
    });

    it('rejects an archive key that is not 64 hex chars', () => {
      const problems = findProductionSecretProblems(
        prodEnv({ ARCHIVE_ENCRYPTION_KEY: 'zz' + 'a'.repeat(62) }),
      );
      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatch(/64 hexadecimal/);
    });
  });
});
