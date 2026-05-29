import { Module } from '@nestjs/common';
import { RecurringInvoiceController } from './recurring-invoice.controller';
import { RecurringInvoiceService } from './recurring-invoice.service';

@Module({
  controllers: [RecurringInvoiceController],
  providers:   [RecurringInvoiceService],
  exports:     [RecurringInvoiceService],
})
export class RecurringInvoiceModule {}
