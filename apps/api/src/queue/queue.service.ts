import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { QUEUE_INVOICE_EMAIL } from './queue.constants';
import type { SendInvoiceEmailJobData } from './queue.constants';
import { buildBullConnection } from '../common/redis/redis-connection';

@Injectable()
export class MailQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(MailQueueService.name);
  private readonly queue: Queue<SendInvoiceEmailJobData>;

  constructor(config: ConfigService) {
    const url = config.get<string>('REDIS_URL', 'redis://localhost:6379');
    this.queue = new Queue(QUEUE_INVOICE_EMAIL, {
      connection: buildBullConnection(url),
      defaultJobOptions: {
        attempts: 3,
        backoff:  { type: 'exponential', delay: 5_000 },
        removeOnComplete: { count: 100 },
        removeOnFail:     { count: 500 },
      },
    });

    // Never let a Redis connection error become an unhandled EventEmitter
    // 'error' (which would crash the process). Connection is lazy/background;
    // the API must boot and serve traffic even when Redis is unreachable.
    this.queue.on('error', (err) =>
      this.logger.error(`Queue "${QUEUE_INVOICE_EMAIL}" Redis error: ${err.message}`),
    );

    this.logger.log(`Queue "${QUEUE_INVOICE_EMAIL}" initialised (connecting in background)`);
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
