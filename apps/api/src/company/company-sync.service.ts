/**
 * CompanySyncService
 *
 * Bulk-syncs company registries into Elasticsearch:
 *   - Latvia  (LV): stream-parses two data.gov.lv CSVs  → index "companies_lv"
 *   - Lithuania (LT): paginates get.data.gov.lt UAPI    → index "companies_lt"
 *
 * Indexes are created with an edge-ngram analyser for fast prefix autocomplete.
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ElasticsearchService } from '../common/elasticsearch/elasticsearch.service';
import { parse as csvParse } from 'csv-parse';
import axios from 'axios';
import { INDEX_LV, INDEX_LT } from './company.service';
import type { CompanyDocument } from './company.types';

const BATCH_SIZE = 2_000;
const LT_PAGE    = 100_000;

const LV_COMPANIES_CSV =
  'https://data.gov.lv/dati/dataset/4de9697f-850b-45ec-8bba-61fa09ce932f/resource/25e80bf3-f107-4ab4-89ef-251b5b9374e9/download/register.csv';
const LV_VAT_CSV =
  'https://data.gov.lv/dati/dataset/9a5eae1c-2438-48cf-854b-6a2c170f918f/resource/610910e9-e086-4c5b-a7ea-0a896a697672/download/pdb_pvnmaksataji_odata.csv';
const LT_API_BASE =
  'https://get.data.gov.lt/datasets/gov/rc/jar/iregistruoti/JuridinisAsmuo/';

// ── Edge-ngram index settings (shared between LV and LT) ─────────────────

const INDEX_SETTINGS = {
  settings: {
    analysis: {
      tokenizer: {
        edge_ngram_tokenizer: {
          type:        'edge_ngram',
          min_gram:    2,
          max_gram:    20,
          token_chars: ['letter', 'digit', 'whitespace'],
        },
      },
      analyzer: {
        name_index_analyzer: {
          type:      'custom',
          tokenizer: 'edge_ngram_tokenizer',
          filter:    ['lowercase', 'asciifolding'],
        },
        name_search_analyzer: {
          type:      'custom',
          tokenizer: 'standard',
          filter:    ['lowercase', 'asciifolding'],
        },
      },
    },
  },
  mappings: {
    properties: {
      id:        { type: 'keyword' },
      country:   { type: 'keyword' },
      name: {
        type:            'text',
        analyzer:        'name_index_analyzer',
        search_analyzer: 'name_search_analyzer',
        fields: { keyword: { type: 'keyword' } },
      },
      regNumber:  { type: 'keyword' },
      vatNumber:  { type: 'keyword' },
      legalForm:  { type: 'keyword' },
      address:    { type: 'text' },
      status:     { type: 'keyword' },
      source:     { type: 'keyword' },
    },
  },
};

// ── Row shapes ────────────────────────────────────────────────────────────

interface LvCompanyRow {
  regcode:      string;
  name:         string;
  type_text:    string;
  registered:   string;
  terminated:   string;
  closed:       string;
  address:      string;
  [key: string]: string;
}

interface LvVatRow {
  Numurs:   string;
  Aktivs:   string;
  Izslegts: string;
  [key: string]: string;
}

interface LtRow {
  ja_kodas:      string;
  ja_pavadinimas:string;
  pilnas_adresas:string;
  reg_data:      string;
  isreg_data:    string;
}

@Injectable()
export class CompanySyncService implements OnModuleInit {
  private readonly logger = new Logger(CompanySyncService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly es:     ElasticsearchService,
  ) {}

  // ── Bootstrap: create indexes if missing ─────────────────────────────────

  async onModuleInit() {
    await this.ensureIndex(INDEX_LV);
    await this.ensureIndex(INDEX_LT);
  }

  private async ensureIndex(index: string) {
    try {
      const exists = await this.es.indexExists(index);
      if (!exists) {
        await this.es.createIndex(index, INDEX_SETTINGS as Parameters<typeof this.es.createIndex>[1]);
        this.logger.log(`Created ES index "${index}"`);
      }
    } catch (err) {
      this.logger.warn(`Could not ensure index "${index}": ${(err as Error).message}`);
    }
  }

  // ── Latvia sync ───────────────────────────────────────────────────────────

  async syncLatvia(): Promise<{ indexed: number; skipped: number }> {
    this.logger.log('LV sync — building VAT map…');
    const vatMap = await this.buildLvVatMap();
    this.logger.log(`LV sync — VAT map ready: ${vatMap.size} entries`);

    this.logger.log('LV sync — streaming companies CSV…');
    let indexed = 0;
    let skipped = 0;
    let batch:   CompanyDocument[] = [];

    const upsertBatch = async () => {
      if (!batch.length) return;
      const ops = ElasticsearchService.buildBulkUpsert(INDEX_LV, batch);
      await this.es.bulk(ops);
      indexed += batch.length;
      batch = [];
    };

    const stream = await this.openCsvStream(LV_COMPANIES_CSV, ';');

    for await (const raw of stream) {
      const row = raw as LvCompanyRow;

      // Skip terminated or closed companies
      if (row.terminated?.trim() || row.closed?.trim()) {
        skipped++;
        continue;
      }

      const regcode   = row.regcode?.trim();
      if (!regcode) { skipped++; continue; }

      const vatNumber = vatMap.get(regcode);

      batch.push({
        id:        `LV-${regcode}`,
        country:   'LV',
        name:      row.name?.trim() ?? '',
        regNumber: regcode,
        vatNumber: vatNumber ?? `LV${regcode}`,
        legalForm: row.type_text?.trim() || undefined,
        address:   row.address?.trim()   || undefined,
        status:    'ACTIVE',
        source:    'data.gov.lv',
      });

      if (batch.length >= BATCH_SIZE) await upsertBatch();
    }

    await upsertBatch();
    this.logger.log(`LV sync done — indexed: ${indexed}, skipped: ${skipped}`);
    return { indexed, skipped };
  }

  /** Build Map<regcode, fullVatNumber> from the LV VAT payers CSV */
  private async buildLvVatMap(): Promise<Map<string, string>> {
    const vatMap = new Map<string, string>();
    const stream = await this.openCsvStream(LV_VAT_CSV, ',');

    for await (const raw of stream) {
      const row = raw as LvVatRow;
      const numurs = row.Numurs?.trim().replace(/^"/, '').replace(/"$/, '');
      if (!numurs?.startsWith('LV')) continue;
      const regcode = numurs.slice(2); // strip "LV" prefix → regcode
      vatMap.set(regcode, numurs);
    }

    return vatMap;
  }

  // ── Lithuania sync ────────────────────────────────────────────────────────

  async syncLithuania(): Promise<{ indexed: number; skipped: number }> {
    this.logger.log('LT sync — paginating UAPI…');
    let indexed    = 0;
    let skipped    = 0;
    let lastCode   = 0;
    let pageNum    = 1;

    while (true) {
      this.logger.log(`LT sync — page ${pageNum} (ja_kodas>${lastCode})…`);

      const url = this.ltPageUrl(lastCode);
      const rows = await this.fetchLtPage(url);

      if (!rows.length) break;

      const batch: CompanyDocument[] = [];

      for (const row of rows) {
        lastCode = Math.max(lastCode, Number(row.ja_kodas) || 0);

        // Skip deregistered
        if (row.isreg_data?.trim()) { skipped++; continue; }

        const kodas = row.ja_kodas?.trim();
        if (!kodas) { skipped++; continue; }

        batch.push({
          id:        `LT-${kodas}`,
          country:   'LT',
          name:      row.ja_pavadinimas?.trim() ?? '',
          regNumber: kodas,
          vatNumber: `LT${kodas}`,
          address:   row.pilnas_adresas?.trim() || undefined,
          status:    'ACTIVE',
          source:    'get.data.gov.lt',
        });
      }

      if (batch.length) {
        const ops = ElasticsearchService.buildBulkUpsert(INDEX_LT, batch);
        await this.es.bulk(ops);
        indexed += batch.length;
      }

      this.logger.log(`LT sync page ${pageNum} — rows: ${rows.length}, indexed: ${batch.length}, skipped this page: ${rows.length - batch.length}`);

      if (rows.length < LT_PAGE) break; // last page
      pageNum++;
    }

    this.logger.log(`LT sync done — indexed: ${indexed}, skipped: ${skipped}`);
    return { indexed, skipped };
  }

  private ltPageUrl(lastCode: number): string {
    const base = `${LT_API_BASE}?limit(${LT_PAGE})&format(csv)&select(ja_kodas,ja_pavadinimas,pilnas_adresas,reg_data,isreg_data)`;
    return lastCode > 0 ? `${base}&ja_kodas>${lastCode}` : base;
  }

  private async fetchLtPage(url: string): Promise<LtRow[]> {
    const response = await axios.get<NodeJS.ReadableStream>(url, {
      responseType: 'stream',
      timeout:      120_000,
      headers:      { 'Accept-Encoding': 'gzip' },
    });

    const rows: LtRow[] = [];
    const parser = (response.data as NodeJS.ReadableStream).pipe(
      csvParse({ columns: true, bom: true, skip_empty_lines: true, relax_column_count: true }),
    );

    for await (const row of parser) {
      rows.push(row as LtRow);
    }

    return rows;
  }

  // ── Shared CSV stream helper ───────────────────────────────────────────────

  private async openCsvStream(url: string, delimiter: string) {
    const response = await axios.get<NodeJS.ReadableStream>(url, {
      responseType: 'stream',
      timeout:      300_000,
      headers:      { 'Accept-Encoding': 'gzip' },
    });

    return (response.data as NodeJS.ReadableStream).pipe(
      csvParse({
        delimiter,
        columns:            true,
        bom:                true,
        skip_empty_lines:   true,
        relax_column_count: true,
        relax_quotes:       true,
      }),
    );
  }
}
