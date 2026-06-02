import { Logger } from '@nestjs/common';
import type { RedisOptions } from 'ioredis';

const logger = new Logger('RedisConnection');

/**
 * Backoff used by every Redis connection in the API. Reconnect forever with a
 * capped linear backoff so a transient Upstash reset never gives up permanently.
 */
function retryStrategy(times: number): number {
  const delay = Math.min(times * 200, 5_000);
  logger.warn(`Redis reconnect attempt #${times}, retrying in ${delay}ms`);
  return delay;
}

/**
 * Shared ioredis options that make a connection tolerant of Upstash/BullMQ:
 *
 * - `maxRetriesPerRequest: null` — required by BullMQ and prevents a transient
 *   ECONNRESET from throwing MaxRetriesPerRequestError (which, unhandled on a
 *   Queue's EventEmitter, would crash the process at startup).
 * - `enableReadyCheck: false` — Upstash does not support the INFO-based ready
 *   check used by ioredis; skip it.
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
 * BullMQ takes a plain options object (not a URL string), so TLS must be set
 * explicitly — it is NOT inferred from the `rediss://` scheme the way it is when
 * ioredis is constructed from a URL string. Without this, a `rediss://` Upstash
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
