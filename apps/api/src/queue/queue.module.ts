import { Module } from '@nestjs/common';
import { MailQueueService } from './queue.service';

@Module({
  providers: [MailQueueService],
  exports:   [MailQueueService],
})
export class QueueModule {}
