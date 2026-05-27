import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { CompanyService } from './company.service';
import { CompanyController } from './company.controller';
import { CompanySyncService } from './company-sync.service';
import { CompanySyncController } from './company-sync.controller';

@Module({
  imports: [HttpModule],
  controllers: [CompanyController, CompanySyncController],
  providers: [CompanyService, CompanySyncService],
  exports: [CompanyService],
})
export class CompanyModule {}
