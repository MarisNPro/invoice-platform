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
import { resetMonthlyCountersProcessor } from './jobs/reset-monthly-counters.job';
import { dunningSchedulerProcessor }     from './jobs/dunning-scheduler.job';
import { recurringInvoiceProcessor }     from './jobs/recurring-invoice.job';
import {
  QUEUE_COMPANY_SYNC,
  QUEUE_INVOICE_EMAIL,
  QUEUE_MONTHLY_RESET,
  QUEUE_DUNNING_SCHEDULER,
  QUEUE_CLOUD_ARCHIVE_SYNC,
  QUEUE_RECURRING_INVOICE,
  JobName,
} from './jobs/job.constants';
import { archiveSyncProcessor }           from './jobs/archive-sync.job';
import type { SendInvoiceEmailJobData } from './jobs/job.constants';
import { buildBullConnection } from './redis-connection';

const logger = new Logger('Worker');

const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
const CONCURRENCY = Number(process.env['WORKER_CONCURRENCY'] ?? 5);

// TLS for rediss:// + BullMQ-required maxRetriesPerRequest:null + Upstash-safe
// ready check + reconnect backoff. See ./redis-connection.
const connection = buildBullConnection(REDIS_URL);

async function main() {
  logger.log('starting…');

  // ── Company sync queue (LV/LT registry → Postgres company_registry) ───────
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

  // ── Monthly AI spend reset queue (1st of every month, 00:00 UTC) ─────────
  const resetQueue = new Queue(QUEUE_MONTHLY_RESET, { connection });
  await registerResetJob(resetQueue);

  const resetWorker = new Worker(
    QUEUE_MONTHLY_RESET,
    resetMonthlyCountersProcessor,
    { connection, concurrency: 1, removeOnComplete: { count: 12 }, removeOnFail: { count: 12 } },
  );

  resetWorker.on('completed', (job) => logger.log(`✓ ${job.name} (${job.id}) reset done`));
  resetWorker.on('failed',    (job, err) => logger.error(`✗ ${job?.name} reset failed: ${err.message}`));
  resetWorker.on('error',     (err) => logger.error(`reset worker error: ${err.message}`));

  // ── Dunning scheduler queue (daily 08:00 UTC) ─────────────────────────────
  const dunningQueue = new Queue(QUEUE_DUNNING_SCHEDULER, { connection });
  await registerDunningJob(dunningQueue);

  const dunningWorker = new Worker(
    QUEUE_DUNNING_SCHEDULER,
    dunningSchedulerProcessor,
    { connection, concurrency: 1, removeOnComplete: { count: 30 }, removeOnFail: { count: 30 } },
  );

  dunningWorker.on('completed', (job) =>
    logger.log(`✓ ${job.name} (${job.id}) dunning run done`));
  dunningWorker.on('failed', (job, err) =>
    logger.error(`✗ ${job?.name} dunning failed: ${err.message}`));
  dunningWorker.on('error', (err) =>
    logger.error(`dunning worker error: ${err.message}`));

  // ── Cloud archive sync queue ──────────────────────────────────────────────
  const archiveQueue  = new Queue(QUEUE_CLOUD_ARCHIVE_SYNC, { connection });
  const archiveWorker = new Worker(
    QUEUE_CLOUD_ARCHIVE_SYNC,
    archiveSyncProcessor,
    { connection, concurrency: 2, removeOnComplete: { count: 200 }, removeOnFail: { count: 100 } },
  );

  archiveWorker.on('completed', (job) => logger.log(`✓ ${job.name} (${job.id}) archive synced`));
  archiveWorker.on('failed',    (job, err) => logger.error(`✗ ${job?.name} (${job?.id}) archive failed: ${err.message}`));
  archiveWorker.on('error',     (err) => logger.error(`archive worker error: ${err.message}`));

  // ── Recurring invoice scheduler (daily 07:00 UTC) ─────────────────────────
  const recurringQueue = new Queue(QUEUE_RECURRING_INVOICE, { connection });
  await registerRecurringJob(recurringQueue);

  const recurringWorker = new Worker(
    QUEUE_RECURRING_INVOICE,
    recurringInvoiceProcessor,
    { connection, concurrency: 1, removeOnComplete: { count: 30 }, removeOnFail: { count: 30 } },
  );

  recurringWorker.on('completed', (job) =>
    logger.log(`✓ ${job.name} (${job.id}) recurring invoices run done`));
  recurringWorker.on('failed', (job, err) =>
    logger.error(`✗ ${job?.name} recurring failed: ${err.message}`));
  recurringWorker.on('error', (err) =>
    logger.error(`recurring worker error: ${err.message}`));

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    logger.log(`${signal} received, shutting down…`);
    await Promise.all([
      syncWorker.close(),       emailWorker.close(),    resetWorker.close(),
      dunningWorker.close(),    archiveWorker.close(),  recurringWorker.close(),
      syncQueue.close(),        emailQueue.close(),     resetQueue.close(),
      dunningQueue.close(),     archiveQueue.close(),   recurringQueue.close(),
    ]);
    process.exit(0);
  };

  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('SIGINT',  () => { void shutdown('SIGINT'); });

  logger.log(`ready (concurrency=${CONCURRENCY})`);
}

async function registerDunningJob(queue: Queue) {
  const existing = await queue.getRepeatableJobs();
  if (existing.some((j) => j.name === JobName.DUNNING_SCHEDULER)) return;

  await queue.add(
    JobName.DUNNING_SCHEDULER,
    {},
    { repeat: { pattern: '0 8 * * *' } },  // daily 08:00 UTC
  );
  logger.log(`registered repeatable job: ${JobName.DUNNING_SCHEDULER}`);
}

async function registerResetJob(queue: Queue) {
  const existing = await queue.getRepeatableJobs();
  if (existing.some((j) => j.name === JobName.RESET_MONTHLY)) return;

  await queue.add(
    JobName.RESET_MONTHLY,
    {},
    { repeat: { pattern: '0 0 1 * *' } },  // midnight UTC on 1st of each month
  );
  logger.log(`registered repeatable job: ${JobName.RESET_MONTHLY}`);
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

async function registerRecurringJob(queue: Queue) {
  const existing = await queue.getRepeatableJobs();
  if (existing.some((j) => j.name === JobName.RECURRING_INVOICE)) return;

  await queue.add(
    JobName.RECURRING_INVOICE,
    {},
    { repeat: { pattern: '0 7 * * *' } },  // daily 07:00 UTC
  );
  logger.log(`registered repeatable job: ${JobName.RECURRING_INVOICE}`);
}

main().catch((err: unknown) => {
  logger.fatal(`fatal: ${String(err)}`);
  process.exit(1);
});
