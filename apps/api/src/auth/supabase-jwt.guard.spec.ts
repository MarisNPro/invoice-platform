/**
 * Unit tests for SupabaseJwtGuard and its claim extractor.
 *
 * Focus — the multi-tenant security boundary:
 *  - tenant_id/role come ONLY from app_metadata (client-immutable)
 *  - tenant_id in user_metadata (client-editable) is IGNORED → rejected
 *  - missing app_metadata.tenant_id → rejected
 *  - @Public() routes pass; non-prod x-dev-tenant-id bypass works; no token → 401
 */

import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { JWTPayload } from 'jose';
import type { FastifyRequest } from 'fastify';
import {
  SupabaseJwtGuard,
  extractSupabaseTenantContext,
} from './supabase-jwt.guard';
import type { JwtPayload } from './jwt-payload.interface';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeConfig(overrides: Record<string, string> = {}): ConfigService {
  return { get: (k: string) => overrides[k] } as unknown as ConfigService;
}

function makeReflector(isPublic = false): Reflector {
  return { getAllAndOverride: () => isPublic } as unknown as Reflector;
}

function makeContext(headers: Record<string, string> = {}): {
  ctx: ExecutionContext;
  request: FastifyRequest & { user?: JwtPayload };
} {
  const request = { headers } as unknown as FastifyRequest & {
    user?: JwtPayload;
  };
  const ctx = {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { ctx, request };
}

const SUPABASE = { SUPABASE_URL: 'https://ppzizluxjpjwjxpbdoid.supabase.co' };
const DEV_TENANT = '11111111-1111-1111-1111-111111111111';

// ── Pure extractor — the security boundary ─────────────────────────────────────

describe('extractSupabaseTenantContext', () => {
  it('reads tenant_id and role from app_metadata', () => {
    const payload = {
      sub: 'u1',
      app_metadata: { tenant_id: 'tenant-A', role: 'invoice-admin' },
    } as unknown as JWTPayload;
    expect(extractSupabaseTenantContext(payload)).toEqual({
      tenantId: 'tenant-A',
      role: 'invoice-admin',
    });
  });

  it('SECURITY: ignores tenant_id in user_metadata and rejects', () => {
    // user_metadata is client-writable — must never be trusted for tenant_id.
    const payload = {
      sub: 'u1',
      user_metadata: { tenant_id: 'tenant-EVIL' },
    } as unknown as JWTPayload;
    expect(() => extractSupabaseTenantContext(payload)).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects when app_metadata.tenant_id is missing', () => {
    const payload = {
      sub: 'u1',
      app_metadata: { role: 'invoice-viewer' },
    } as unknown as JWTPayload;
    expect(() => extractSupabaseTenantContext(payload)).toThrow(
      UnauthorizedException,
    );
  });

  it('tolerates a missing role (tenant_id still required)', () => {
    const payload = {
      sub: 'u1',
      app_metadata: { tenant_id: 'tenant-A' },
    } as unknown as JWTPayload;
    expect(extractSupabaseTenantContext(payload)).toEqual({
      tenantId: 'tenant-A',
      role: undefined,
    });
  });
});

// ── Guard behaviour ─────────────────────────────────────────────────────────────

describe('SupabaseJwtGuard', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('constructs without SUPABASE_URL (path disabled, not configured)', () => {
    const guard = new SupabaseJwtGuard(makeConfig({}), makeReflector());
    expect(guard.isConfigured()).toBe(false);
  });

  it('reports configured when SUPABASE_URL is set', () => {
    const guard = new SupabaseJwtGuard(makeConfig(SUPABASE), makeReflector());
    expect(guard.isConfigured()).toBe(true);
  });

  it('verifyToken throws when Supabase is not configured', async () => {
    const guard = new SupabaseJwtGuard(makeConfig({}), makeReflector());
    await expect(guard.verifyToken('whatever')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('allows @Public() routes', async () => {
    process.env.NODE_ENV = 'development';
    const guard = new SupabaseJwtGuard(makeConfig(SUPABASE), makeReflector(true));
    const { ctx } = makeContext({});
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('allows the x-dev-tenant-id bypass (non-prod) and injects tenant + roles', async () => {
    process.env.NODE_ENV = 'staging';
    const guard = new SupabaseJwtGuard(makeConfig({}), makeReflector());
    const { ctx, request } = makeContext({ 'x-dev-tenant-id': DEV_TENANT });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.user?.tenant_id).toBe(DEV_TENANT);
    expect(request.user?.app_metadata?.role).toBe('superadmin');
    expect(request.user?.auth_source).toBe('dev');
  });

  it('rejects requests with no token and no bypass header', async () => {
    process.env.NODE_ENV = 'development';
    const guard = new SupabaseJwtGuard(makeConfig(SUPABASE), makeReflector());
    const { ctx } = makeContext({});
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
