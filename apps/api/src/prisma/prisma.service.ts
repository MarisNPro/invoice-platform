import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { tenantExtension } from './tenant-extension';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'error' },
      ],
    });

    // Apply structural tenant isolation as a query extension. $extends returns a
    // NEW client; returning it from the constructor makes `new PrismaService()`
    // *be* the extended client, so every repository that injects PrismaService
    // gets tenantId auto-injection with no per-repository changes. The base
    // lifecycle methods ($connect/$disconnect/$on/$transaction) are preserved by
    // the extended client.
    return this.$extends(tenantExtension) as unknown as PrismaService;
  }

  async onModuleInit() {
    // Log slow queries (> 500ms) in development
    if (process.env.NODE_ENV !== 'production') {
      // @ts-expect-error — typed event from Prisma client log
      this.$on('query', (e: { query: string; duration: number }) => {
        if (e.duration > 500) {
          this.logger.warn(`Slow query (${e.duration}ms): ${e.query}`);
        }
      });
    }

    await this.$connect();
    this.logger.log('Prisma connected to PostgreSQL');
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('Prisma disconnected');
  }

  /**
   * Convenience wrapper: runs callback inside a Prisma transaction with
   * reasonable defaults for the EU invoice platform.
   */
  async withTransaction<T>(
    callback: (tx: Omit<PrismaService, 'withTransaction' | '$transaction' | '$connect' | '$disconnect' | '$on' | '$use' | '$extends'>) => Promise<T>,
  ): Promise<T> {
    return this.$transaction(callback as Parameters<typeof this.$transaction>[0], {
      maxWait: 5_000,
      timeout: 15_000,
      isolationLevel: 'ReadCommitted',
    }) as Promise<T>;
  }
}
