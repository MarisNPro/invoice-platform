/**
 * Fastify-aware ThrottlerGuard.
 *
 * NestJS's default ThrottlerGuard reads `req.ips` first (X-Forwarded-For),
 * then falls back to `req.ip`.  Fastify's request object exposes the same
 * property names, so overriding `getTracker` is enough to be explicit and
 * support proxy-forwarded IPs correctly (the API runs behind a load-balancer
 * in production, and `trustProxy: true` is set in main.ts).
 */

import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';

@Injectable()
export class FastifyThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: FastifyRequest): Promise<string> {
    // X-Forwarded-For chain (first IP is the real client with trustProxy: true)
    const forwarded = req.ips;
    if (forwarded?.length) return forwarded[0]!;
    return req.ip ?? 'unknown';
  }
}
