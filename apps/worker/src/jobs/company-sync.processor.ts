import type { Job, Processor } from 'bullmq';
import { Logger } from '../logger';
import { prisma } from '../prisma';
import { syncLatvia, syncLithuania } from '@invoice/company-sync';
import type { CompanySyncJobData } from './job.constants';

const logger = new Logger('CompanySyncProcessor');

/**
 * Nightly LV/LT registry sync. Delegates to the shared @invoice/company-sync
 * package (CSV → Postgres company_registry, pg_trgm) — same code path as the
 * API CLI. No Elasticsearch.
 */
export const companySyncProcessor: Processor<CompanySyncJobData> = async (
  job: Job<CompanySyncJobData>,
) => {
  const { country } = job.data;
  logger.log(`[${job.name}] starting ${country} registry sync`);
  await job.updateProgress(5);

  const result =
    country === 'LV'
      ? await syncLatvia(prisma, logger)
      : await syncLithuania(prisma, logger);

  await job.updateProgress(100);
  logger.log(`[${job.name}] ${country} done — indexed: ${result.indexed}, skipped: ${result.skipped}`);

  return result;
};
