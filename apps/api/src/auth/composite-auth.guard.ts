import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import type { JwtPayload } from './jwt-payload.interface';
import { IS_PUBLIC_KEY } from './public.decorator';
import { isDevBypassEnabled, buildDevBypassUser } from './dev-bypass.util';
import { SupabaseJwtGuard } from './supabase-jwt.guard';
import { KeycloakJwtGuard } from './keycloak-jwt.guard';

/**
 * Global authentication guard for the Keycloak → Supabase migration.
 *
 * Accepts a valid Supabase JWT OR a valid Keycloak JWT, so both provider's
 * sessions keep working throughout the migration — the guard is never removed,
 * only the set of accepted issuers changes. Tries Supabase first (the target),
 * falls back to Keycloak (legacy). @Public() routes and the non-prod
 * x-dev-tenant-id bypass are handled once, here.
 */
@Injectable()
export class CompositeAuthGuard implements CanActivate {
  private readonly logger = new Logger(CompositeAuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly supabase: SupabaseJwtGuard,
    private readonly keycloak: KeycloakJwtGuard,
  ) {
    // Fail fast: production must have at least one real provider. The dev bypass
    // is disabled in production, so without a provider nothing could ever
    // authenticate — refusing to boot is safer than a confusing runtime state.
    if (
      process.env.NODE_ENV === 'production' &&
      !this.supabase.isConfigured() &&
      !this.keycloak.isConfigured()
    ) {
      throw new Error(
        'No auth provider configured in production — set SUPABASE_URL and/or ' +
          'KEYCLOAK_URL/REALM/CLIENT_ID. Refusing to start with auth disabled.',
      );
    }
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

    // Target provider first, legacy second. A token that fails both → 401.
    if (this.supabase.isConfigured()) {
      try {
        (request as FastifyRequest & { user: JwtPayload }).user =
          await this.supabase.verifyToken(token);
        return true;
      } catch (err) {
        this.logger.debug(`Supabase verify failed: ${this.msg(err)}`);
      }
    }

    if (this.keycloak.isConfigured()) {
      try {
        (request as FastifyRequest & { user: JwtPayload }).user =
          await this.keycloak.verifyToken(token);
        return true;
      } catch (err) {
        this.logger.debug(`Keycloak verify failed: ${this.msg(err)}`);
      }
    }

    throw new UnauthorizedException('Invalid or expired token');
  }

  private extractToken(request: FastifyRequest): string | null {
    const auth = request.headers['authorization'];
    if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
      return auth.slice(7);
    }
    return null;
  }

  private msg(err: unknown): string {
    return err instanceof Error ? err.message : 'verification failed';
  }
}
