/**
 * Production secret fail-fast (US-006 / R-01).
 *
 * Several modules fall back to insecure dev defaults when their secret env var
 * is unset:
 *   • IMPERSONATION_SECRET → 'dev-impersonation-secret'  (admin.service.ts,
 *     impersonate.controller.ts) — signs HS256 superadmin impersonation tokens.
 *     A guessable value lets anyone forge a session for any user / tenant.
 *   • ARCHIVE_ENCRYPTION_KEY → 64 zeros  (archive.service.ts,
 *     archive-sync.job.ts) — the AES key protecting cloud-archive OAuth tokens
 *     at rest. A known key makes those stored tokens effectively plaintext.
 *
 * These defaults are convenient in dev but catastrophic in production, so the
 * process must refuse to boot with them. The checks are pure (env in, problems
 * out) so they unit-test cleanly and the worker can mirror the archive check
 * (the worker is a standalone process and cannot import from this package).
 */

/** The insecure fallback used by the impersonation signing code. */
export const DEV_IMPERSONATION_SECRET = 'dev-impersonation-secret';

/** The insecure fallback used by the archive encryption code (64 zeros). */
export const INSECURE_ARCHIVE_KEY = '0'.repeat(64);

/** Impersonation secrets shorter than this are rejected even if non-default. */
const MIN_IMPERSONATION_SECRET_LENGTH = 32;

type Env = Record<string, string | undefined>;

/** Returns a problem string if IMPERSONATION_SECRET is unsafe, else null. */
export function impersonationSecretProblem(env: Env): string | null {
  const value = env.IMPERSONATION_SECRET;
  if (!value || value === DEV_IMPERSONATION_SECRET) {
    return 'IMPERSONATION_SECRET is unset or still the dev default — set a strong unique value (openssl rand -hex 32).';
  }
  if (value.length < MIN_IMPERSONATION_SECRET_LENGTH) {
    return `IMPERSONATION_SECRET is too short (${value.length} chars; require >= ${MIN_IMPERSONATION_SECRET_LENGTH}).`;
  }
  return null;
}

/** Returns a problem string if ARCHIVE_ENCRYPTION_KEY is unsafe, else null. */
export function archiveKeyProblem(env: Env): string | null {
  const value = env.ARCHIVE_ENCRYPTION_KEY;
  if (!value || value === INSECURE_ARCHIVE_KEY) {
    return 'ARCHIVE_ENCRYPTION_KEY is unset or all-zeros — set 64 hex chars (openssl rand -hex 32).';
  }
  if (!/^[0-9a-fA-F]{64}$/.test(value)) {
    return 'ARCHIVE_ENCRYPTION_KEY must be exactly 64 hexadecimal characters (openssl rand -hex 32).';
  }
  return null;
}

/**
 * Collect every production-secret problem for the given env. Order is stable so
 * the boot error reads predictably.
 */
export function findProductionSecretProblems(env: Env): string[] {
  return [impersonationSecretProblem(env), archiveKeyProblem(env)].filter(
    (p): p is string => p !== null,
  );
}

/**
 * Fail-fast guard for API bootstrap. A no-op unless NODE_ENV === 'production',
 * so local dev and tests keep their convenient defaults. Throws a single error
 * listing every offending secret when run in production.
 */
export function assertProductionSecrets(env: Env = process.env): void {
  if (env.NODE_ENV !== 'production') return;
  const problems = findProductionSecretProblems(env);
  if (problems.length === 0) return;
  throw new Error(
    `Refusing to start in production with insecure secrets:\n${problems
      .map((p) => `  • ${p}`)
      .join('\n')}`,
  );
}
