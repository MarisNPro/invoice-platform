import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';
import type { FastifyRequest } from 'fastify';
import type { JwtPayload } from './jwt-payload.interface';
import { IS_PUBLIC_KEY } from './public.decorator';
import { isDevBypassEnabled, buildDevBypassUser } from './dev-bypass.util';

@Injectable()
export class KeycloakJwtGuard implements CanActivate {
  private readonly logger = new Logger(KeycloakJwtGuard.name);
  private readonly jwks?: ReturnType<typeof createRemoteJWKSet>;
  private readonly issuer: string;
  private readonly audience: string;
  /** True only when KEYCLOAK_URL/REALM/CLIENT_ID are all present. */
  private readonly keycloakConfigured: boolean;

  constructor(
    private readonly config: ConfigService,
    private readonly reflector: Reflector,
  ) {
    const url = (config.get<string>('KEYCLOAK_URL') ?? '').trim();
    const realm = (config.get<string>('KEYCLOAK_REALM') ?? '').trim();
    const clientId = (config.get<string>('KEYCLOAK_CLIENT_ID') ?? '').trim();
    this.keycloakConfigured = url !== '' && realm !== '' && clientId !== '';

    if (!this.keycloakConfigured) {
      // Fail fast in production: refusing to boot is far safer than silently
      // serving requests with authentication disabled on a live deployment.
      if (process.env.NODE_ENV === 'production') {
        throw new Error(
          'KEYCLOAK_URL, KEYCLOAK_REALM and KEYCLOAK_CLIENT_ID are required in ' +
            'production — refusing to start with authentication disabled.',
        );
      }
      this.issuer = '';
      this.audience = '';
      this.logger.warn(
        'Keycloak is NOT configured — JWT verification is disabled. Only the ' +
          'x-dev-tenant-id dev bypass will grant access (non-production only).',
      );
      return;
    }

    this.audience = clientId;
    this.issuer = `${url}/realms/${realm}`;

    const jwksUri = `${this.issuer}/protocol/openid-connect/certs`;
    this.jwks = createRemoteJWKSet(new URL(jwksUri), {
      cacheMaxAge: 10 * 60 * 1000, // cache public keys 10 min
    });

    this.logger.log(`JWKS endpoint: ${jwksUri}`);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Allow @Public() routes through without a token
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<FastifyRequest>();

    // ── Dev bypass ─────────────────────────────────────────────────────────
    // When NODE_ENV !== 'production', an `x-dev-tenant-id` header injects a
    // synthetic admin user (shared helper). NEVER enabled in production.
    if (isDevBypassEnabled() && request.headers['x-dev-tenant-id']) {
      const tenantId = String(request.headers['x-dev-tenant-id']);
      (request as FastifyRequest & { user: JwtPayload }).user =
        buildDevBypassUser(tenantId);
      this.logger.warn(`DEV BYPASS — tenant=${tenantId} (never use in production)`);
      return true;
    }

    // ── Keycloak not configured ───────────────────────────────────────────
    // Reached only in non-production (production fails fast in the constructor).
    // Without Keycloak we cannot verify a JWT, so the dev bypass above is the
    // only valid entry point — reject everything else rather than allowing it.
    if (!this.keycloakConfigured) {
      throw new UnauthorizedException(
        'Authentication unavailable: Keycloak is not configured. ' +
          'Use the x-dev-tenant-id header (non-production only).',
      );
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
      this.logger.warn(`Auth failed: ${message}`);
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  isConfigured(): boolean {
    return this.keycloakConfigured;
  }

  /** Verify a Keycloak JWT and return the decoded payload (no @Public/dev-bypass). */
  async verifyToken(token: string): Promise<JwtPayload> {
    if (!this.keycloakConfigured || !this.jwks) {
      throw new UnauthorizedException('Keycloak auth is not configured');
    }
    const { payload } = await jwtVerify<JWTPayload>(token, this.jwks, {
      issuer: this.issuer,
      audience: this.audience,
    });
    const mapped = payload as unknown as JwtPayload;
    mapped.auth_source = 'keycloak';
    return mapped;
  }

  private extractToken(request: FastifyRequest): string | null {
    const auth = request.headers['authorization'];
    if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
      return auth.slice(7);
    }
    return null;
  }
}
