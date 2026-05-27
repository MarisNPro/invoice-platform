import { Controller, Post, HttpCode, HttpStatus, Logger } from '@nestjs/common';
import { CompanySyncService } from './company-sync.service';

/**
 * Admin endpoints to trigger bulk registry syncs.
 * No @Public() → requires a valid JWT (default guard behaviour).
 *
 *   POST /api/v1/companies/sync/lv   — stream Latvia UR CSV → companies_lv
 *   POST /api/v1/companies/sync/lt   — paginate LT UAPI    → companies_lt
 */
@Controller('companies/sync')
export class CompanySyncController {
  private readonly logger = new Logger(CompanySyncController.name);

  constructor(private readonly sync: CompanySyncService) {}

  @Post('lv')
  @HttpCode(HttpStatus.OK)
  async syncLv() {
    this.logger.log('Manual LV sync triggered');
    const result = await this.sync.syncLatvia();
    return { country: 'LV', ...result };
  }

  @Post('lt')
  @HttpCode(HttpStatus.OK)
  async syncLt() {
    this.logger.log('Manual LT sync triggered');
    const result = await this.sync.syncLithuania();
    return { country: 'LT', ...result };
  }
}
