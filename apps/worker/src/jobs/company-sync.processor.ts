import type { Job, Processor } from 'bullmq';
import { Logger } from '../logger';
import axios from 'axios';
import { parse } from 'csv-parse';
import { Readable } from 'stream';
import { Client as ESClient } from '@elastic/elasticsearch';
import type { CompanySyncJobData } from './job.constants';

// ── Types ─────────────────────────────────────────────────────────────────────

interface CompanyDoc {
  id: string;
  name: string;
  nameLower: string;
  registrationNumber: string;
  vatNumber?: string;
  country: 'LV' | 'LT';
  status: string;
  street?: string;
  city?: string;
  postalCode?: string;
  registeredAt?: string;
  syncedAt: string;
}

// ── Config ────────────────────────────────────────────────────────────────────

const ES_URL    = process.env['ELASTICSEARCH_URL']        ?? 'http://localhost:9200';
const ES_INDEX  = process.env['ELASTICSEARCH_INDEX_COMPANIES'] ?? 'companies';
const LV_CSV_URL = process.env['LV_UR_CSV_URL'] ??
  'https://ur.gov.lv/en/open-data/companies.csv';
const LT_CSV_URL = process.env['LT_RC_CSV_URL'] ??
  'https://www.registrucentras.lt/jar/p/doc/jar_iregistruoti_statiniai.csv';

const BATCH_SIZE = 500;

const es     = new ESClient({ node: ES_URL });
const logger = new Logger('CompanySyncProcessor');

// ── Processor ─────────────────────────────────────────────────────────────────

export const companySyncProcessor: Processor<CompanySyncJobData> = async (
  job: Job<CompanySyncJobData>,
) => {
  const { country, csvUrl } = job.data;
  const url = csvUrl ?? (country === 'LV' ? LV_CSV_URL : LT_CSV_URL);

  logger.log(`[${job.name}] downloading ${url}`);
  await job.updateProgress(5);

  const response = await axios.get<ArrayBuffer>(url, {
    responseType: 'arraybuffer',
    timeout: 60_000,
    headers: { 'Accept-Encoding': 'gzip' },
  });

  const buffer = Buffer.from(response.data);
  logger.log(`[${job.name}] downloaded ${(buffer.length / 1024 / 1024).toFixed(1)} MB`);
  await job.updateProgress(20);

  await ensureIndex();

  let totalIndexed = 0;
  let totalErrors  = 0;
  let batch: CompanyDoc[] = [];

  const flush = async () => {
    if (batch.length === 0) return;
    const ops = batch.flatMap((doc) => [
      { index: { _index: ES_INDEX, _id: doc.id } },
      doc,
    ]);
    const { errors, items } = await es.bulk({ body: ops, refresh: false });
    if (errors) {
      totalErrors += items.filter((i) => i.index?.error).length;
    }
    totalIndexed += batch.length;
    batch = [];
  };

  const parser =
    country === 'LV'
      ? buildLvParser(buffer)
      : buildLtParser(buffer);

  for await (const row of parser) {
    batch.push({ ...row, country, syncedAt: new Date().toISOString() });
    if (batch.length >= BATCH_SIZE) {
      await flush();
      const pct = Math.min(20 + Math.floor((totalIndexed / 100_000) * 70), 90);
      await job.updateProgress(pct);
    }
  }

  await flush();
  // Final refresh so documents are immediately searchable
  await es.indices.refresh({ index: ES_INDEX });

  await job.updateProgress(100);
  logger.log(`[${job.name}] done — indexed: ${totalIndexed}, errors: ${totalErrors}`);

  return { country, totalIndexed, totalErrors };
};

// ── Latvia UR CSV parser ───────────────────────────────────────────────────────
// Column order from ur.gov.lv open data (as of 2024):
// RegNum, Name, Status, RegDate, LegalForm, Street, City, PostalCode, VATNum

function buildLvParser(buffer: Buffer): AsyncIterable<Omit<CompanyDoc, 'country' | 'syncedAt'>> {
  const stream = Readable.from(buffer);
  const parser = stream.pipe(
    parse({
      delimiter: ';',
      from_line: 2,        // skip header
      trim: true,
      skip_empty_lines: true,
      relax_column_count: true,
    }),
  );

  return (async function* () {
    for await (const row of parser) {
      const cols = row as string[];
      const regNum = cols[0]?.trim();
      const name   = cols[1]?.trim();
      if (!regNum || !name) continue;

      yield {
        id:                 `lv-${regNum}`,
        name,
        nameLower:          name.toLowerCase(),
        registrationNumber: regNum,
        vatNumber:          cols[8]?.trim() || undefined,
        status:             mapLvStatus(cols[2]?.trim()),
        registeredAt:       parseDate(cols[3]?.trim()),
        street:             cols[5]?.trim() || undefined,
        city:               cols[6]?.trim() || undefined,
        postalCode:         cols[7]?.trim() || undefined,
      };
    }
  })();
}

// ── Lithuania RC CSV parser ────────────────────────────────────────────────────
// Column order from registrucentras.lt JAD open data:
// JA_KODAS, JA_PAVADINIMAS, STATUSAS, REG_DATA, JA_ADR_GATVE, JA_ADR_MIESTAS, JA_ADR_INDEKSAS

function buildLtParser(buffer: Buffer): AsyncIterable<Omit<CompanyDoc, 'country' | 'syncedAt'>> {
  const stream = Readable.from(buffer);
  const parser = stream.pipe(
    parse({
      delimiter: '|',
      from_line: 2,
      trim: true,
      skip_empty_lines: true,
      relax_column_count: true,
    }),
  );

  return (async function* () {
    for await (const row of parser) {
      const cols = row as string[];
      const regNum = cols[0]?.trim();
      const name   = cols[1]?.trim();
      if (!regNum || !name) continue;

      yield {
        id:                 `lt-${regNum}`,
        name,
        nameLower:          name.toLowerCase(),
        registrationNumber: regNum,
        status:             mapLtStatus(cols[2]?.trim()),
        registeredAt:       parseDate(cols[3]?.trim()),
        street:             cols[4]?.trim() || undefined,
        city:               cols[5]?.trim() || undefined,
        postalCode:         cols[6]?.trim() || undefined,
      };
    }
  })();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function mapLvStatus(raw?: string): string {
  if (!raw) return 'UNKNOWN';
  const s = raw.toUpperCase();
  if (s.includes('REĢIS') || s === 'ACTIVE') return 'ACTIVE';
  if (s.includes('LIKVID') || s.includes('IZSLĒG')) return 'INACTIVE';
  return 'UNKNOWN';
}

function mapLtStatus(raw?: string): string {
  if (!raw) return 'UNKNOWN';
  const s = raw.toUpperCase();
  if (s === 'REGISTRUOTA' || s === 'VEIKIANTI') return 'ACTIVE';
  if (s === 'LIKVIDUOTA' || s === 'IŠREGISTRUOTA') return 'INACTIVE';
  return 'UNKNOWN';
}

/** Parse common date formats (YYYY-MM-DD, DD.MM.YYYY) into ISO string */
function parseDate(raw?: string): string | undefined {
  if (!raw) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const match = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (match) return `${match[3]}-${match[2]}-${match[1]}`;
  return undefined;
}

async function ensureIndex() {
  const exists = await es.indices.exists({ index: ES_INDEX });
  if (exists) return;

  await es.indices.create({
    index: ES_INDEX,
    body: {
      settings: { number_of_shards: 1, number_of_replicas: 0 },
      mappings: {
        properties: {
          name: {
            type:     'text',
            analyzer: 'standard',
            fields:   { keyword: { type: 'keyword' } },
          },
          nameLower:          { type: 'keyword' },
          registrationNumber: { type: 'keyword' },
          vatNumber:          { type: 'keyword' },
          country:            { type: 'keyword' },
          status:             { type: 'keyword' },
          street:             { type: 'text' },
          city:               { type: 'keyword' },
          postalCode:         { type: 'keyword' },
          registeredAt:       { type: 'date' },
          syncedAt:           { type: 'date' },
        },
      },
    },
  });
  logger.log(`Elasticsearch index "${ES_INDEX}" created`);
}
