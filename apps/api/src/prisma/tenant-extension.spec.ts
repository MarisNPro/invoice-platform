import { scopeOperation } from './tenant-extension';
import { runWithTenant, runUnscoped } from './tenant-context';

const TID = '11111111-1111-1111-1111-111111111111';
const echo = () => jest.fn(async (a: unknown) => a);

describe('scopeOperation — structural tenant isolation', () => {
  it('injects tenantId into where for findMany', async () => {
    const query = echo();
    await runWithTenant(TID, () =>
      scopeOperation({ model: 'Invoice', operation: 'findMany', args: { where: { status: 'PAID' } }, query }),
    );
    expect(query).toHaveBeenCalledWith({ where: { status: 'PAID', tenantId: TID } });
  });

  it('injects tenantId into data for create', async () => {
    const query = echo();
    await runWithTenant(TID, () =>
      scopeOperation({ model: 'Contact', operation: 'create', args: { data: { name: 'Acme' } }, query }),
    );
    expect(query).toHaveBeenCalledWith({ data: { name: 'Acme', tenantId: TID } });
  });

  it('injects tenantId into every row for createMany', async () => {
    const query = echo();
    await runWithTenant(TID, () =>
      scopeOperation({ model: 'Product', operation: 'createMany', args: { data: [{ n: 1 }, { n: 2 }] }, query }),
    );
    expect(query).toHaveBeenCalledWith({ data: [{ n: 1, tenantId: TID }, { n: 2, tenantId: TID }] });
  });

  it('scopes the Tenant model by id (not tenantId)', async () => {
    const query = echo();
    await runWithTenant(TID, () =>
      scopeOperation({ model: 'Tenant', operation: 'findMany', args: {}, query }),
    );
    expect(query).toHaveBeenCalledWith({ where: { id: TID } });
  });

  it('throws on cross-tenant findUnique result', async () => {
    const query = jest.fn(async () => ({ id: 'x', tenantId: 'someone-else' }));
    await expect(
      runWithTenant(TID, () =>
        scopeOperation({ model: 'Invoice', operation: 'findUnique', args: { where: { id: 'x' } }, query }),
      ),
    ).rejects.toThrow(/cross-tenant/);
  });

  it('allows findUnique for own-tenant rows', async () => {
    const query = jest.fn(async () => ({ id: 'x', tenantId: TID }));
    const res = await runWithTenant(TID, () =>
      scopeOperation({ model: 'Invoice', operation: 'findUnique', args: { where: { id: 'x' } }, query }),
    );
    expect(res).toEqual({ id: 'x', tenantId: TID });
  });

  it('fails closed when there is no tenant context on a scoped model', async () => {
    const query = echo();
    await expect(
      scopeOperation({ model: 'Invoice', operation: 'findMany', args: {}, query }),
    ).rejects.toThrow(/no tenant context/);
    expect(query).not.toHaveBeenCalled();
  });

  it('leaves non-scoped models untouched (even without context)', async () => {
    const query = echo();
    await scopeOperation({ model: 'SomeGlobalModel', operation: 'findMany', args: { where: {} }, query });
    expect(query).toHaveBeenCalledWith({ where: {} });
  });

  it('bypasses injection inside runUnscoped', async () => {
    const query = echo();
    await runUnscoped(() =>
      scopeOperation({ model: 'Invoice', operation: 'findMany', args: { where: { a: 1 } }, query }),
    );
    expect(query).toHaveBeenCalledWith({ where: { a: 1 } });
  });
});
