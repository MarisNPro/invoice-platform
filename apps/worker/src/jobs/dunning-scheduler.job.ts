/**
 * DunningSchedulerJob — runs daily at 08:00 UTC.
 *
 * Finds all SENT/OVERDUE invoices whose due date has passed and that have not
 * received a DUNNING transmission in the last 7 days.  For each qualifying
 * invoice, generates a language-aware dunning message via the API, sends it
 * by email, and records the transmission + audit log.
 *
 * Note: the spec mentions status "ISSUED" which does not exist in the schema.
 * We treat that as "OVERDUE" — the nearest equivalent status.
 */

import type { Job, Processor } from 'bullmq';
import axios from 'axios';
import { Logger } from '../logger';
import { EmailService } from '../email/email.service';
import { prisma } from '../prisma';

const APP_BASE_URL = process.env['APP_BASE_URL'] ?? 'http://localhost:4000';
const NODE_ENV     = process.env['NODE_ENV']     ?? 'development';

const logger   = new Logger('DunningSchedulerJob');
const emailSvc = new EmailService();

export const dunningSchedulerProcessor: Processor = async (job: Job) => {
  const runAt      = new Date();
  const sevenDaysAgo = new Date(runAt.getTime() - 7 * 86_400_000);

  logger.log(`[${job.name}#${job.id}] scanning for overdue invoices without recent dunning…`);

  // ── 1. Find qualifying invoices ──────────────────────────────────────────────
  const invoices = await prisma.invoice.findMany({
    where: {
      status: { in: ['SENT', 'OVERDUE'] },
      dueAt:  { lt: runAt },
      transmissions: {
        none: {
          channel: 'DUNNING',
          sentAt:  { gt: sevenDaysAgo },
        },
      },
    },
    include: {
      buyer:  true,
      seller: true,
    },
  });

  logger.log(`[${job.name}] found ${invoices.length} overdue invoice(s) to dun`);

  let processed = 0;
  let skipped   = 0;
  let failed    = 0;

  // ── 2. Process each invoice ──────────────────────────────────────────────────
  for (const invoice of invoices) {
    const buyerEmail = invoice.buyer.email;

    if (!buyerEmail) {
      logger.warn(`[${job.name}] skipping ${invoice.number} — buyer has no email`);
      skipped++;
      continue;
    }

    const daysOverdue = Math.floor(
      (runAt.getTime() - new Date(invoice.dueAt).getTime()) / 86_400_000,
    );

    // Load buyer preferred language from invoice (BCP 47; fallback EN)
    const language = (invoice.language ?? 'en').toUpperCase();
    const tenantId = invoice.tenantId;

    const authHeaders: Record<string, string> =
      NODE_ENV !== 'production'
        ? { 'x-dev-tenant-id': tenantId }
        : { Authorization: `Bearer ${process.env['WORKER_SERVICE_TOKEN'] ?? ''}` };

    try {
      // ── Generate dunning message via AiService ─────────────────────────────
      const dunningRes = await axios.post<{
        subject:  string;
        body:     string;
        tone:     string;
        daysOverdue: number;
      }>(
        `${APP_BASE_URL}/api/v1/invoices/${invoice.id}/dunning-message`,
        { language, channel: 'email' },
        { headers: authHeaders, timeout: 30_000 },
      );

      const { subject, body, tone } = dunningRes.data;

      // ── Send dunning email ─────────────────────────────────────────────────
      const { messageId } = await emailSvc.sendDunningEmail({
        invoiceId: invoice.id,
        tenantId,
        to:        buyerEmail,
        subject,
        body,
      });

      // ── Create InvoiceTransmission record ──────────────────────────────────
      await prisma.invoiceTransmission.create({
        data: {
          invoiceId:         invoice.id,
          channel:           'DUNNING',
          status:            'SENT',
          recipientEndpoint: buyerEmail,
          providerMessageId: messageId,
          sentAt:            new Date(),
        },
      });

      // ── Write AuditLog ─────────────────────────────────────────────────────
      await prisma.auditLog.create({
        data: {
          tenantId,
          invoiceId: invoice.id,
          action:    'invoice.dunning.sent',
          payload:   { to: buyerEmail, daysOverdue, language, tone },
        },
      });

      processed++;
      logger.log(
        `[${job.name}] ✓ ${invoice.number} → ${buyerEmail} (${daysOverdue}d overdue, tone=${tone})`,
      );
    } catch (err: unknown) {
      failed++;
      logger.error(
        `[${job.name}] ✗ ${invoice.number}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ── 3. Summary ───────────────────────────────────────────────────────────────
  const summary =
    `Dunning scheduler: ${processed} invoices processed` +
    (skipped > 0 ? `, ${skipped} skipped (no email)` : '') +
    (failed  > 0 ? `, ${failed} failed` : '');

  logger.log(`[${job.name}] ${summary}`);
  return { processed, skipped, failed, summary };
};
