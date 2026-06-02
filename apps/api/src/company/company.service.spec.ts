import { CompanyService } from './company.service';

/**
 * Unit tests for the Postgres pg_trgm register search (LV/LT) that replaced
 * Elasticsearch. The search runs inside a $transaction (SET LOCAL threshold +
 * trigram $queryRaw); the transaction, raw query, and Redis cache are mocked.
 * The exact/fuzzy trigram behaviour is covered by the integration test.
 */
describe('CompanyService.searchRegistry', () => {
  const build = () => {
    const redis = { get: jest.fn(), setex: jest.fn() };
    const txQueryRaw = jest.fn();
    const tx = { $executeRawUnsafe: jest.fn(), $queryRaw: txQueryRaw };
    const prisma = { $transaction: jest.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)) };
    const http = {};
    const config = { get: jest.fn().mockReturnValue('http://example.test') };
    const svc = new CompanyService(
      http as never,
      config as never,
      prisma as never,
      redis as never,
    );
    return { svc, redis, prisma, tx, txQueryRaw };
  };

  it('returns the cached result without hitting Postgres', async () => {
    const { svc, redis, prisma } = build();
    redis.get.mockResolvedValue(JSON.stringify([{ id: 'LV-1', name: 'Cached' }]));

    const res = await svc.searchRegistry('LV', 'acme', 10);

    expect(res).toEqual([{ id: 'LV-1', name: 'Cached' }]);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('queries Postgres on cache miss, maps nulls to undefined, and caches', async () => {
    const { svc, redis, tx, txQueryRaw } = build();
    redis.get.mockResolvedValue(null);
    txQueryRaw.mockResolvedValue([
      {
        id: 'LV-40', country: 'LV', name: 'Acme SIA', regNumber: '40',
        vatNumber: 'LV40', legalForm: null, address: null,
        status: 'ACTIVE', source: 'data.gov.lv',
      },
    ]);

    const res = await svc.searchRegistry('LV', 'acme', 10);

    expect(tx.$executeRawUnsafe).toHaveBeenCalled(); // SET LOCAL threshold
    expect(txQueryRaw).toHaveBeenCalledTimes(1);
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
    const { svc, redis, txQueryRaw } = build();
    redis.get.mockResolvedValue(null);
    txQueryRaw.mockRejectedValue(new Error('db unreachable'));

    const res = await svc.searchRegistry('LT', 'uab', 10);

    expect(res).toEqual([]);
  });
});
