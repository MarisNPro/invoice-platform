import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { KeycloakJwtGuard } from './keycloak-jwt.guard';
import { SupabaseJwtGuard } from './supabase-jwt.guard';
import { CompositeAuthGuard } from './composite-auth.guard';
import { RolesGuard } from './roles.guard';
import { ImpersonateController } from './impersonate.controller';

/**
 * AuthModule registers the global authentication + authorization guards.
 *
 * During the Keycloak → Supabase migration, CompositeAuthGuard is the global
 * authn guard: it accepts a valid Supabase JWT OR a valid Keycloak JWT (and the
 * non-prod x-dev-tenant-id bypass). RolesGuard runs after it for authorization.
 * Every route is protected by default — opt out with @Public().
 */
@Module({
  controllers: [ImpersonateController],
  providers: [
    SupabaseJwtGuard,
    KeycloakJwtGuard,
    CompositeAuthGuard,
    RolesGuard,
    // Order matters: authenticate (Composite) before authorizing (Roles).
    { provide: APP_GUARD, useClass: CompositeAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [SupabaseJwtGuard, KeycloakJwtGuard, CompositeAuthGuard, RolesGuard],
})
export class AuthModule {}
