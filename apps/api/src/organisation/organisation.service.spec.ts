/**
 * OrganisationService unit tests.
 *
 * PrismaService is fully mocked — no real DB required.
 * Covers: API key CRUD, key validation, cowork context generation.
 */

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OrganisationService } from './organisation.service';
import { createHash } from 'crypto';

// ── Prisma mock factory ────────────────────────────────────────────────────────

function makePrismaMock(overrides: Record<string, unknown> = {}) {
  return {
    tenant: {
      findUnique:   jest.fn(),
      update:       jest.fn(),
    },
    contact: {
      findFirst:    jest.fn(),
      findMany:     jest.fn(),
    },
    apiKey: {
      create:       jest.fn(),
      findMany:     jest.fn(),
      findFirst:    jest.fn(),
      findUnique:   jest.fn(),
      update:       jest.fn(),
    },
    invoice: {
      groupBy:      jest.fn(),
    },
    ...overrides,
  } as unknown as import('../prisma/prisma.service').PrismaService;
}

// ── Test helpers ──────────────────────────────────────────────────────────────

const TENANT_ID   = '00000000-0000-0000-0000-000000000001';
const CONTACT_ID  = '00000000-0000-0000-0000-000000000030';
const KEY_ID      = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function makeService(prisma = makePrismaMock()) {
  return new OrganisationService(prisma as never);
}

// ════════════════════════════════════════════════════════════════════════════════
// createApiKey
// ════════════════════════════════════════════════════════════════════════════════

describe('OrganisationService.createApiKey', () => {
  it('generates a key that starts with ro_', async () => {
    const prisma = makePrismaMock();
    (prisma.apiKey.create as jest.Mock).mockResolvedValue({
      id: KEY_ID, name: 'Test', keyPrefix: 'ro_00000000_', contactId: null, createdAt: new Date(),
    });
    const svc = makeService(prisma);
    const result = await svc.createApiKey(TENANT_ID, { name: 'Test' });
    expect(result.key).toMatch(/^ro_/);
  });

  it('key embeds the first 8 hex chars of tenantId after ro_', async () => {
    const prisma = makePrismaMock();
    (prisma.apiKey.create as jest.Mock).mockResolvedValue({
      id: KEY_ID, name: 'T', keyPrefix: 'ro_00000000_', contactId: null, createdAt: new Date(),
    });
    const result = await makeService(prisma).createApiKey(TENANT_ID, { name: 'T' });
    const stripped = TENANT_ID.replace(/-/g, '').slice(0, 8);
    expect(result.key).toContain(`ro_${stripped}_`);
  });

  it('stores keyHash not plaintext key', async () => {
    const prisma = makePrismaMock();
    let capturedData: Record<string, unknown> = {};
    (prisma.apiKey.create as jest.Mock).mockImplementation(({ data }: { data: Record<string, unknown> }) => {
      capturedData = data;
      return Promise.resolve({ id: KEY_ID, name: 'T', keyPrefix: 'ro_00000000_', contactId: null, createdAt: new Date() });
    });
    const result = await makeService(prisma).createApiKey(TENANT_ID, { name: 'T' });
    const expectedHash = createHash('sha256').update(result.key).digest('hex');
    expect(capturedData['keyHash']).toBe(expectedHash);
    expect(capturedData['keyHash']).not.toBe(result.key);
  });

  it('keyPrefix is the first 12 chars of the plain key', async () => {
    const prisma = makePrismaMock();
    let storedPrefix = '';
    (prisma.apiKey.create as jest.Mock).mockImplementation(({ data }: { data: Record<string, unknown> }) => {
      storedPrefix = data['keyPrefix'] as string;
      return Promise.resolve({ id: KEY_ID, name: 'T', keyPrefix: storedPrefix, contactId: null, createdAt: new Date() });
    });
    const result = await makeService(prisma).createApiKey(TENANT_ID, { name: 'T' });
    expect(storedPrefix).toBe(result.key.slice(0, 12));
  });

  it('includes a "Store this key" message in the response', async () => {
    const prisma = makePrismaMock();
    (prisma.apiKey.create as jest.Mock).mockResolvedValue({
      id: KEY_ID, name: 'T', keyPrefix: 'ro_00000000_', contactId: null, createdAt: new Date(),
    });
    const result = await makeService(prisma).createApiKey(TENANT_ID, { name: 'T' });
    expect(result.message).toMatch(/store/i);
  });

  it('validates customerId belongs to tenant before creating', async () => {
    const prisma = makePrismaMock();
    (prisma.contact.findFirst as jest.Mock).mockResolvedValue(null);
    const svc = makeService(prisma);
    await expect(
      svc.createApiKey(TENANT_ID, { name: 'T', customerId: CONTACT_ID }),
    ).rejects.toThrow(BadRequestException);
  });

  it('sets contactId when valid customerId provided', async () => {
    const prisma = makePrismaMock();
    (prisma.contact.findFirst as jest.Mock).mockResolvedValue({ id: CONTACT_ID });
    let captured: Record<string, unknown> = {};
    (prisma.apiKey.create as jest.Mock).mockImplementation(({ data }: { data: Record<string, unknown> }) => {
      captured = data;
      return Promise.resolve({ id: KEY_ID, name: 'T', keyPrefix: 'ro_00000000_', contactId: CONTACT_ID, createdAt: new Date() });
    });
    await makeService(prisma).createApiKey(TENANT_ID, { name: 'T', customerId: CONTACT_ID });
    expect(captured['contactId']).toBe(CONTACT_ID);
  });

  it('creates key as isActive: true', async () => {
    const prisma = makePrismaMock();
    let captured: Record<string, unknown> = {};
    (prisma.apiKey.create as jest.Mock).mockImplementation(({ data }: { data: Record<string, unknown> }) => {
      captured = data;
      return Promise.resolve({ id: KEY_ID, name: 'T', keyPrefix: 'ro_00000000_', contactId: null, createdAt: new Date() });
    });
    await makeService(prisma).createApiKey(TENANT_ID, { name: 'T' });
    expect(captured['isActive']).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// listApiKeys
// ════════════════════════════════════════════════════════════════════════════════

describe('OrganisationService.listApiKeys', () => {
  it('queries only isActive keys for the tenant', async () => {
    const prisma = makePrismaMock();
    (prisma.apiKey.findMany as jest.Mock).mockResolvedValue([]);
    const svc = makeService(prisma);
    await svc.listApiKeys(TENANT_ID);
    const call = (prisma.apiKey.findMany as jest.Mock).mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(call?.where?.tenantId).toBe(TENANT_ID);
    expect(call?.where?.isActive).toBe(true);
  });

  it('maps contactId to customerId in response', async () => {
    const prisma = makePrismaMock();
    (prisma.apiKey.findMany as jest.Mock).mockResolvedValue([
      { id: KEY_ID, name: 'T', keyPrefix: 'ro_00000000_', contactId: CONTACT_ID, lastUsedAt: null, createdAt: new Date() },
    ]);
    const result = await makeService(prisma).listApiKeys(TENANT_ID);
    expect(result[0]?.customerId).toBe(CONTACT_ID);
  });

  it('does not expose keyHash in response', async () => {
    const prisma = makePrismaMock();
    (prisma.apiKey.findMany as jest.Mock).mockResolvedValue([
      { id: KEY_ID, name: 'T', keyPrefix: 'ro_00000000_', contactId: null, lastUsedAt: null, createdAt: new Date() },
    ]);
    const result = await makeService(prisma).listApiKeys(TENANT_ID);
    expect((result[0] as Record<string, unknown>)['keyHash']).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// revokeApiKey
// ════════════════════════════════════════════════════════════════════════════════

describe('OrganisationService.revokeApiKey', () => {
  it('sets isActive=false on the key', async () => {
    const prisma = makePrismaMock();
    (prisma.apiKey.findFirst as jest.Mock).mockResolvedValue({ id: KEY_ID, tenantId: TENANT_ID });
    let updateData: Record<string, unknown> = {};
    (prisma.apiKey.update as jest.Mock).mockImplementation(({ data }: { data: Record<string, unknown> }) => {
      updateData = data;
      return Promise.resolve({});
    });
    await makeService(prisma).revokeApiKey(TENANT_ID, KEY_ID);
    expect(updateData['isActive']).toBe(false);
  });

  it('throws NotFoundException when key does not belong to tenant', async () => {
    const prisma = makePrismaMock();
    (prisma.apiKey.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(makeService(prisma).revokeApiKey(TENANT_ID, KEY_ID)).rejects.toThrow(NotFoundException);
  });

  it('returns a revoked message on success', async () => {
    const prisma = makePrismaMock();
    (prisma.apiKey.findFirst as jest.Mock).mockResolvedValue({ id: KEY_ID });
    (prisma.apiKey.update as jest.Mock).mockResolvedValue({});
    const result = await makeService(prisma).revokeApiKey(TENANT_ID, KEY_ID);
    expect(result.message).toMatch(/revoked/i);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// validateDbApiKey
// ════════════════════════════════════════════════════════════════════════════════

describe('OrganisationService.validateDbApiKey', () => {
  const PLAIN_KEY = 'ro_00000000_abc123def456abc123def456abc12345';

  function expectedHash(key: string) {
    return createHash('sha256').update(key).digest('hex');
  }

  it('returns null for unknown key', async () => {
    const prisma = makePrismaMock();
    (prisma.apiKey.findUnique as jest.Mock).mockResolvedValue(null);
    const result = await makeService(prisma).validateDbApiKey(PLAIN_KEY);
    expect(result).toBeNull();
  });

  it('returns null for inactive key', async () => {
    const prisma = makePrismaMock();
    (prisma.apiKey.findUnique as jest.Mock).mockResolvedValue({
      id: KEY_ID, tenantId: TENANT_ID, contactId: null, isActive: false,
    });
    (prisma.apiKey.update as jest.Mock).mockResolvedValue({});
    const result = await makeService(prisma).validateDbApiKey(PLAIN_KEY);
    expect(result).toBeNull();
  });

  it('returns orgId for valid active key', async () => {
    const prisma = makePrismaMock();
    (prisma.apiKey.findUnique as jest.Mock).mockResolvedValue({
      id: KEY_ID, tenantId: TENANT_ID, contactId: null, isActive: true,
    });
    (prisma.apiKey.update as jest.Mock).mockResolvedValue({});
    const result = await makeService(prisma).validateDbApiKey(PLAIN_KEY);
    expect(result?.orgId).toBe(TENANT_ID);
  });

  it('includes customerId when key is customer-scoped', async () => {
    const prisma = makePrismaMock();
    (prisma.apiKey.findUnique as jest.Mock).mockResolvedValue({
      id: KEY_ID, tenantId: TENANT_ID, contactId: CONTACT_ID, isActive: true,
    });
    (prisma.apiKey.update as jest.Mock).mockResolvedValue({});
    const result = await makeService(prisma).validateDbApiKey(PLAIN_KEY);
    expect(result?.customerId).toBe(CONTACT_ID);
  });

  it('hashes the plain key before querying', async () => {
    const prisma = makePrismaMock();
    let queriedHash = '';
    (prisma.apiKey.findUnique as jest.Mock).mockImplementation(({ where }: { where: Record<string, unknown> }) => {
      queriedHash = where['keyHash'] as string;
      return Promise.resolve(null);
    });
    await makeService(prisma).validateDbApiKey(PLAIN_KEY);
    expect(queriedHash).toBe(expectedHash(PLAIN_KEY));
    expect(queriedHash).not.toBe(PLAIN_KEY);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// getCoworkContext
// ════════════════════════════════════════════════════════════════════════════════

describe('OrganisationService.getCoworkContext', () => {
  function makePrismaForContext() {
    const prisma = makePrismaMock();
    (prisma.tenant.findUnique as jest.Mock).mockResolvedValue({
      name: 'Acme OÜ', vatNumber: 'EE123', country: 'EE', locale: 'en',
    });
    (prisma.contact.findFirst as jest.Mock).mockResolvedValue({
      name: 'Acme OÜ', businessId: 'REG-001', vatNumber: 'EE123', iban: 'EE123456', email: 'billing@acme.ee',
    });
    (prisma.invoice.groupBy as jest.Mock).mockResolvedValue([]);
    (prisma.contact.findMany as jest.Mock).mockResolvedValue([]);
    return prisma;
  }

  it('returns a string that starts with the CONTEXT.md header', async () => {
    const result = await makeService(makePrismaForContext()).getCoworkContext(TENANT_ID);
    expect(result).toMatch(/^# My Invoice Platform Context/);
  });

  it('includes the company name', async () => {
    const result = await makeService(makePrismaForContext()).getCoworkContext(TENANT_ID);
    expect(result).toContain('Acme OÜ');
  });

  it('includes VAT number', async () => {
    const result = await makeService(makePrismaForContext()).getCoworkContext(TENANT_ID);
    expect(result).toContain('EE123');
  });

  it('includes registration number from seller contact', async () => {
    const result = await makeService(makePrismaForContext()).getCoworkContext(TENANT_ID);
    expect(result).toContain('REG-001');
  });

  it('includes Top customers section', async () => {
    const result = await makeService(makePrismaForContext()).getCoworkContext(TENANT_ID);
    expect(result).toContain('## Top customers');
  });

  it('lists top buyer names when invoices exist', async () => {
    const prisma = makePrismaForContext();
    (prisma.invoice.groupBy as jest.Mock).mockResolvedValue([
      { buyerId: CONTACT_ID, _count: { buyerId: 5 } },
    ]);
    (prisma.contact.findMany as jest.Mock).mockResolvedValue([
      { id: CONTACT_ID, name: 'Nokia Oy', vatNumber: 'FI99887766' },
    ]);
    const result = await makeService(prisma).getCoworkContext(TENANT_ID);
    expect(result).toContain('Nokia Oy');
  });

  it('includes IBAN in preferences section', async () => {
    const result = await makeService(makePrismaForContext()).getCoworkContext(TENANT_ID);
    expect(result).toContain('EE123456');
  });

  it('contains the Platform section with APP_BASE_URL', async () => {
    const result = await makeService(makePrismaForContext()).getCoworkContext(TENANT_ID);
    expect(result).toContain('## Platform');
    expect(result).toContain('localhost:4000');
  });
});
