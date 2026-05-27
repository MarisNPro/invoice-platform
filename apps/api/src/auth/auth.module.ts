import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { KeycloakJwtGuard } from './keycloak-jwt.guard';
import { RolesGuard } from './roles.guard';

/**
 * AuthModule registers KeycloakJwtGuard and RolesGuard globally via APP_GUARD,
 * so every route is protected by default.
 *
 * To make a specific route public, add @Public() decorator (see below).
 */
@Module({
  providers: [
    KeycloakJwtGuard,
    RolesGuard,
    { provide: APP_GUARD, useClass: KeycloakJwtGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [KeycloakJwtGuard, RolesGuard],
})
export class AuthModule {}
