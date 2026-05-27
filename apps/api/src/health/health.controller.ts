import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  HealthCheckResult,
  HealthIndicatorResult,
} from '@nestjs/terminus';
import type Redis from 'ioredis';
import { Public } from '../auth/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { InjectRedis } from '../common/redis/redis.decorators';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prisma: PrismaService,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  @Public()
  @Get()
  @HealthCheck()
  check(): Promise<HealthCheckResult> {
    return this.health.check([
      // PostgreSQL — raw query via Prisma
      async (): Promise<HealthIndicatorResult> => {
        try {
          await this.prisma.$queryRaw`SELECT 1`;
          return { postgres: { status: 'up' } };
        } catch {
          return { postgres: { status: 'down' } };
        }
      },

      // Redis — PING
      async (): Promise<HealthIndicatorResult> => {
        try {
          const pong = await this.redis.ping();
          return { redis: { status: pong === 'PONG' ? 'up' : 'down' } };
        } catch {
          return { redis: { status: 'down' } };
        }
      },
    ]);
  }
}
