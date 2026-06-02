import { Injectable, Logger } from '@nestjs/common';
import { syncLatvia, syncLithuania, type SyncResult } from '@invoice/company-sync';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Thin wrapper over the shared @invoice/company-sync package so the API CLI
 * (sync-runner) and the BullMQ worker run the exact same LV/LT registry sync
 * (CSV → Postgres company_registry, pg_trgm).
 */
@Injectable()
export class CompanySyncService {
  private readonly logger = new Logger(CompanySyncService.name);

  constructor(private readonly prisma: PrismaService) {}

  syncLatvia(): Promise<SyncResult> {
    return syncLatvia(this.prisma, this.logger);
  }

  syncLithuania(): Promise<SyncResult> {
    return syncLithuania(this.prisma, this.logger);
  }
}
