import { Controller, Get, Query } from '@nestjs/common';
import { CompanyService } from './company.service';
import type { CountryCode } from './company.types';

@Controller('companies')
export class CompanyController {
  constructor(private readonly companies: CompanyService) {}

  /**
   * GET /api/v1/companies/search?q=Acme&country=FI
   *
   * Searches Finnish PRH, Estonian Äriregister, or Elasticsearch (LV/LT).
   * Omit `country` to fan out across all sources.
   */
  @Get('search')
  search(
    @Query('q') q: string,
    @Query('country') country?: CountryCode,
  ) {
    return this.companies.search(q ?? '', country);
  }
}
