/**
 * Unit tests for CompositeAuthGuard — the global authn guard for the
 * Keycloak → Supabase migration, now with Keycloak being retired.
 *
 * Security-critical invariants verified here:
 *  - BOOT: production refuses to start when NEITHER provider is configured
 *    (no auth must never silently boot).
 *  - BOOT: "Supabase configured, Keycloak not" is a VALID, booting state.
 *  - REQUEST: every non-@Public route requires a token; an unverifiable token
 *    is 401 — no route is ever left unprotected.
 *  - The x-dev-tenant-id bypass is disabled in production (NODE_ENV gated).
 */

import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { CompositeAuthGuard } from './composite-auth.guard';
import type { SupabaseJwtGuard } from './supabase-jwt.guard';
import type { KeycloakJwtGuard } from './keycloak-jwt.guard';
import type { JwtPayload } from './jwt-payload.interface';

// ── Helpers ───────────────────────────────────────────────────────────────────

const TENANT = '22222222-2222-2222-2222-222222222222';
const DEV_TENANT = '11111111-1111-1111-1111-111111111111';

function makeReflector(isPublic = false): Reflector {
  return { getAllAndOverride: () => isPublic } as unknown as Reflector;
}

/** A stand-in provider exposing the isConfigured()/verifyToken() surface the
 *  composite guard depends on. */
function provider(
  configured: boolean,
  verify?: (token: string) => Promise<JwtPayload>,
): SupabaseJwtGuard & KeycloakJwtGuard {
  return {
    isConfigured: () => configured,
    verifyToken:
      verify ??
      (async () => {
        throw new UnauthorizedException('not configured');
      }),
  } as unknown as SupabaseJwtGuard & KeycloakJwtGuard;
}

function payload(source: 'supabase' | 'keycloak', tenantId = TENANT): JwtPayload {
  return {
    sub: 'user-1',
    iat: 0,
    exp: 9_999_999_999,
    aud: 'authenticated',
    iss: 'test',
    tenant_id: tenantId,
    app_metadata: { tenant_id: tenantId, role: 'invoice-admin' },
    auth_source: source,
  } as JwtPayload;
}

function makeContext(
  headers: Record<string, string> = {},
): { ctx: ExecutionContext; request: FastifyRequest & { user?: JwtPayload } } {
  const request = { headers } as unknown as FastifyRequest & { user?: JwtPayload };
  const ctx = {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { ctx, request };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('CompositeAuthGuard', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  describe('boot-time provider check', () => {
    it('refuses to boot in production when NEITHER provider is configured', () => {
      process.env.NODE_ENV = 'production';
      expect(
        () =>
          new CompositeAuthGuard(
            makeReflector(),
            provider(false),
            provider(false),
          ),
      ).toThrow(/no auth provider/i);
    });

    it('boots in production with Supabase configured and Keycloak NOT (target state)', () => {
      process.env.NODE_ENV = 'production';
      expect(
        () =>
          new CompositeAuthGuard(
            makeReflector(),
            provider(true), // supabase configured
            provider(false), // keycloak retired
          ),
      ).not.toThrow();
    });

    it('boots in production with only Keycloak configured (legacy still allowed)', () => {
      process.env.NODE_ENV = 'production';
      expect(
        () =>
          new CompositeAuthGuard(makeReflector(), provider(false), provider(true)),
      ).not.toThrow();
    });

    it('does not throw outside production even when neither provider is configured', () => {
      process.env.NODE_ENV = 'development';
      expect(
        () =>
          new CompositeAuthGuard(makeReflector(), provider(false), provider(false)),
      ).not.toThrow();
    });
  });

  describe('canActivate (Supabase-only, production)', () => {
    function supabaseOnlyGuard(verify?: (t: string) => Promise<JwtPayload>) {
      process.env.NODE_ENV = 'production';
      return new CompositeAuthGuard(
        makeReflector(),
        provider(true, verify),
        provider(false),
      );
    }

    it('authenticates a valid Supabase token (the Keycloak branch is skipped)', async () => {
      const guard = supabaseOnlyGuard(async () => payload('supabase'));
      const { ctx, request } = makeContext({ authorization: 'Bearer good.token' });

      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(request.user?.tenant_id).toBe(TENANT);
      expect(request.user?.auth_source).toBe('supabase');
    });

    it('allows @Public() routes through without a token', async () => {
      process.env.NODE_ENV = 'production';
      const guard = new CompositeAuthGuard(
        makeReflector(true),
        provider(true),
        provider(false),
      );
      const { ctx } = makeContext({});
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('rejects a request with no Bearer token (401)', async () => {
      const guard = supabaseOnlyGuard(async () => payload('supabase'));
      const { ctx } = makeContext({});
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rejects a token that fails the only configured provider (401)', async () => {
      const guard = supabaseOnlyGuard(async () => {
        throw new UnauthorizedException('bad token');
      });
      const { ctx } = makeContext({ authorization: 'Bearer bad.token' });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('does NOT honour x-dev-tenant-id in production (bypass disabled) — 401', async () => {
      const guard = supabaseOnlyGuard(async () => {
        throw new UnauthorizedException('bad token');
      });
      const { ctx } = makeContext({ 'x-dev-tenant-id': DEV_TENANT }); // no token
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  describe('canActivate (fallback + dev bypass)', () => {
    it('falls back to Keycloak when Supabase is unconfigured', async () => {
      process.env.NODE_ENV = 'production';
      const guard = new CompositeAuthGuard(
        makeReflector(),
        provider(false), // supabase off
        provider(true, async () => payload('keycloak')), // keycloak on
      );
      const { ctx, request } = makeContext({ authorization: 'Bearer kc.token' });

      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(request.user?.auth_source).toBe('keycloak');
    });

    it('honours the x-dev-tenant-id bypass outside production', async () => {
      process.env.NODE_ENV = 'development';
      const guard = new CompositeAuthGuard(
        makeReflector(),
        provider(true),
        provider(false),
      );
      const { ctx, request } = makeContext({ 'x-dev-tenant-id': DEV_TENANT });

      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(request.user?.tenant_id).toBe(DEV_TENANT);
    });
  });
});
