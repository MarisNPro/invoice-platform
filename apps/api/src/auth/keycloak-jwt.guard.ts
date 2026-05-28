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

@Injectable()
export class KeycloakJwtGuard implements CanActivate {
  private readonly logger = new Logger(KeycloakJwtGuard.name);
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;
  private readonly issuer: string;
  private readonly audience: string;

  constructor(
    private readonly config: ConfigService,
    private readonly reflector: Reflector,
  ) {
    const url = config.getOrThrow<string>('KEYCLOAK_URL');
    const realm = config.getOrThrow<string>('KEYCLOAK_REALM');
    this.audience = config.getOrThrow<string>('KEYCLOAK_CLIENT_ID');
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
    // synthetic admin user — allows testing without a running Keycloak.
    // NEVER enable in production; the NODE_ENV guard makes it safe.
    if (
      process.env.NODE_ENV !== 'production' &&
      request.headers['x-dev-tenant-id']
    ) {
      const tenantId = String(request.headers['x-dev-tenant-id']);
      (request as FastifyRequest & { user: JwtPayload }).user = {
        sub:                'dev-user-00000000-0000-0000-0000-000000000001',
        iat:                0,
        exp:                9_999_999_999,
        aud:                this.audience,
        iss:                this.issuer,
        email:              'dev@localhost',
        name:               'Dev User',
        preferred_username: 'dev',
        tenant_id:          tenantId,
        realm_access: {
          roles: ['invoice-admin', 'invoice-accountant', 'invoice-viewer', 'superadmin'],
        },
        resource_access: {},
      };
      this.logger.warn(`DEV BYPASS — tenant=${tenantId} (never use in production)`);
      return true;
    }

    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException('Missing Bearer token');
    }

    try {
      const { payload } = await jwtVerify<JWTPayload>(token, this.jwks, {
        issuer: this.issuer,
        audience: this.audience,
      });

      // Attach decoded payload to request for downstream use
      (request as FastifyRequest & { user: JwtPayload }).user =
        payload as unknown as JwtPayload;

      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'JWT verification failed';
      this.logger.warn(`Auth failed: ${message}`);
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
