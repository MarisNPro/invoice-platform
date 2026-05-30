import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { FastifyRequest } from 'fastify';
import type { JwtPayload } from './jwt-payload.interface';
import { IS_PUBLIC_KEY } from './public.decorator';
import { isDevBypassEnabled, buildDevBypassUser } from './dev-bypass.util';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/**
 * SECURITY BOUNDARY — extract tenant_id and role ONLY from `app_metadata`.
 *
 * `app_metadata` is server/admin-controlled and immutable from the client.
 * `user_metadata` is freely writable by the client via supabase.auth.updateUser()
 * and is therefore NEVER trusted for authorization. Reading tenant_id from
 * user_metadata would let any user move themselves into another tenant.
 *
 * Exported as a pure function so this boundary is directly unit-testable.
 */
export function extractSupabaseTenantContext(
  payload: JWTPayload,
): { tenantId: string; role?: string } {
  const appMeta = (payload as { app_metadata?: unknown }).app_metadata;

  const tenantId =
    isRecord(appMeta) && typeof appMeta.tenant_id === 'string'
      ? appMeta.tenant_id
      : undefined;

  if (!tenantId) {
    throw new UnauthorizedException(
      'Supabase token missing app_metadata.tenant_id',
    );
  }

  const role =
    isRecord(appMeta) && typeof appMeta.role === 'string'
      ? appMeta.role
      : undefined;

  return { tenantId, role };
}

/**
 * Validates a Supabase Auth JWT using the project's asymmetric (ES256) signing
 * keys, fetched from the JWKS endpoint. No shared secret lives in the API.
 *
 * Standalone-capable (handles @Public + dev bypass) so it can be unit-tested in
 * isolation, and exposes verifyToken()/isConfigured() for the composite guard.
 */
@Injectable()
export class SupabaseJwtGuard implements CanActivate {
  private readonly logger = new Logger(SupabaseJwtGuard.name);
  private readonly jwks?: ReturnType<typeof createRemoteJWKSet>;
  private readonly issuer: string;
  private readonly configured: boolean;

  constructor(
    private readonly config: ConfigService,
    private readonly reflector: Reflector,
  ) {
    const url = (config.get<string>('SUPABASE_URL') ?? '').trim().replace(/\/$/, '');
    this.configured = url !== '';

    if (!this.configured) {
      // Not fatal on its own — during the migration the composite guard may run
      // Keycloak-only. The composite enforces "≥1 provider configured in prod".
      this.issuer = '';
      this.logger.log('SUPABASE_URL not set — Supabase auth path disabled.');
      return;
    }

    this.issuer = `${url}/auth/v1`;
    const jwksUri = `${this.issuer}/.well-known/jwks.json`;
    this.jwks = createRemoteJWKSet(new URL(jwksUri), {
      cacheMaxAge: 10 * 60 * 1000, // cache public keys 10 min
    });
    this.logger.log(`Supabase JWKS endpoint: ${jwksUri}`);
  }

  isConfigured(): boolean {
    return this.configured;
  }

  /**
   * Verify a Supabase JWT and map it into the shared JwtPayload shape.
   * Throws if the token is invalid or carries no app_metadata.tenant_id.
   */
  async verifyToken(token: string): Promise<JwtPayload> {
    if (!this.configured || !this.jwks) {
      throw new UnauthorizedException('Supabase auth is not configured');
    }

    const { payload } = await jwtVerify(token, this.jwks, {
      issuer: this.issuer,
      audience: 'authenticated',
      algorithms: ['ES256'],
    });

    const { tenantId, role } = extractSupabaseTenantContext(payload);

    return {
      sub:   String(payload.sub ?? ''),
      iat:   Number(payload.iat ?? 0),
      exp:   Number(payload.exp ?? 0),
      aud:   'authenticated',
      iss:   this.issuer,
      email: typeof payload.email === 'string' ? payload.email : undefined,
      tenant_id:    tenantId,
      app_metadata: { tenant_id: tenantId, role },
      auth_source:  'supabase',
    };
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<FastifyRequest>();

    // Dev bypass — non-production only.
    if (isDevBypassEnabled() && request.headers['x-dev-tenant-id']) {
      const tenantId = String(request.headers['x-dev-tenant-id']);
      (request as FastifyRequest & { user: JwtPayload }).user =
        buildDevBypassUser(tenantId);
      this.logger.warn(`DEV BYPASS — tenant=${tenantId} (never use in production)`);
      return true;
    }

    const token = this.extractToken(request);
    if (!token) {
      throw new UnauthorizedException('Missing Bearer token');
    }

    try {
      (request as FastifyRequest & { user: JwtPayload }).user =
        await this.verifyToken(token);
      return true;
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      const message = err instanceof Error ? err.message : 'JWT verification failed';
      this.logger.warn(`Supabase auth failed: ${message}`);
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  private extractToken(request: FastifyRequest): string | null {
    const auth = request.headers['authorization'];
    if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
      return auth.slice(7);
    }
    return null;
  }
}
