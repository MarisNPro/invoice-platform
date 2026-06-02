import { Global, Module, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';
import { RESILIENT_REDIS_OPTIONS } from './redis-connection';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Redis => {
        const logger = new Logger('RedisModule');
        const url = config.get<string>('REDIS_URL', 'redis://localhost:6379');

        // lazyConnect: connect in the background on first command — constructing
        // the client must never block or crash bootstrap. TLS is inferred from a
        // rediss:// URL string. RESILIENT_REDIS_OPTIONS keeps it alive across
        // Upstash resets (maxRetriesPerRequest: null, enableReadyCheck: false).
        const client = new Redis(url, {
          lazyConnect: true,
          ...RESILIENT_REDIS_OPTIONS,
        });

        client.on('connect', () => logger.log('Redis connected'));
        client.on('error', (err) => logger.error(`Redis error: ${err.message}`));

        // Kick off the background connection without awaiting it.
        client.connect().catch((err) =>
          logger.error(`Initial Redis connect failed (will retry): ${err.message}`),
        );

        return client;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
