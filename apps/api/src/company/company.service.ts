import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { ElasticsearchService } from '../common/elasticsearch/elasticsearch.service';
import { InjectRedis } from '../common/redis/redis.decorators';
import type Redis from 'ioredis';
import { firstValueFrom } from 'rxjs';
import type {
  CompanyResult,
  CompanyDocument,
  CountryCode,
  PrhV3Response,
  AriregisterAutocompleteResponse,
} from './company.types';

const CACHE_TTL = 600; // seconds

export const INDEX_LV = 'companies_lv';
export const INDEX_LT = 'companies_lt';

@Injectable()
export class CompanyService {
  private readonly logger = new Logger(CompanyService.name);
  private readonly prhUrl:  string;
  private readonly ariUrl:  string;

  constructor(
    private readonly http:   HttpService,
    private readonly config: ConfigService,
    private readonly es:     ElasticsearchService,
    @InjectRedis() private readonly redis: Redis,
  ) {
    this.prhUrl = config.get<string>('PRH_API_URL',         'https://avoindata.prh.fi/opendata-ytj-api/v3');
    this.ariUrl = config.get<string>('ARIREGISTER_API_URL', 'https://ariregister.rik.ee');
  }

  // ── Public entrypoint ─────────────────────────────────────────────────────

  async searchCompanies(
    query:    string,
    country?: CountryCode,
    limit     = 10,
  ): Promise<CompanyResult[]> {
    if (!query || query.trim().length < 2) return [];

    switch (country) {
      case 'FI': return this.searchFinland(query, limit);
      case 'EE': return this.searchEstonia(query, limit);
      case 'LV': return this.searchElasticsearch(INDEX_LV, 'LV', query, limit);
      case 'LT': return this.searchElasticsearch(INDEX_LT, 'LT', query, limit);
      default: {
        const [fi, ee, lv, lt] = await Promise.allSettled([
          this.searchFinland(query, limit),
          this.searchEstonia(query, limit),
          this.searchElasticsearch(INDEX_LV, 'LV', query, limit),
          this.searchElasticsearch(INDEX_LT, 'LT', query, limit),
        ]);
        return [
          ...(fi.status === 'fulfilled' ? fi.value : []),
          ...(ee.status === 'fulfilled' ? ee.value : []),
          ...(lv.status === 'fulfilled' ? lv.value : []),
          ...(lt.status === 'fulfilled' ? lt.value : []),
        ];
      }
    }
  }

  // ── Finland — PRH YTJ v3 ──────────────────────────────────────────────────

  private async searchFinland(query: string, limit: number): Promise<CompanyResult[]> {
    const cacheKey = `companies:FI:${query.toLowerCase()}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as CompanyResult[];

    try {
      const { data } = await firstValueFrom(
        this.http.get<PrhV3Response>(`${this.prhUrl}/companies`, {
          params:  { name: query, maxResults: limit },
          timeout: 8_000,
        }),
      );

      const results = (data.companies ?? []).map<CompanyResult>((c) => {
        const currentName = (c.names ?? [])
          .filter((n) => n.type === '1' && !n.endDate)
          .sort((a, b) => (b.registrationDate ?? '').localeCompare(a.registrationDate ?? ''))
          .at(0) ?? c.names?.[0];

        const activeForm = (c.companyForms ?? []).find((f) => !f.endDate) ?? c.companyForms?.[0];
        const legalForm  = activeForm?.descriptions.find((d) => d.languageCode === '3')?.description;

        const addr = (c.addresses ?? []).filter((a) => !a.endDate).sort((a, b) => a.type - b.type).at(0);
        const city = addr?.postOffices?.find((p) => p.languageCode === '1')?.city ?? addr?.postOffices?.[0]?.city;
        const addressStr = [addr?.street, addr?.postCode, city].filter(Boolean).join(', ') || undefined;

        return {
          id:        c.businessId.value,
          country:   'FI',
          name:      currentName?.name ?? '',
          regNumber: c.businessId.value,
          legalForm,
          address:   addressStr,
          status:    c.endDate ? 'INACTIVE' : 'ACTIVE',
          source:    'PRH',
        };
      });

      await this.redis.setex(cacheKey, CACHE_TTL, JSON.stringify(results));
      return results;
    } catch (err) {
      this.logger.warn(`PRH search failed for "${query}": ${(err as Error).message}`);
      return [];
    }
  }

  // ── Estonia — Äriregister autocomplete ───────────────────────────────────

  private async searchEstonia(query: string, limit: number): Promise<CompanyResult[]> {
    const cacheKey = `companies:EE:${query.toLowerCase()}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as CompanyResult[];

    try {
      const { data } = await firstValueFrom(
        this.http.get<AriregisterAutocompleteResponse>(`${this.ariUrl}/est/api/autocomplete`, {
          params:  { q: query, limit },
          timeout: 8_000,
        }),
      );

      const items = data?.data ?? [];
      const results = items.map<CompanyResult>((c) => ({
        id:        `EE-${c.reg_code}`,
        country:   'EE',
        name:      c.name,
        regNumber: String(c.reg_code),
        vatNumber: `EE${c.reg_code}`,
        legalForm: '',
        address:   c.legal_address ?? undefined,
        status:    c.status === 'R' ? 'active' : 'inactive',
        source:    'ariregister.rik.ee',
      }));

      await this.redis.setex(cacheKey, CACHE_TTL, JSON.stringify(results));
      return results;
    } catch (err) {
      this.logger.warn(`Äriregister search failed for "${query}": ${(err as Error).message}`);
      return [];
    }
  }

  // ── Latvia / Lithuania — Elasticsearch ───────────────────────────────────

  async searchElasticsearch(
    index:   string,
    country: string,
    query:   string,
    limit:   number,
  ): Promise<CompanyResult[]> {
    const cacheKey = `companies:${country}:${query.toLowerCase()}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as CompanyResult[];

    try {
      const indexExists = await this.es.indexExists(index);
      if (!indexExists) return [];

      const response = await this.es.search<CompanyDocument>({
        index,
        size: limit,
        query: {
          match: {
            name: {
              query,
              analyzer: 'name_search_analyzer',
            },
          },
        },
        sort: [{ _score: { order: 'desc' } }],
      });

      const results = response.hits.hits
        .filter((h) => h._source)
        .map<CompanyResult>((h) => h._source as CompanyResult);

      await this.redis.setex(cacheKey, CACHE_TTL, JSON.stringify(results));
      return results;
    } catch (err) {
      this.logger.warn(`ES search [${index}] failed for "${query}": ${(err as Error).message}`);
      return [];
    }
  }
}
