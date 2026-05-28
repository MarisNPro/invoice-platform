import type { Job, Processor } from 'bullmq';
import { Logger } from '../logger';
import { prisma } from '../prisma';

const logger = new Logger('ResetMonthlyCountersJob');

export const resetMonthlyCountersProcessor: Processor = async (
  job: Job,
) => {
  logger.log(`[${job.name}#${job.id}] resetting monthly AI spend counters…`);

  const { count } = await prisma.tenant.updateMany({
    data: { monthlyAiSpendCents: 0 },
  });

  logger.log(`[${job.name}#${job.id}] reset ${count} tenant(s) — monthlyAiSpendCents → 0`);
  return { tenantsReset: count };
};
