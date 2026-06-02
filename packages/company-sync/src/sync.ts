/**
 * Authoritative LV/LT company-registry sync — shared by the API CLI
 * (@invoice/api sync-runner / CompanySyncService) and the BullMQ worker.
 *
 * Framework-agnostic: the caller passes a PrismaClient and a minimal logger, so
 * it runs both inside NestJS and in the standalone worker. Upserts rows into the
 * Postgres `company_registry` table (pg_trgm search) — no Elasticsearch.
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import { parse as csvParse } from 'csv-parse';
import axios from 'axios';

export interface SyncLogger {
  log(message: string): void;
  warn(message: string): void;
}

export interface SyncResult {
  indexed: number;
  skipped: number;
}

/** Row upserted into company_registry. */
interface CompanyRow {
  id:         string;
  country:    string;
  name:       string;
  regNumber:  string;
  vatNumber?: string;
  legalForm?: string;
  address?:   string;
  status:     string;
  source:     string;
}

const BATCH_SIZE = 2_000;
const LT_PAGE    = 100_000;

const LV_COMPANIES_CSV =
  'https://data.gov.lv/dati/dataset/4de9697f-850b-45ec-8bba-61fa09ce932f/resource/25e80bf3-f107-4ab4-89ef-251b5b9374e9/download/register.csv';
const LV_VAT_CSV =
  'https://data.gov.lv/dati/dataset/9a5eae1c-2438-48cf-854b-6a2c170f918f/resource/610910e9-e086-4c5b-a7ea-0a896a697672/download/pdb_pvnmaksataji_odata.csv';
const LT_API_BASE =
  'https://get.data.gov.lt/datasets/gov/rc/jar/iregistruoti/JuridinisAsmuo/';

interface LvCompanyRow {
  regcode:    string;
  name:       string;
  type_text:  string;
  registered: string;
  terminated: string;
  closed:     string;
  address:    string;
  [key: string]: string;
}
interface LvVatRow { Numurs: string; Aktivs: string; Izslegts: string; [key: string]: string; }
interface LtRow {
  ja_kodas:       string;
  ja_pavadinimas: string;
  pilnas_adresas: string;
  reg_data:       string;
  isreg_data:     string;
}

// ── Batch upsert into company_registry ──────────────────────────────────────

async function upsertCompanies(prisma: PrismaClient, rows: CompanyRow[]): Promise<void> {
  if (!rows.length) return;
  const values = rows.map(
    (c) => Prisma.sql`(${c.id}, ${c.country}, ${c.name}, ${c.regNumber}, ${c.vatNumber ?? null}, ${c.legalForm ?? null}, ${c.address ?? null}, ${c.status}, ${c.source})`,
  );
  await prisma.$executeRaw`
    INSERT INTO company_register (id, country, name, "regNumber", "vatNumber", "legalForm", address, status, source)
    VALUES ${Prisma.join(values)}
    ON CONFLICT (country, "regNumber") DO UPDATE SET
      name        = EXCLUDED.name,
      "vatNumber" = EXCLUDED."vatNumber",
      "legalForm" = EXCLUDED."legalForm",
      address     = EXCLUDED.address,
      status      = EXCLUDED.status,
      source      = EXCLUDED.source,
      "updatedAt" = CURRENT_TIMESTAMP
  `;
}

// ── Shared CSV stream helper ────────────────────────────────────────────────

async function openCsvStream(url: string, delimiter: string) {
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

// ── Latvia ──────────────────────────────────────────────────────────────────

/** Build Map<regcode, fullVatNumber> from the LV VAT payers CSV. */
async function buildLvVatMap(): Promise<Map<string, string>> {
  const vatMap = new Map<string, string>();
  const stream = await openCsvStream(LV_VAT_CSV, ',');

  for await (const raw of stream) {
    const row = raw as LvVatRow;
    const numurs = row.Numurs?.trim().replace(/^"/, '').replace(/"$/, '');
    if (!numurs?.startsWith('LV')) continue;
    vatMap.set(numurs.slice(2), numurs); // strip "LV" prefix → regcode
  }

  return vatMap;
}

export async function syncLatvia(prisma: PrismaClient, logger: SyncLogger): Promise<SyncResult> {
  logger.log('LV sync — building VAT map…');
  const vatMap = await buildLvVatMap();
  logger.log(`LV sync — VAT map ready: ${vatMap.size} entries`);

  logger.log('LV sync — streaming companies CSV…');
  let indexed = 0;
  let skipped = 0;
  let batch: CompanyRow[] = [];

  const flush = async () => {
    if (!batch.length) return;
    await upsertCompanies(prisma, batch);
    indexed += batch.length;
    batch = [];
  };

  const stream = await openCsvStream(LV_COMPANIES_CSV, ';');

  for await (const raw of stream) {
    const row = raw as LvCompanyRow;

    if (row.terminated?.trim() || row.closed?.trim()) { skipped++; continue; }

    const regcode = row.regcode?.trim();
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

    if (batch.length >= BATCH_SIZE) await flush();
  }

  await flush();
  logger.log(`LV sync done — indexed: ${indexed}, skipped: ${skipped}`);
  return { indexed, skipped };
}

// ── Lithuania ───────────────────────────────────────────────────────────────

function ltPageUrl(lastCode: number): string {
  const base = `${LT_API_BASE}?limit(${LT_PAGE})&format(csv)&select(ja_kodas,ja_pavadinimas,pilnas_adresas,reg_data,isreg_data)`;
  return lastCode > 0 ? `${base}&ja_kodas>${lastCode}` : base;
}

async function fetchLtPage(url: string): Promise<LtRow[]> {
  const response = await axios.get<NodeJS.ReadableStream>(url, {
    responseType: 'stream',
    timeout:      120_000,
    headers:      { 'Accept-Encoding': 'gzip' },
  });

  const rows: LtRow[] = [];
  const parser = (response.data as NodeJS.ReadableStream).pipe(
    csvParse({ columns: true, bom: true, skip_empty_lines: true, relax_column_count: true }),
  );

  for await (const row of parser) rows.push(row as LtRow);
  return rows;
}

export async function syncLithuania(prisma: PrismaClient, logger: SyncLogger): Promise<SyncResult> {
  logger.log('LT sync — paginating UAPI…');
  let indexed  = 0;
  let skipped  = 0;
  let lastCode = 0;
  let pageNum  = 1;

  for (;;) {
    logger.log(`LT sync — page ${pageNum} (ja_kodas>${lastCode})…`);
    const rows = await fetchLtPage(ltPageUrl(lastCode));
    if (!rows.length) break;

    const batch: CompanyRow[] = [];
    for (const row of rows) {
      lastCode = Math.max(lastCode, Number(row.ja_kodas) || 0);

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
      await upsertCompanies(prisma, batch);
      indexed += batch.length;
    }

    logger.log(`LT sync page ${pageNum} — rows: ${rows.length}, indexed: ${batch.length}`);
    if (rows.length < LT_PAGE) break;
    pageNum++;
  }

  logger.log(`LT sync done — indexed: ${indexed}, skipped: ${skipped}`);
  return { indexed, skipped };
}
