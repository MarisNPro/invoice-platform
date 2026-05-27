import { Controller, Get, Query, ParseIntPipe, DefaultValuePipe } from '@nestjs/common';
import { CompanyService } from './company.service';
import { Public } from '../auth/public.decorator';
import type { CountryCode } from './company.types';

@Controller('companies')
export class CompanyController {
  constructor(private readonly companies: CompanyService) {}

  /**
   * GET /api/v1/companies/search?q=Nokia&country=FI&limit=10
   *
   * Searches Finnish PRH BIS v1, Estonian Äriregister autocomplete v1,
   * or returns [] for LV/LT (Elasticsearch not yet indexed).
   * Omit `country` to fan out across FI + EE.
   * Results cached in Redis for 600 s under key companies:{country}:{q}.
   */
  @Public()
  @Get('search')
  search(
    @Query('q')                                          q:       string,
    @Query('country')                                    country?: CountryCode,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit = 10,
  ) {
    return this.companies.searchCompanies(q ?? '', country, limit);
  }
}
