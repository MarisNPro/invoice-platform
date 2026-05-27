import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { ElasticsearchService } from '../common/elasticsearch/elasticsearch.service';
import { InjectRedis } from '../common/redis/redis.decorators';
import type Redis from 'ioredis';
import { firstValueFrom } from 'rxjs';
import type {
  CompanyResult,
  CountryCode,
  PrhSearchResponse,
  AriregisterSuggestion,
  CompanyDocument,
} from './company.types';

@Injectable()
export class CompanyService {
  private readonly logger = new Logger(CompanyService.name);
  private readonly cacheTtl: number;
  private readonly prhUrl: string;
  private readonly ariUrl: string;
  private readonly esIndex: string;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
    private readonly es: ElasticsearchService,
    @InjectRedis() private readonly redis: Redis,
  ) {
    this.cacheTtl = config.get<number>('REDIS_TTL_SECONDS', 3600);
    this.prhUrl = config.get<string>('PRH_API_URL', 'https://avoindata.prh.fi/opendata-ytj-api/v3');
    this.ariUrl = config.get<string>('ARIREGISTER_API_URL', 'https://ariregister.rik.ee/api');
    this.esIndex = config.get<string>('ELASTICSEARCH_INDEX_COMPANIES', 'companies');
  }

  // ── Public search entrypoint ──────────────────────────────────────────────

  /**
   * Routes to the right data source based on country code.
   * Without a country, fans out across all sources in parallel.
   */
  async search(query: string, country?: CountryCode): Promise<CompanyResult[]> {
    if (!query || query.trim().length < 2) return [];

    switch (country) {
      case 'FI': return this.searchFinland(query);
      case 'EE': return this.searchEstonia(query);
      case 'LV': return this.searchElasticsearch(query, 'LV');
      case 'LT': return this.searchElasticsearch(query, 'LT');
      default: {
        const [fi, ee, lvlt] = await Promise.allSettled([
          this.searchFinland(query),
          this.searchEstonia(query),
          this.searchElasticsearch(query),
        ]);
        return [
          ...(fi.status === 'fulfilled' ? fi.value : []),
          ...(ee.status === 'fulfilled' ? ee.value : []),
          ...(lvlt.status === 'fulfilled' ? lvlt.value : []),
        ];
      }
    }
  }

  // ── Finland — PRH Open Data API ───────────────────────────────────────────

  private async searchFinland(query: string): Promise<CompanyResult[]> {
    const cacheKey = `company:fi:${query.toLowerCase()}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as CompanyResult[];

    try {
      const response = await firstValueFrom(
        this.http.get<PrhSearchResponse>(`${this.prhUrl}/companies`, {
          params: { name: query, maxResults: 10 },
          timeout: 8_000,
        }),
      );

      const results = (response.data.results ?? []).map<CompanyResult>((c) => {
        const addr = c.addresses?.find((a) => a.type === 1); // type 1 = visiting address
        return {
          id: c.businessId,
          name: c.name,
          registrationNumber: c.businessId,
          country: 'FI',
          status: 'ACTIVE',
          registeredAt: c.registrationDate,
          address: addr
            ? {
                street: addr.street,
                city: addr.city,
                postalCode: addr.postCode,
                country: 'FI',
              }
            : undefined,
        };
      });

      await this.redis.setex(cacheKey, this.cacheTtl, JSON.stringify(results));
      return results;
    } catch (err) {
      this.logger.warn(`PRH search failed for "${query}": ${(err as Error).message}`);
      return [];
    }
  }

  // ── Estonia — Äriregister API ─────────────────────────────────────────────

  private async searchEstonia(query: string): Promise<CompanyResult[]> {
    const cacheKey = `company:ee:${query.toLowerCase()}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as CompanyResult[];

    try {
      // Äriregister suggest endpoint
      const response = await firstValueFrom(
        this.http.get<AriregisterSuggestion[]>(`${this.ariUrl}/est/suggestCompanyName`, {
          params: { name: query, limit: 10 },
          timeout: 8_000,
        }),
      );

      const results = (response.data ?? []).map<CompanyResult>((c) => ({
        id: c.ariregistriKood,
        name: c.nimi,
        registrationNumber: c.ariregistriKood,
        country: 'EE',
        status: c.staatus === 'R' ? 'ACTIVE' : 'INACTIVE',
        address: c.aadress ? { street: c.aadress, country: 'EE' } : undefined,
      }));

      await this.redis.setex(cacheKey, this.cacheTtl, JSON.stringify(results));
      return results;
    } catch (err) {
      this.logger.warn(`Äriregister search failed for "${query}": ${(err as Error).message}`);
      return [];
    }
  }

  // ── Latvia / Lithuania — Elasticsearch ───────────────────────────────────

  async searchElasticsearch(query: string, country?: CountryCode): Promise<CompanyResult[]> {
    const cacheKey = `company:es:${country ?? 'all'}:${query.toLowerCase()}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as CompanyResult[];

    const countryFilter = country ? [{ term: { country } }] : [];

    try {
      const response = await this.es.search<CompanyDocument>({
        index: this.esIndex,
        size: 10,
        query: {
          bool: {
            must: [
              {
                multi_match: {
                  query,
                  fields: ['name^3', 'registrationNumber^2', 'vatNumber'],
                  type: 'best_fields',
                  fuzziness: 'AUTO',
                },
              },
            ],
            filter: countryFilter,
          },
        },
        sort: [{ _score: { order: 'desc' } }, { 'nameLower.keyword': { order: 'asc' } }],
      });

      const results = response.hits.hits.map<CompanyResult>((hit) => {
        const doc = hit._source!;
        return {
          id: doc.registrationNumber,
          name: doc.name,
          registrationNumber: doc.registrationNumber,
          vatNumber: doc.vatNumber,
          country: doc.country,
          status: doc.status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE',
          address: {
            street: doc.street,
            city: doc.city,
            postalCode: doc.postalCode,
            country: doc.country,
          },
          registeredAt: doc.registeredAt,
        };
      });

      await this.redis.setex(cacheKey, Math.min(this.cacheTtl, 300), JSON.stringify(results));
      return results;
    } catch (err) {
      this.logger.warn(`ES search failed for "${query}": ${(err as Error).message}`);
      return [];
    }
  }

  // ── Elasticsearch index bootstrap ─────────────────────────────────────────

  async ensureIndex(): Promise<void> {
    const exists = await this.es.indexExists(this.esIndex);
    if (exists) return;

    await this.es.createIndex(this.esIndex, {
      mappings: {
        properties: {
          name: { type: 'text', analyzer: 'standard', fields: { keyword: { type: 'keyword' } } },
          nameLower: { type: 'keyword' },
          registrationNumber: { type: 'keyword' },
          vatNumber: { type: 'keyword' },
          country: { type: 'keyword' },
          status: { type: 'keyword' },
          street: { type: 'text' },
          city: { type: 'keyword' },
          postalCode: { type: 'keyword' },
          registeredAt: { type: 'date' },
          syncedAt: { type: 'date' },
        },
      },
      settings: {
        number_of_shards: 1,
        number_of_replicas: 0,
        analysis: {
          analyzer: {
            standard: { type: 'standard' },
          },
        },
      },
    });

    this.logger.log(`Elasticsearch index "${this.esIndex}" created`);
  }
}
