import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { KeycloakJwtGuard } from './keycloak-jwt.guard';
import { RolesGuard } from './roles.guard';
import { ImpersonateController } from './impersonate.controller';

/**
 * AuthModule registers KeycloakJwtGuard and RolesGuard globally via APP_GUARD,
 * so every route is protected by default.
 *
 * To make a specific route public, add @Public() decorator (see below).
 */
@Module({
  controllers: [ImpersonateController],
  providers: [
    KeycloakJwtGuard,
    RolesGuard,
    { provide: APP_GUARD, useClass: KeycloakJwtGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [KeycloakJwtGuard, RolesGuard],
})
export class AuthModule {}
