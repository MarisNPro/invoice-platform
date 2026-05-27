import { Global, Module, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Redis => {
        const logger = new Logger('RedisModule');
        const url = config.get<string>('REDIS_URL', 'redis://localhost:6379');

        const client = new Redis(url, {
          lazyConnect: false,
          retryStrategy: (times) => {
            const delay = Math.min(times * 100, 3_000);
            logger.warn(`Redis reconnect attempt #${times}, retrying in ${delay}ms`);
            return delay;
          },
          maxRetriesPerRequest: 3,
        });

        client.on('connect', () => logger.log('Redis connected'));
        client.on('error', (err) => logger.error('Redis error', err));

        return client;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
