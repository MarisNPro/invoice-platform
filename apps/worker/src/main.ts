import 'dotenv/config';
import { Logger } from './logger';
import { Worker, Queue } from 'bullmq';
import { companySyncProcessor } from './jobs/company-sync.processor';
import { QUEUE_COMPANY_SYNC, JobName } from './jobs/job.constants';

const logger = new Logger('Worker');

const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
const CONCURRENCY = Number(process.env['WORKER_CONCURRENCY'] ?? 5);

/** Parse redis://[[user]:pass@]host[:port][/db] into BullMQ connection options */
function parseRedisUrl(url: string) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port) || 6379,
    ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
    ...(u.pathname && u.pathname !== '/' ? { db: Number(u.pathname.slice(1)) } : {}),
  };
}

const connection = parseRedisUrl(REDIS_URL);

async function main() {
  logger.log('starting…');

  const queue = new Queue(QUEUE_COMPANY_SYNC, { connection });

  // Register nightly sync repeatable jobs if they don't exist yet
  await registerRepeatableJobs(queue);

  const worker = new Worker(
    QUEUE_COMPANY_SYNC,
    companySyncProcessor,
    {
      connection,
      concurrency: CONCURRENCY,
      removeOnComplete: { count: 100 },
      removeOnFail:     { count: 500 },
    },
  );

  worker.on('completed', (job) => {
    logger.log(`✓ ${job.name} (${job.id}) completed`);
  });

  worker.on('failed', (job, err) => {
    logger.error(`✗ ${job?.name} (${job?.id}) failed: ${err.message}`);
  });

  worker.on('error', (err) => {
    logger.error(`worker error: ${err.message}`);
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.log(`${signal} received, shutting down…`);
    await worker.close();
    await queue.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('SIGINT',  () => { void shutdown('SIGINT'); });

  logger.log(`ready (concurrency=${CONCURRENCY})`);
}

async function registerRepeatableJobs(queue: Queue) {
  const existing     = await queue.getRepeatableJobs();
  const existingNames = new Set(existing.map((j) => j.name));

  // Latvia UR — nightly 02:00 UTC
  if (!existingNames.has(JobName.SYNC_LV)) {
    await queue.add(
      JobName.SYNC_LV,
      { country: 'LV' },
      { repeat: { pattern: '0 2 * * *' } },
    );
    logger.log(`registered repeatable job: ${JobName.SYNC_LV}`);
  }

  // Lithuania RC — nightly 03:00 UTC
  if (!existingNames.has(JobName.SYNC_LT)) {
    await queue.add(
      JobName.SYNC_LT,
      { country: 'LT' },
      { repeat: { pattern: '0 3 * * *' } },
    );
    logger.log(`registered repeatable job: ${JobName.SYNC_LT}`);
  }
}

main().catch((err: unknown) => {
  logger.fatal(`fatal: ${String(err)}`);
  process.exit(1);
});
