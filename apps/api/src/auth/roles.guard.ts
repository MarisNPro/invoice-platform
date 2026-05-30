import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { ROLES_KEY, Role } from './roles.decorator';
import type { JwtPayload } from './jwt-payload.interface';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No @Roles() decorator → route is public (after JWT guard passes)
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<FastifyRequest & { user?: JwtPayload }>();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('No user context');
    }

    // Collect all roles from every supported source:
    //  - Keycloak: realm_access.roles + resource_access[client].roles
    //  - Supabase: app_metadata.role (single role string, client-immutable)
    const realmRoles = user.realm_access?.roles ?? [];
    const resourceRoles = Object.values(user.resource_access ?? {}).flatMap(
      (r) => r.roles,
    );
    const supabaseRole = user.app_metadata?.role ? [user.app_metadata.role] : [];
    const allRoles = new Set([...realmRoles, ...resourceRoles, ...supabaseRole]);

    const hasRole = requiredRoles.some((r) => allRoles.has(r));

    if (!hasRole) {
      throw new ForbiddenException(
        `Requires one of: [${requiredRoles.join(', ')}]`,
      );
    }

    return true;
  }
}
