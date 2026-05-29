/**
 * RecurringInvoiceJob — runs daily at 07:00 UTC.
 *
 * Finds all active recurring invoice schedules whose nextRunAt <= now,
 * creates an invoice via the API for each, optionally auto-sends it,
 * then advances nextRunAt by intervalDays.
 */

import type { Job, Processor } from 'bullmq';
import axios from 'axios';
import { Logger } from '../logger';
import { prisma } from '../prisma';

const APP_BASE_URL = process.env['APP_BASE_URL'] ?? 'http://localhost:4000';
const NODE_ENV     = process.env['NODE_ENV']     ?? 'development';

const logger = new Logger('RecurringInvoiceJob');

export const recurringInvoiceProcessor: Processor = async (job: Job) => {
  const now = new Date();
  logger.log(`[${job.name}#${job.id}] scanning for due recurring invoices…`);

  // 1. Find all active recurring invoices due to run
  const dueList = await prisma.recurringInvoice.findMany({
    where: {
      isActive:  true,
      nextRunAt: { lte: now },
    },
  });

  logger.log(`[${job.name}] found ${dueList.length} recurring invoice(s) to process`);

  let created = 0;
  let failed  = 0;

  for (const ri of dueList) {
    const authHeaders: Record<string, string> =
      NODE_ENV !== 'production'
        ? { 'x-dev-tenant-id': ri.tenantId }
        : { Authorization: `Bearer ${process.env['WORKER_SERVICE_TOKEN'] ?? ''}` };

    try {
      const issueDate = now.toISOString().slice(0, 10);
      // Default payment terms: 30 days from issue
      const dueDate = new Date(now.getTime() + 30 * 86_400_000).toISOString().slice(0, 10);

      // 2. Create invoice via API
      const invoiceRes = await axios.post<{ id: string; number: string }>(
        `${APP_BASE_URL}/api/v1/invoices`,
        {
          customerId: ri.customerId,
          currency:   ri.currency,
          language:   ri.language,
          issueDate,
          dueDate,
          lines:      ri.templateLines,
          note:       ri.description ?? undefined,
        },
        { headers: { ...authHeaders, 'Content-Type': 'application/json' }, timeout: 30_000 },
      );

      const invoice = invoiceRes.data;

      // 3. Auto-send if configured
      if (ri.autoSend) {
        await axios.post(
          `${APP_BASE_URL}/api/v1/invoices/${invoice.id}/send`,
          { channel: 'email' },
          { headers: { ...authHeaders, 'Content-Type': 'application/json' }, timeout: 10_000 },
        );
      }

      // 4. Advance schedule: lastRunAt = now, nextRunAt = now + intervalDays
      const nextRunAt = new Date(now.getTime() + ri.intervalDays * 86_400_000);
      await prisma.recurringInvoice.update({
        where: { id: ri.id },
        data:  { lastRunAt: now, nextRunAt },
      });

      // 5. AuditLog
      await prisma.auditLog.create({
        data: {
          tenantId:  ri.tenantId,
          invoiceId: invoice.id,
          action:    'RECURRING_INVOICE_CREATED',
          payload:   {
            recurringInvoiceId: ri.id,
            invoiceNumber:      invoice.number,
            nextRunAt:          nextRunAt.toISOString(),
            autoSend:           ri.autoSend,
          },
        },
      });

      created++;
      logger.log(
        `[${job.name}] ✓ ${invoice.number} created from template ${ri.id} | next=${nextRunAt.toISOString()}`,
      );
    } catch (err: unknown) {
      failed++;
      logger.error(
        `[${job.name}] ✗ recurring ${ri.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const summary = `Recurring invoices: ${created} created` +
    (failed > 0 ? `, ${failed} failed` : '');
  logger.log(`[${job.name}] ${summary}`);
  return { created, failed, total: dueList.length, summary };
};
