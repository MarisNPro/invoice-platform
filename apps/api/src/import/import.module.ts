import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { InvoiceModule } from '../invoice/invoice.module';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';

@Module({
  imports:     [AiModule, InvoiceModule],
  controllers: [ImportController],
  providers:   [ImportService],
})
export class ImportModule {}
