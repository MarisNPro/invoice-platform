import { Module } from '@nestjs/common';
import { InvoiceService } from './invoice.service';
import { InvoiceController } from './invoice.controller';
import { InvoicePdfService } from './invoice-pdf.service';
import { InvoiceUblService } from './invoice-ubl.service';
import { AiModule } from '../ai/ai.module';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [AiModule, QueueModule],
  controllers: [InvoiceController],
  providers: [InvoiceService, InvoicePdfService, InvoiceUblService],
  exports: [InvoiceService, InvoicePdfService, InvoiceUblService],
})
export class InvoiceModule {}
