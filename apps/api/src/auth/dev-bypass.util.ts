import type { JwtPayload } from './jwt-payload.interface';

/**
 * The `x-dev-tenant-id` bypass is allowed ONLY outside production. This is the
 * single source of truth for that gate — both the composite guard and the
 * Supabase/Keycloak guards consult it so the rule can never drift.
 */
export function isDevBypassEnabled(): boolean {
  return process.env.NODE_ENV !== 'production';
}

/**
 * Build the synthetic admin user injected by the `x-dev-tenant-id` dev bypass.
 * Carries roles in BOTH shapes (Keycloak realm_access + Supabase app_metadata)
 * so RolesGuard authorises regardless of which provider path is active.
 *
 * NEVER reachable in production — callers must gate on isDevBypassEnabled().
 */
export function buildDevBypassUser(tenantId: string): JwtPayload {
  return {
    sub:                'dev-user-00000000-0000-0000-0000-000000000001',
    iat:                0,
    exp:                9_999_999_999,
    aud:                'authenticated',
    iss:                'dev',
    email:              'dev@localhost',
    name:               'Dev User',
    preferred_username: 'dev',
    tenant_id:          tenantId,
    realm_access: {
      roles: ['invoice-admin', 'invoice-accountant', 'invoice-viewer', 'superadmin'],
    },
    resource_access: {},
    app_metadata: { tenant_id: tenantId, role: 'superadmin' },
    auth_source: 'dev',
  };
}
