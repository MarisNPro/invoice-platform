import { config as dotenvConfig } from 'dotenv';
import { resolve } from 'path';
// Load root .env (worker cwd = apps/worker, root = ../../)
dotenvConfig({ path: resolve(process.cwd(), '../../.env') });
import { Logger } from './logger';
import { Worker, Queue } from 'bullmq';
import { companySyncProcessor } from './jobs/company-sync.processor';
import {
  sendInvoiceEmailProcessor,
  handlePermanentEmailFailure,
} from './jobs/send-invoice-email.job';
import {
  QUEUE_COMPANY_SYNC,
  QUEUE_INVOICE_EMAIL,
  JobName,
} from './jobs/job.constants';
import type { SendInvoiceEmailJobData } from './jobs/job.constants';

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

  // ── Company sync queue ────────────────────────────────────────────────────
  const syncQueue = new Queue(QUEUE_COMPANY_SYNC, { connection });
  await registerRepeatableJobs(syncQueue);

  const syncWorker = new Worker(
    QUEUE_COMPANY_SYNC,
    companySyncProcessor,
    { connection, concurrency: CONCURRENCY, removeOnComplete: { count: 100 }, removeOnFail: { count: 500 } },
  );

  syncWorker.on('completed', (job) => logger.log(`✓ ${job.name} (${job.id}) completed`));
  syncWorker.on('failed',    (job, err) => logger.error(`✗ ${job?.name} (${job?.id}) failed: ${err.message}`));
  syncWorker.on('error',     (err) => logger.error(`sync worker error: ${err.message}`));

  // ── Invoice email queue ───────────────────────────────────────────────────
  const emailQueue = new Queue(QUEUE_INVOICE_EMAIL, { connection });

  const emailWorker = new Worker(
    QUEUE_INVOICE_EMAIL,
    sendInvoiceEmailProcessor,
    {
      connection,
      concurrency: CONCURRENCY,
      removeOnComplete: { count: 100 },
      removeOnFail:     { count: 500 },
    },
  );

  emailWorker.on('completed', (job) => logger.log(`✓ ${job.name} (${job.id}) email sent`));

  emailWorker.on('failed', (job, err) => {
    if (!job) return;
    logger.error(`✗ ${job.name} (${job.id}) attempt ${job.attemptsMade} failed: ${err.message}`);

    // Permanent failure — all retries exhausted
    const maxAttempts = (job.opts.attempts as number | undefined) ?? 1;
    if (job.attemptsMade >= maxAttempts) {
      void handlePermanentEmailFailure(
        job as Parameters<typeof handlePermanentEmailFailure>[0] & { data: SendInvoiceEmailJobData },
        err,
      );
    }
  });

  emailWorker.on('error', (err) => logger.error(`email worker error: ${err.message}`));

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    logger.log(`${signal} received, shutting down…`);
    await Promise.all([syncWorker.close(), emailWorker.close(), syncQueue.close(), emailQueue.close()]);
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
