import { AsyncLocalStorage } from 'node:async_hooks';

interface TenantStore {
  tenantId?: string;
  /**
   * When true, the Prisma tenant extension skips injection entirely. For
   * trusted cross-tenant/system code only (superadmin reads, schedulers, etc.).
   */
  bypass?: boolean;
}

const storage = new AsyncLocalStorage<TenantStore>();

/** Run `fn` with `tenantId` bound to the current async context. */
export function runWithTenant<T>(tenantId: string, fn: () => T): T {
  return storage.run({ tenantId }, fn);
}

/**
 * Run `fn` with tenant injection DISABLED. Use sparingly and only for trusted
 * code that legitimately spans tenants (e.g. superadmin dashboards, migrations).
 */
export function runUnscoped<T>(fn: () => T): T {
  return storage.run({ bypass: true }, fn);
}

/** The current tenant id, or `undefined` when outside any tenant context. */
export function getTenantId(): string | undefined {
  return storage.getStore()?.tenantId;
}

/** True when the current context explicitly bypasses tenant injection. */
export function isTenantBypassed(): boolean {
  return storage.getStore()?.bypass === true;
}
