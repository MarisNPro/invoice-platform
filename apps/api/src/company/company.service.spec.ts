import { CompanyService } from './company.service';

/**
 * Unit tests for the Postgres pg_trgm registry search (LV/LT) that replaced
 * Elasticsearch. PrismaService.$queryRaw and the Redis cache are mocked.
 */
describe('CompanyService.searchRegistry', () => {
  const build = () => {
    const redis = { get: jest.fn(), setex: jest.fn() };
    const prisma = { $queryRaw: jest.fn() };
    const http = {};
    const config = { get: jest.fn().mockReturnValue('http://example.test') };
    const svc = new CompanyService(
      http as never,
      config as never,
      prisma as never,
      redis as never,
    );
    return { svc, redis, prisma };
  };

  it('returns the cached result without hitting Postgres', async () => {
    const { svc, redis, prisma } = build();
    redis.get.mockResolvedValue(JSON.stringify([{ id: 'LV-1', name: 'Cached' }]));

    const res = await svc.searchRegistry('LV', 'acme', 10);

    expect(res).toEqual([{ id: 'LV-1', name: 'Cached' }]);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('queries Postgres on cache miss, maps nulls to undefined, and caches', async () => {
    const { svc, redis, prisma } = build();
    redis.get.mockResolvedValue(null);
    prisma.$queryRaw.mockResolvedValue([
      {
        id: 'LV-40', country: 'LV', name: 'Acme SIA', regNumber: '40',
        vatNumber: 'LV40', legalForm: null, address: null,
        status: 'ACTIVE', source: 'data.gov.lv',
      },
    ]);

    const res = await svc.searchRegistry('LV', 'acme', 10);

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(res).toEqual([
      {
        id: 'LV-40', country: 'LV', name: 'Acme SIA', regNumber: '40',
        vatNumber: 'LV40', legalForm: undefined, address: undefined,
        status: 'ACTIVE', source: 'data.gov.lv',
      },
    ]);
    expect(redis.setex).toHaveBeenCalledWith('companies:LV:acme', 600, expect.any(String));
  });

  it('returns an empty array (never throws) when the query fails', async () => {
    const { svc, redis, prisma } = build();
    redis.get.mockResolvedValue(null);
    prisma.$queryRaw.mockRejectedValue(new Error('db unreachable'));

    const res = await svc.searchRegistry('LT', 'uab', 10);

    expect(res).toEqual([]);
  });
});
