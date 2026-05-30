/**
 * Unit tests for KeycloakJwtGuard — focused on the "Keycloak optional in
 * dev/staging" behaviour:
 *  - Production refuses to construct when Keycloak is not configured (fail fast)
 *  - Non-production + unconfigured + x-dev-tenant-id → synthetic admin user
 *  - Non-production + unconfigured + no bypass header → 401 (never blanket-allow)
 *  - @Public() routes are always allowed
 */

import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { KeycloakJwtGuard } from './keycloak-jwt.guard';
import type { JwtPayload } from './jwt-payload.interface';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeConfig(overrides: Record<string, string> = {}): ConfigService {
  return {
    get: (key: string) => overrides[key],
  } as unknown as ConfigService;
}

function makeReflector(isPublic = false): Reflector {
  return {
    getAllAndOverride: () => isPublic,
  } as unknown as Reflector;
}

function makeContext(
  headers: Record<string, string> = {},
): { ctx: ExecutionContext; request: FastifyRequest & { user?: JwtPayload } } {
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

const CONFIGURED = {
  KEYCLOAK_URL: 'https://kc.example.com',
  KEYCLOAK_REALM: 'invoice-platform',
  KEYCLOAK_CLIENT_ID: 'invoice-api',
};

const DEV_TENANT = '11111111-1111-1111-1111-111111111111';

describe('KeycloakJwtGuard — Keycloak optional', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('throws at construction in production when Keycloak is unconfigured', () => {
    process.env.NODE_ENV = 'production';
    expect(() => new KeycloakJwtGuard(makeConfig({}), makeReflector())).toThrow(
      /production/i,
    );
  });

  it('constructs in non-production when Keycloak is unconfigured', () => {
    process.env.NODE_ENV = 'development';
    expect(
      () => new KeycloakJwtGuard(makeConfig({}), makeReflector()),
    ).not.toThrow();
  });

  it('allows the x-dev-tenant-id bypass when Keycloak is unconfigured (non-prod)', async () => {
    process.env.NODE_ENV = 'staging';
    const guard = new KeycloakJwtGuard(makeConfig({}), makeReflector());
    const { ctx, request } = makeContext({ 'x-dev-tenant-id': DEV_TENANT });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.user?.tenant_id).toBe(DEV_TENANT);
    expect(request.user?.realm_access?.roles).toContain('superadmin');
  });

  it('rejects requests without the bypass header when Keycloak is unconfigured', async () => {
    process.env.NODE_ENV = 'development';
    const guard = new KeycloakJwtGuard(makeConfig({}), makeReflector());
    const { ctx } = makeContext({}); // no x-dev-tenant-id, no token

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('allows @Public() routes even when Keycloak is unconfigured', async () => {
    process.env.NODE_ENV = 'development';
    const guard = new KeycloakJwtGuard(makeConfig({}), makeReflector(true));
    const { ctx } = makeContext({});

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('still builds the JWKS issuer/audience when Keycloak is configured', () => {
    process.env.NODE_ENV = 'production';
    expect(
      () => new KeycloakJwtGuard(makeConfig(CONFIGURED), makeReflector()),
    ).not.toThrow();
  });
});
