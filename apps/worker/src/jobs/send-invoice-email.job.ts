import type { Job, Processor } from 'bullmq';
import { Queue } from 'bullmq';
import nodemailer from 'nodemailer';
import { Logger } from '../logger';
import { EmailService } from '../email/email.service';
import { prisma } from '../prisma';
import { QUEUE_CLOUD_ARCHIVE_SYNC, JobName } from './job.constants';
import type { SendInvoiceEmailJobData } from './job.constants';

// Module-level archive sync queue — created once, reused across jobs
function parseRedisUrl(url: string) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port) || 6379,
    ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
    ...(u.pathname && u.pathname !== '/' ? { db: Number(u.pathname.slice(1)) } : {}),
  };
}
const archiveSyncQueue = new Queue(QUEUE_CLOUD_ARCHIVE_SYNC, {
  connection: parseRedisUrl(process.env['REDIS_URL'] ?? 'redis://localhost:6379'),
});

const logger      = new Logger('SendInvoiceEmailJob');
const emailSvc    = new EmailService();

export const sendInvoiceEmailProcessor: Processor<SendInvoiceEmailJobData> = async (
  job: Job<SendInvoiceEmailJobData>,
) => {
  const { invoiceId, recipientEmail, language, tenantId, transmissionId } = job.data;

  logger.log(
    `[${job.name}#${job.id}] sending invoice ${invoiceId} → ${recipientEmail} (attempt ${job.attemptsMade + 1})`,
  );

  await job.updateProgress(10);

  const { messageId } = await emailSvc.sendInvoice({
    invoiceId,
    recipientEmail,
    language,
    tenantId,
    transmissionId,
  });

  await job.updateProgress(100);

  // Enqueue archive sync — fires after invoice is marked SENT
  await archiveSyncQueue.add(JobName.ARCHIVE_SYNC, { invoiceId, tenantId }).catch(
    (err: unknown) => logger.warn(`Archive sync enqueue failed (non-fatal): ${String(err)}`),
  );

  logger.log(`[${job.name}#${job.id}] done — messageId=${messageId}`);
  return { messageId };
};

// ── Permanent-failure handler (called from main.ts worker.on('failed')) ────────

export async function handlePermanentEmailFailure(
  job: Job<SendInvoiceEmailJobData>,
  err: Error,
): Promise<void> {
  const { invoiceId, recipientEmail, tenantId, transmissionId } = job.data;

  logger.error(
    `[${job.name}#${job.id}] PERMANENT FAILURE after ${job.attemptsMade} attempts: ${err.message}`,
  );

  // Mark transmission as FAILED
  await prisma.invoiceTransmission.update({
    where: { id: transmissionId },
    data: {
      status:       'FAILED',
      failedAt:     new Date(),
      errorMessage: err.message,
    },
  });

  // Write AuditLog
  await prisma.auditLog.create({
    data: {
      tenantId,
      invoiceId,
      action:  'invoice.email.failed',
      payload: { to: recipientEmail, error: err.message, attempts: job.attemptsMade },
    },
  });

  // Send failure notification email to org admin (best-effort)
  await notifyOrgAdmin({ tenantId, invoiceId, recipientEmail, err });
}

async function notifyOrgAdmin(opts: {
  tenantId:       string;
  invoiceId:      string;
  recipientEmail: string;
  err:            Error;
}): Promise<void> {
  const { tenantId, invoiceId, recipientEmail, err } = opts;

  const tenant = await prisma.tenant.findUnique({
    where:   { id: tenantId },
    include: { users: { where: { role: 'ADMIN' }, take: 1 } },
  });

  const adminEmail = tenant?.users[0]?.email;
  if (!adminEmail) {
    logger.warn(`No admin user for tenant ${tenantId} — skipping failure notification`);
    return;
  }

  const smtpHost = process.env['SMTP_HOST'] ?? 'localhost';
  const smtpPort = Number(process.env['SMTP_PORT'] ?? 1025);
  const fromAddr = process.env['EMAIL_FROM'] ?? 'invoices@invoiceplatform.local';

  const transporter = nodemailer.createTransport({ host: smtpHost, port: smtpPort, secure: false });

  await transporter
    .sendMail({
      from:    fromAddr,
      to:      adminEmail,
      subject: `[InvoicePlatform] Failed to send invoice ${invoiceId}`,
      text: [
        `Invoice delivery permanently failed.`,
        ``,
        `Invoice ID  : ${invoiceId}`,
        `Recipient   : ${recipientEmail}`,
        `Error       : ${err.message}`,
        ``,
        `Please log in to InvoicePlatform to retry or contact support.`,
      ].join('\n'),
    })
    .catch((e: unknown) => {
      logger.warn(`Could not send failure notification to ${adminEmail}: ${String(e)}`);
    });

  logger.log(`Failure notification dispatched → ${adminEmail}`);
}
