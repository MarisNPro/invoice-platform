import { Prisma } from '@prisma/client';
import { getTenantId, isTenantBypassed } from './tenant-context';

/**
 * Structural tenant isolation.
 *
 * Prisma reaches Postgres on the postgres/service_role connection, which
 * BYPASSES RLS — so this app-side injection is what actually protects tenants.
 * The extension auto-injects the current tenant (from AsyncLocalStorage) into
 * every operation on a tenant-scoped model.
 *
 * Models WITHOUT a tenantId column (InvoiceLine, Attachment, InvoiceTransmission,
 * InvoiceVatBreakdown, Address) are intentionally NOT injected — they are reached
 * through their tenant-scoped parent and are covered by RLS join policies.
 */

/** Prisma model names with a direct `tenantId` column. */
const TENANT_SCOPED = new Set<string>([
  'User', 'Contact', 'Product', 'TaxRate', 'InvoiceCounter', 'Invoice',
  'Payment', 'BankAccount', 'AuditLog', 'ImportArchive', 'ApiKey',
  'RecurringInvoice', 'CloudArchive',
]);

/** Tenant is special-cased: its tenant column is `id`, not `tenantId`. */
const TENANT_SELF = 'Tenant';

/** Operations whose `where` we scope to the tenant. */
const WHERE_OPS = new Set([
  'findMany', 'findFirst', 'findFirstOrThrow',
  'count', 'aggregate', 'groupBy',
  'updateMany', 'deleteMany',
]);

/** Unique-where operations — we assert ownership on the result instead. */
const ASSERT_OPS = new Set(['findUnique', 'findUniqueOrThrow', 'update', 'delete']);

export interface TenantOp {
  model?: string;
  operation: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: (args: any) => Promise<any>;
}

/**
 * Core injection logic — exported for unit testing. Applied to every model
 * operation by the extension below.
 */
export async function scopeOperation({ model, operation, args, query }: TenantOp): Promise<unknown> {
  const isSelf = model === TENANT_SELF;
  const scoped = isSelf || (model !== undefined && TENANT_SCOPED.has(model));

  // Non-scoped models, or an explicit bypass, run untouched.
  if (!scoped || isTenantBypassed()) return query(args);

  const tenantId = getTenantId();
  if (!tenantId) {
    // Fail-closed: a tenant-scoped op with no context could leak across tenants
    // (service_role bypasses RLS). Trusted system/superadmin code must opt out
    // via runUnscoped().
    throw new Error(
      `Tenant isolation: no tenant context for ${model}.${operation}. ` +
        `Wrap the request in runWithTenant(), or use runUnscoped() for system code.`,
    );
  }

  const column = isSelf ? 'id' : 'tenantId';

  if (WHERE_OPS.has(operation)) {
    args = args ?? {};
    args.where = { ...(args.where ?? {}), [column]: tenantId };
    return query(args);
  }

  if (operation === 'create') {
    // Tenant.create makes a NEW tenant — never force its id to the caller's.
    if (!isSelf) {
      args = args ?? {};
      args.data = { ...(args.data ?? {}), [column]: tenantId };
    }
    return query(args);
  }

  if (operation === 'createMany') {
    if (!isSelf) {
      args = args ?? {};
      const data = args.data;
      args.data = Array.isArray(data)
        ? data.map((row: Record<string, unknown>) => ({ ...row, [column]: tenantId }))
        : { ...(data ?? {}), [column]: tenantId };
    }
    return query(args);
  }

  if (ASSERT_OPS.has(operation)) {
    // Unique where — can't inject tenantId into a unique selector, so assert
    // ownership on the returned row. Prefer updateMany/deleteMany for
    // tenant-scoped mutations (those get where-injection above).
    const result = await query(args);
    const owner = (result as Record<string, unknown> | null)?.[column];
    if (result && owner !== undefined && owner !== tenantId) {
      throw new Error(`Tenant isolation: cross-tenant access denied for ${model}.${operation}.`);
    }
    return result;
  }

  if (operation === 'upsert') {
    args = args ?? {};
    if (!isSelf) args.create = { ...(args.create ?? {}), [column]: tenantId };
    const result = await query(args);
    const owner = (result as Record<string, unknown> | null)?.[column];
    if (result && owner !== undefined && owner !== tenantId) {
      throw new Error(`Tenant isolation: cross-tenant access denied for ${model}.upsert.`);
    }
    return result;
  }

  return query(args);
}

export const tenantExtension = Prisma.defineExtension({
  name: 'tenant-isolation',
  query: {
    $allModels: {
      $allOperations: scopeOperation,
    },
  },
});
