import type { RedisOptions } from 'ioredis';
import { Logger } from './logger';

const logger = new Logger('RedisConnection');

/**
 * Capped linear backoff — reconnect forever so a transient Upstash reset never
 * permanently drops the worker's queue connections.
 */
function retryStrategy(times: number): number {
  const delay = Math.min(times * 200, 5_000);
  logger.warn(`Redis reconnect attempt #${times}, retrying in ${delay}ms`);
  return delay;
}

/**
 * Shared ioredis options required by BullMQ against Upstash:
 *
 * - `maxRetriesPerRequest: null` — BullMQ REQUIRES this for its blocking Worker
 *   connections, and it stops a transient ECONNRESET from throwing
 *   MaxRetriesPerRequestError.
 * - `enableReadyCheck: false` — Upstash does not support the INFO ready check.
 * - `retryStrategy` — capped backoff, reconnect indefinitely.
 */
export const RESILIENT_REDIS_OPTIONS = {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  retryStrategy,
} satisfies RedisOptions;

/**
 * Build ioredis connection options for BullMQ from a `REDIS_URL`.
 *
 * BullMQ takes an options object (not a URL string), so TLS must be set
 * explicitly — it is NOT inferred from the `rediss://` scheme the way it is when
 * ioredis is built from a URL string. Without this, a `rediss://` Upstash
 * endpoint is dialled over plaintext and the connection is reset.
 */
export function buildBullConnection(url: string): RedisOptions {
  const u = new URL(url);
  const isTls = u.protocol === 'rediss:';
  return {
    host: u.hostname,
    port: Number(u.port) || 6379,
    ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
    ...(u.pathname && u.pathname !== '/' ? { db: Number(u.pathname.slice(1)) } : {}),
    ...(isTls ? { tls: {} } : {}),
    ...RESILIENT_REDIS_OPTIONS,
  };
}
