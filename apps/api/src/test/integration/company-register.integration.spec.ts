/**
 * Integration tests — company_register pg_trgm search on real PostgreSQL
 * (Testcontainers). Verifies the migration (pg_trgm + GIN index), trigram
 * exact/fuzzy matching, country scoping, and idempotent ON CONFLICT upsert.
 */
import 'reflect-metadata';
import { PgContainerHelper } from './helpers/pg-container';
import { CompanyService } from '../../company/company.service';

let helper: PgContainerHelper;
let service: CompanyService;

// CompanyService deps not exercised by the LV/LT register path.
const noRedis = { get: async () => null, setex: async () => undefined };
const config = { get: (_key: string, dflt?: unknown) => dflt };

beforeAll(async () => {
  helper = await PgContainerHelper.start();
  service = new CompanyService({} as never, config as never, helper.prisma, noRedis as never);
}, 120_000);

afterAll(async () => {
  await helper.stop();
}, 30_000);

beforeEach(async () => {
  await helper.truncateAll();
  await helper.prisma.companyRegister.createMany({
    data: [
      { id: 'LV-1', country: 'LV', regNumber: '1', name: 'Acme Latvia SIA', status: 'ACTIVE', source: 'test' },
      { id: 'LV-2', country: 'LV', regNumber: '2', name: 'Globex Holdings SIA', status: 'ACTIVE', source: 'test' },
      { id: 'LT-3', country: 'LT', regNumber: '3', name: 'Acme Lithuania UAB', status: 'ACTIVE', source: 'test' },
      // Short + long name sharing the prefix "Latv" — the case set similarity()
      // ranks wrong (long name penalised for its tail). word_similarity fixes it.
      { id: 'LV-10', country: 'LV', regNumber: '10', name: 'Latva SIA', status: 'ACTIVE', source: 'test' },
      { id: 'LV-11', country: 'LV', regNumber: '11', name: 'Latvijas Dzelzceļš AS', status: 'ACTIVE', source: 'test' },
    ],
  });
});

describe('company_register pg_trgm search (integration)', () => {
  it('finds an exact name match', async () => {
    const res = await service.searchRegistry('LV', 'Acme Latvia SIA', 10);
    expect(res.map((r) => r.id)).toContain('LV-1');
  });

  it('finds a fuzzy / typo match via trigram similarity', async () => {
    const res = await service.searchRegistry('LV', 'Acme Latvja', 10); // typo'd
    expect(res.map((r) => r.id)).toContain('LV-1');
  });

  it('matches a short fragment and scopes results by country', async () => {
    const res = await service.searchRegistry('LV', 'Acme', 10);
    const ids = res.map((r) => r.id);
    expect(ids).toContain('LV-1');
    expect(ids).not.toContain('LT-3'); // LT row excluded by the country filter
  });

  it('returns nothing for an unrelated query', async () => {
    const res = await service.searchRegistry('LV', 'Zzzzzz Quux', 10);
    expect(res).toHaveLength(0);
  });

  it('surfaces a long prefix-match near the top (word_similarity, not set similarity)', async () => {
    // Dedicated data: just a short and a long name sharing the prefix "Latv".
    await helper.truncateAll();
    await helper.prisma.companyRegister.createMany({
      data: [
        { id: 'rk-1', country: 'LV', regNumber: 'rk-1', name: 'Latva SIA', status: 'ACTIVE', source: 'test' },
        { id: 'rk-2', country: 'LV', regNumber: 'rk-2', name: 'Latvijas Dzelzceļš AS', status: 'ACTIVE', source: 'test' },
      ],
    });

    const res = await service.searchRegistry('LV', 'Latv', 10);
    const names = res.map((r) => r.name);

    // word_similarity surfaces BOTH near the top. Under set similarity() the long
    // name's uncovered tail tanks its score below the threshold and it gets
    // dropped/buried — the exact regression this change fixes.
    expect(names).toContain('Latva SIA');
    expect(names).toContain('Latvijas Dzelzceļš AS');
    const longIdx = names.indexOf('Latvijas Dzelzceļš AS');
    expect(longIdx).toBeGreaterThanOrEqual(0);
    expect(longIdx).toBeLessThanOrEqual(1); // top 2 — not buried below short names
  });

  it('upserts idempotently on the (country, regNumber) natural key', async () => {
    await helper.prisma.$executeRaw`
      INSERT INTO company_register (id, country, name, "regNumber", status, source)
      VALUES ('LV-dup', 'LV', 'Acme Latvia RENAMED', '1', 'ACTIVE', 'test')
      ON CONFLICT (country, "regNumber") DO UPDATE SET name = EXCLUDED.name
    `;
    const rows = await helper.prisma.companyRegister.findMany({
      where: { country: 'LV', regNumber: '1' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('Acme Latvia RENAMED');
  });
});
