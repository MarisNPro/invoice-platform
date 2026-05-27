import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { JwtPayload } from './jwt-payload.interface';

/**
 * Extracts the authenticated user (decoded JWT payload) from the request.
 *
 * @example
 * async getMe(@CurrentUser() user: JwtPayload) { ... }
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtPayload => {
    const request = ctx.switchToHttp().getRequest<FastifyRequest & { user: JwtPayload }>();
    return request.user;
  },
);
