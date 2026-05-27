import 'dotenv/config';
import { Worker, Queue } from 'bullmq';
import { companySyncProcessor } from './jobs/company-sync.processor';
import { QUEUE_COMPANY_SYNC, JobName } from './jobs/job.constants';

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
  console.log('[worker] starting…');

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
      removeOnFail: { count: 500 },
    },
  );

  worker.on('completed', (job) => {
    console.log(`[worker] ✓ ${job.name} (${job.id}) completed`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[worker] ✗ ${job?.name} (${job?.id}) failed:`, err.message);
  });

  worker.on('error', (err) => {
    console.error('[worker] worker error:', err);
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`[worker] ${signal} received, shutting down…`);
    await worker.close();
    await queue.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('SIGINT',  () => { void shutdown('SIGINT'); });

  console.log(`[worker] ready (concurrency=${CONCURRENCY})`);
}

async function registerRepeatableJobs(queue: Queue) {
  const existing = await queue.getRepeatableJobs();
  const existingNames = new Set(existing.map((j) => j.name));

  // Latvia UR — nightly 02:00 UTC
  if (!existingNames.has(JobName.SYNC_LV)) {
    await queue.add(
      JobName.SYNC_LV,
      { country: 'LV' },
      { repeat: { pattern: '0 2 * * *' } },
    );
    console.log(`[worker] registered repeatable job: ${JobName.SYNC_LV}`);
  }

  // Lithuania RC — nightly 03:00 UTC
  if (!existingNames.has(JobName.SYNC_LT)) {
    await queue.add(
      JobName.SYNC_LT,
      { country: 'LT' },
      { repeat: { pattern: '0 3 * * *' } },
    );
    console.log(`[worker] registered repeatable job: ${JobName.SYNC_LT}`);
  }
}

main().catch((err) => {
  console.error('[worker] fatal:', err);
  process.exit(1);
});
