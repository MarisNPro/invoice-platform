import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from '@elastic/elasticsearch';
import type { SearchRequest, SearchResponse } from '@elastic/elasticsearch/lib/api/types';

@Injectable()
export class ElasticsearchService implements OnModuleInit {
  private readonly logger = new Logger(ElasticsearchService.name);
  readonly client: Client;

  constructor(private readonly config: ConfigService) {
    const node = config.get<string>('ELASTICSEARCH_URL', 'http://localhost:9200');
    this.client = new Client({ node });
  }

  async onModuleInit() {
    try {
      const info = await this.client.info();
      this.logger.log(`Elasticsearch connected — cluster: ${info.cluster_name}`);
    } catch (err) {
      this.logger.warn(`Elasticsearch not ready yet: ${(err as Error).message}`);
    }
  }

  async search<T extends object>(params: SearchRequest): Promise<SearchResponse<T>> {
    return this.client.search<T>(params);
  }

  async indexExists(index: string): Promise<boolean> {
    return this.client.indices.exists({ index });
  }

  async createIndex(
    index: string,
    body: { mappings: object; settings?: object },
  ): Promise<void> {
    await this.client.indices.create({ index, body });
  }

  async bulk(operations: object[]): Promise<void> {
    const { errors, items } = await this.client.bulk({ body: operations, refresh: true });
    if (errors) {
      const failed = items.filter((i) => i.index?.error || i.update?.error);
      this.logger.warn(`Bulk had ${failed.length} errors`);
    }
  }

  /**
   * Builds a bulk upsert body: interleaves { index } action + document.
   */
  static buildBulkUpsert<T extends { id: string }>(
    index: string,
    docs: T[],
  ): object[] {
    return docs.flatMap((doc) => [{ index: { _index: index, _id: doc.id } }, doc]);
  }
}
