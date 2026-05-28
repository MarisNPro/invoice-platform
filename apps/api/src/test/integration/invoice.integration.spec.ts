/**
 * Integration tests — real PostgreSQL via Testcontainers.
 *
 * Suite 1 — Invoice creation
 *   ✓ Invoice persisted with correct number format
 *   ✓ VAT breakdown row created
 *   ✓ Audit log row created
 *
 * Suite 2 — Tenant isolation
 *   ✓ findAll(orgA) returns only orgA invoices
 *   ✓ findAll(orgB) returns only orgB invoices
 *   ✓ Cross-tenant leak: 0 docs
 *
 * Suite 3 — Concurrent invoice numbering
 *   ✓ 10 simultaneous creates → 10 unique numbers
 *   ✓ Numbers are sequential with no gaps
 *
 * Container startup is shared across all three suites to save time.
 */

import 'reflect-metadata';
import { PgContainerHelper } from './helpers/pg-container';
import { seedTenant, type TenantFixture } from './helpers/seed-tenant';
import { InvoiceService } from '../../invoice/invoice.service';
import { CreateInvoiceBodyDto } from '../../invoice/dto/create-invoice.dto';

// ── Shared state ──────────────────────────────────────────────────────────────

let helper: PgContainerHelper;
let service: InvoiceService;

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  helper  = await PgContainerHelper.start();
  service = new InvoiceService(helper.prisma, { enqueueInvoiceEmail: async () => '' } as never);
}, 120_000); // allow 2 min for container pull + migration

afterAll(async () => {
  await helper.stop();
}, 30_000);

// Wipe data between suites so each starts clean
beforeEach(async () => {
  await helper.truncateAll();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeInvoiceDto(
  fixture: TenantFixture,
  overrides: Partial<CreateInvoiceBodyDto> = {},
): CreateInvoiceBodyDto {
  const dto = new CreateInvoiceBodyDto();
  dto.customerId      = fixture.customerId;
  dto.currency        = 'EUR';
  dto.issueDate       = '2024-01-15';
  dto.dueDate         = '2024-02-15';
  dto.lines           = [
    {
      itemName:       'Consulting services',
      quantity:       10,
      unitPrice:      100,
      vatRatePercent: 21,
      unitCode:       'HUR',
    },
  ];
  Object.assign(dto, overrides);
  return dto;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 1 — Invoice creation
// ═══════════════════════════════════════════════════════════════════════════════

describe('Suite 1 — Invoice creation', () => {
  let fixture: TenantFixture;

  beforeEach(async () => {
    fixture = await seedTenant(helper.prisma);
  });

  it('persists invoice to DB and assigns sequential number', async () => {
    const result = await service.createFromApi(
      makeInvoiceDto(fixture),
      fixture.tenantId,
    );

    // ── Number format: INV-{YEAR}-{SEQ} ───────────────────────────────────
    expect(result.number).toMatch(/^INV-\d{4}-\d{5}$/);
    expect(result.number).toBe('INV-2024-00001');

    // ── Invoice exists in DB ──────────────────────────────────────────────
    const fromDb = await helper.prisma.invoice.findUniqueOrThrow({
      where: { id: result.id },
    });
    expect(fromDb.number).toBe('INV-2024-00001');
    expect(fromDb.status).toBe('DRAFT');
    expect(fromDb.tenantId).toBe(fixture.tenantId);
    expect(Number(fromDb.subtotal)).toBe(1000);
    expect(Number(fromDb.taxAmount)).toBeCloseTo(210, 2);
    expect(Number(fromDb.total)).toBeCloseTo(1210, 2);
  });

  it('creates a VAT breakdown row for every distinct VAT rate', async () => {
    // Two distinct rates — should produce two breakdown rows
    const dto = makeInvoiceDto(fixture, {
      lines: [
        {
          itemName: 'Consulting (21%)',
          quantity: 5, unitPrice: 100, vatRatePercent: 21, unitCode: 'HUR',
        },
        {
          itemName: 'Travel (0%)',
          quantity: 1, unitPrice: 200, vatRatePercent: 0, unitCode: 'PCS',
        },
      ],
    });

    const result = await service.createFromApi(dto, fixture.tenantId);

    const breakdowns = await helper.prisma.invoiceVatBreakdown.findMany({
      where: { invoiceId: result.id },
      orderBy: { vatRatePercent: 'asc' },
    });

    expect(breakdowns).toHaveLength(2);

    // 0% row
    const zeroRow = breakdowns[0]!;
    expect(Number(zeroRow.vatRatePercent)).toBe(0);
    expect(Number(zeroRow.taxableAmount)).toBe(200);
    expect(Number(zeroRow.taxAmount)).toBe(0);
    expect(zeroRow.vatCategoryCode).toBe('Z');

    // 21% row
    const stdRow = breakdowns[1]!;
    expect(Number(stdRow.vatRatePercent)).toBe(21);
    expect(Number(stdRow.taxableAmount)).toBe(500);
    expect(Number(stdRow.taxAmount)).toBeCloseTo(105, 2);
    expect(stdRow.vatCategoryCode).toBe('S');
  });

  it('writes an audit log row with action invoice.created', async () => {
    const result = await service.createFromApi(
      makeInvoiceDto(fixture),
      fixture.tenantId,
      'keycloak-sub-abc123',
      '127.0.0.1',
    );

    const audit = await helper.prisma.auditLog.findFirst({
      where: { invoiceId: result.id },
    });

    expect(audit).not.toBeNull();
    expect(audit!.action).toBe('invoice.created');
    expect(audit!.tenantId).toBe(fixture.tenantId);
    expect(audit!.userId).toBe('keycloak-sub-abc123');
    expect(audit!.ipAddress).toBe('127.0.0.1');

    const payload = audit!.payload as Record<string, unknown>;
    expect(payload['number']).toBe('INV-2024-00001');
    expect(Number(payload['lineExtensionAmount'])).toBe(1000);
    expect(Number(payload['taxAmount'])).toBeCloseTo(210, 2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 2 — Tenant isolation
// ═══════════════════════════════════════════════════════════════════════════════

describe('Suite 2 — Tenant isolation', () => {
  let orgA: TenantFixture;
  let orgB: TenantFixture;

  beforeEach(async () => {
    [orgA, orgB] = await Promise.all([
      seedTenant(helper.prisma),
      seedTenant(helper.prisma),
    ]);

    // Create 2 invoices for org A, 1 invoice for org B
    await service.createFromApi(makeInvoiceDto(orgA), orgA.tenantId);
    await service.createFromApi(makeInvoiceDto(orgA), orgA.tenantId);
    await service.createFromApi(makeInvoiceDto(orgB), orgB.tenantId);
  });

  it('findAll(orgA) returns only org A invoices', async () => {
    const result = await service.findAll(orgA.tenantId, undefined, 1, 50);
    const invoices = result.data;

    expect(invoices.length).toBe(2);

    for (const inv of invoices) {
      expect(inv.tenantId).toBe(orgA.tenantId);
      expect(inv.tenantId).not.toBe(orgB.tenantId);
    }
  });

  it('findAll(orgB) returns only org B invoices', async () => {
    const result = await service.findAll(orgB.tenantId, undefined, 1, 50);
    const invoices = result.data;

    expect(invoices.length).toBe(1);
    expect(invoices[0]!.tenantId).toBe(orgB.tenantId);
  });

  it('org A query never leaks org B invoice IDs', async () => {
    const resultB = await service.findAll(orgB.tenantId, undefined, 1, 50);
    const orgBIds = new Set(resultB.data.map((i) => i.id));

    const resultA = await service.findAll(orgA.tenantId, undefined, 1, 50);
    const orgAIds = resultA.data.map((i) => i.id);

    for (const id of orgAIds) {
      expect(orgBIds.has(id)).toBe(false);
    }
  });

  it('invoice counters are isolated: each org starts at 00001', async () => {
    // Both orgs created invoices fresh; counters are tenant-scoped.
    const resultA = await service.findAll(orgA.tenantId, undefined, 1, 50);
    const resultB = await service.findAll(orgB.tenantId, undefined, 1, 50);

    const aNumbers = resultA.data.map((i) => i.number).sort();
    const bNumbers = resultB.data.map((i) => i.number).sort();

    // Both start at 00001 — no cross-tenant counter sharing
    expect(aNumbers).toContain('INV-2024-00001');
    expect(bNumbers).toContain('INV-2024-00001');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 3 — Concurrent invoice numbering
// ═══════════════════════════════════════════════════════════════════════════════

describe('Suite 3 — Concurrent invoice numbering', () => {
  let fixture: TenantFixture;

  beforeEach(async () => {
    fixture = await seedTenant(helper.prisma);
  });

  it('10 simultaneous creates produce 10 unique, sequential numbers', async () => {
    const N = 10;

    // Fire all creates in parallel — the DB function must handle the contention
    const results = await Promise.all(
      Array.from({ length: N }, () =>
        service.createFromApi(makeInvoiceDto(fixture), fixture.tenantId),
      ),
    );

    const numbers = results.map((r) => r.number).sort();

    // ── All unique ────────────────────────────────────────────────────────
    const unique = new Set(numbers);
    expect(unique.size).toBe(N);

    // ── All match pattern ─────────────────────────────────────────────────
    for (const n of numbers) {
      expect(n).toMatch(/^INV-2024-\d{5}$/);
    }

    // ── Sequential, no gaps ───────────────────────────────────────────────
    // Extract sequence numbers and sort numerically
    const seqs = numbers
      .map((n) => parseInt(n.split('-')[2]!, 10))
      .sort((a, b) => a - b);

    expect(seqs[0]).toBe(1);
    expect(seqs[seqs.length - 1]).toBe(N);

    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]! - seqs[i - 1]!).toBe(1); // no gaps
    }
  });

  it('concurrent creates under two tenants do not share sequence numbers', async () => {
    const fixtureB = await seedTenant(helper.prisma);

    // 5 concurrent creates per tenant
    const [resultsA, resultsB] = await Promise.all([
      Promise.all(
        Array.from({ length: 5 }, () =>
          service.createFromApi(makeInvoiceDto(fixture),  fixture.tenantId),
        ),
      ),
      Promise.all(
        Array.from({ length: 5 }, () =>
          service.createFromApi(makeInvoiceDto(fixtureB), fixtureB.tenantId),
        ),
      ),
    ]);

    const aSeqs = resultsA.map((r) => parseInt(r.number.split('-')[2]!, 10));
    const bSeqs = resultsB.map((r) => parseInt(r.number.split('-')[2]!, 10));

    // Both tenants have their own 1-5 sequence
    expect(new Set(aSeqs).size).toBe(5);
    expect(new Set(bSeqs).size).toBe(5);
    expect(Math.max(...aSeqs)).toBe(5);
    expect(Math.max(...bSeqs)).toBe(5);
  });
});
