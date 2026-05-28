import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { QUEUE_INVOICE_EMAIL } from './queue.constants';
import type { SendInvoiceEmailJobData } from './queue.constants';

function parseRedisUrl(url: string) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port) || 6379,
    ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
    ...(u.pathname && u.pathname !== '/' ? { db: Number(u.pathname.slice(1)) } : {}),
  };
}

@Injectable()
export class MailQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(MailQueueService.name);
  private readonly queue: Queue<SendInvoiceEmailJobData>;

  constructor(config: ConfigService) {
    const url = config.get<string>('REDIS_URL', 'redis://localhost:6379');
    this.queue = new Queue(QUEUE_INVOICE_EMAIL, {
      connection: parseRedisUrl(url),
      defaultJobOptions: {
        attempts: 3,
        backoff:  { type: 'exponential', delay: 5_000 },
        removeOnComplete: { count: 100 },
        removeOnFail:     { count: 500 },
      },
    });
    this.logger.log(`Queue "${QUEUE_INVOICE_EMAIL}" connected`);
  }

  async enqueueInvoiceEmail(data: SendInvoiceEmailJobData): Promise<string> {
    const job = await this.queue.add('send-invoice-email', data);
    this.logger.log(`Enqueued job ${job.id} for invoice ${data.invoiceId} → ${data.recipientEmail}`);
    return job.id ?? '';
  }

  async onModuleDestroy() {
    await this.queue.close();
  }
}
