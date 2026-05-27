import { SetMetadata } from '@nestjs/common';

/** Platform roles — mirror Keycloak realm roles exactly. */
export enum Role {
  ADMIN = 'invoice-admin',
  ACCOUNTANT = 'invoice-accountant',
  VIEWER = 'invoice-viewer',
}

export const ROLES_KEY = 'roles';

/**
 * Decorator that marks a route with required roles.
 *
 * @example
 * \@Roles(Role.ADMIN, Role.ACCOUNTANT)
 * \@Get(':id')
 * findOne(@Param('id') id: string) { ... }
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
