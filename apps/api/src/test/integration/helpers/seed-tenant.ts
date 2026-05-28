/**
 * Minimal per-tenant fixture factory for integration tests.
 *
 * Creates the exact rows that InvoiceService.createFromApi() requires:
 *   - Tenant
 *   - Seller contact (isCustomer: false, isSupplier: false → "self")
 *   - Customer contact (isCustomer: true)
 *   - Default billing address for both contacts
 *   - Two tax rates: 21% and 0%
 *
 * Returns strongly-typed handles for use in assertions.
 */

import { randomUUID } from 'crypto';
import type { PrismaService } from '../../../prisma/prisma.service';

export interface TenantFixture {
  tenantId:    string;
  sellerId:    string;
  customerId:  string;
  taxRate21Id: string;
}

let fixtureCounter = 0;

export async function seedTenant(
  prisma: PrismaService,
  overrides: { tenantId?: string; slug?: string } = {},
): Promise<TenantFixture> {
  const n        = ++fixtureCounter;
  const tenantId = overrides.tenantId ?? randomUUID();
  const slug     = overrides.slug     ?? `test-org-${n}-${tenantId.slice(0, 8)}`;

  // ── Tenant ────────────────────────────────────────────────────────────────
  await prisma.tenant.create({
    data: {
      id:        tenantId,
      name:      `Test Org ${n}`,
      slug,
      country:   'EE',
      vatNumber: `EE10000000${n}`,
    },
  });

  // ── Seller (self-contact: isCustomer=false) ───────────────────────────────
  const seller = await prisma.contact.create({
    data: {
      tenantId,
      name:       `Seller Co ${n} OÜ`,
      businessId: `1234000${n}`,
      vatNumber:  `EE9990000${n}`,
      country:    'EE',
      email:      `billing@seller${n}.ee`,
      isCustomer: false,
      isSupplier: false,
      addresses: {
        create: {
          type:       'BILLING',
          street:     `Tartu mnt ${n}`,
          city:       'Tallinn',
          postalCode: '10115',
          country:    'EE',
          isDefault:  true,
        },
      },
    },
  });

  // ── Customer ──────────────────────────────────────────────────────────────
  const customer = await prisma.contact.create({
    data: {
      tenantId,
      name:       `Customer ${n} Oy`,
      businessId: `9876000${n}`,
      vatNumber:  `FI9876000${n}`,
      country:    'FI',
      email:      `ap@customer${n}.fi`,
      isCustomer: true,
      isSupplier: false,
      addresses: {
        create: {
          type:       'BILLING',
          street:     `Mannerheimintie ${n * 10}`,
          city:       'Helsinki',
          postalCode: '00100',
          country:    'FI',
          isDefault:  true,
        },
      },
    },
  });

  // ── Tax rates ─────────────────────────────────────────────────────────────
  const taxRate21 = await prisma.taxRate.create({
    data: {
      tenantId,
      name:        'Standard VAT 21%',
      rate:        0.21,
      categoryCode: 'S',
      isDefault:   true,
    },
  });

  await prisma.taxRate.create({
    data: {
      tenantId,
      name:        'Zero VAT',
      rate:        0.00,
      categoryCode: 'Z',
      isDefault:   false,
    },
  });

  return {
    tenantId,
    sellerId:    seller.id,
    customerId:  customer.id,
    taxRate21Id: taxRate21.id,
  };
}
