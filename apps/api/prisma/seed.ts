/**
 * Prisma seed — idempotent, safe to re-run.
 *
 * Creates:
 *  - next_invoice_number() PostgreSQL function
 *  - A "dev" tenant with FI/EE/LV/LT tax rates
 *  - One seller contact (own company) and one buyer contact
 *  - Sample product catalogue
 *  - One draft invoice with two lines
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ log: ['warn', 'error'] });

// ── Idempotent upsert helpers ─────────────────────────────────────────────────

const TENANT_SLUG = 'dev-tenant';
const TENANT_ID   = '00000000-0000-0000-0000-000000000001';

async function main() {
  console.log('🌱  Seeding…');

  // 1. Install custom PostgreSQL function (idempotent — uses CREATE OR REPLACE)
  await installFunctions();

  // 2. Tenant
  const tenant = await prisma.tenant.upsert({
    where: { slug: TENANT_SLUG },
    update: {},
    create: {
      id:        TENANT_ID,
      name:      'Dev Company OÜ',
      slug:      TENANT_SLUG,
      vatNumber: 'EE123456789',
      country:   'EE',
      locale:    'en',
    },
  });
  console.log(`  ✓ tenant: ${tenant.name} (${tenant.id})`);

  // 3. Tax rates — EU standard + zero
  const rates = await upsertTaxRates(tenant.id);
  console.log(`  ✓ ${rates.length} tax rates`);

  // 4. Bank account
  await prisma.bankAccount.upsert({
    where: { id: '00000000-0000-0000-0000-000000000010' },
    update: {},
    create: {
      id:        '00000000-0000-0000-0000-000000000010',
      tenantId:  tenant.id,
      iban:      'EE382200221020145685',
      bic:       'HABAEE2X',
      bankName:  'Swedbank AS',
      currency:  'EUR',
      isDefault: true,
    },
  });

  // 5. Seller contact (own company, same as tenant)
  const seller = await prisma.contact.upsert({
    where: { id: '00000000-0000-0000-0000-000000000020' },
    update: {},
    create: {
      id:           '00000000-0000-0000-0000-000000000020',
      tenantId:     tenant.id,
      name:         'Dev Company OÜ',
      businessId:   '12345678',
      vatNumber:    'EE123456789',
      country:      'EE',
      email:        'billing@devcompany.ee',
      isSupplier:   false,
      isCustomer:   false,
      addresses: {
        create: {
          type:       'BILLING',
          street:     'Tartu mnt 16',
          city:       'Tallinn',
          postalCode: '10115',
          country:    'EE',
          isDefault:  true,
        },
      },
    },
  });
  console.log(`  ✓ seller: ${seller.name}`);

  // 6. Buyer contact (Finnish customer)
  const buyer = await prisma.contact.upsert({
    where: { id: '00000000-0000-0000-0000-000000000030' },
    update: {},
    create: {
      id:         '00000000-0000-0000-0000-000000000030',
      tenantId:   tenant.id,
      name:       'Acme Oy',
      businessId: '1234567-8',
      vatNumber:  'FI12345678',
      country:    'FI',
      email:      'accounts@acme.fi',
      isCustomer: true,
      addresses: {
        create: {
          type:       'BILLING',
          street:     'Mannerheimintie 12',
          city:       'Helsinki',
          postalCode: '00100',
          country:    'FI',
          isDefault:  true,
        },
      },
    },
  });
  console.log(`  ✓ buyer: ${buyer.name}`);

  // 7. Products
  const standardRate = rates.find((r) => r.categoryCode === 'S' && r.name.includes('22%'));
  const products = await upsertProducts(tenant.id, standardRate?.id);
  console.log(`  ✓ ${products.length} products`);

  // 8. Sample draft invoice
  await upsertSampleInvoice(tenant.id, seller.id, buyer.id, rates, products);

  console.log('✅  Seed complete');
}

// ── next_invoice_number() function ───────────────────────────────────────────

async function installFunctions() {
  await prisma.$executeRaw`
    CREATE EXTENSION IF NOT EXISTS pgcrypto
  `;

  await prisma.$executeRaw`
    CREATE OR REPLACE FUNCTION next_invoice_number(
      p_tenant_id UUID,
      p_prefix    TEXT,
      p_year      INT
    ) RETURNS TEXT
    LANGUAGE plpgsql AS $$
    DECLARE
      v_next   INT;
      v_number TEXT;
    BEGIN
      INSERT INTO invoice_counters (id, tenant_id, prefix, year, last)
      VALUES (gen_random_uuid(), p_tenant_id, p_prefix, p_year, 1)
      ON CONFLICT (tenant_id, prefix, year)
      DO UPDATE SET last = invoice_counters.last + 1
      RETURNING last INTO v_next;

      v_number := p_prefix || '-' || p_year::TEXT || '-' || LPAD(v_next::TEXT, 5, '0');
      RETURN v_number;
    END;
    $$
  `;
  console.log('  ✓ next_invoice_number() installed');
}

// ── Tax rates ─────────────────────────────────────────────────────────────────

async function upsertTaxRates(tenantId: string) {
  const defs = [
    // Estonia
    { id: 'tr-ee-22', name: 'EE Standard 22%', rate: 0.22, categoryCode: 'S', isDefault: true },
    { id: 'tr-ee-09', name: 'EE Reduced 9%',   rate: 0.09, categoryCode: 'S' },
    // Finland
    { id: 'tr-fi-25', name: 'FI Standard 25.5%', rate: 0.255, categoryCode: 'S' },
    { id: 'tr-fi-14', name: 'FI Reduced 14%',    rate: 0.14,  categoryCode: 'S' },
    { id: 'tr-fi-10', name: 'FI Reduced 10%',    rate: 0.10,  categoryCode: 'S' },
    // Latvia
    { id: 'tr-lv-21', name: 'LV Standard 21%', rate: 0.21, categoryCode: 'S' },
    { id: 'tr-lv-12', name: 'LV Reduced 12%',  rate: 0.12, categoryCode: 'S' },
    // Lithuania
    { id: 'tr-lt-21', name: 'LT Standard 21%', rate: 0.21, categoryCode: 'S' },
    { id: 'tr-lt-09', name: 'LT Reduced 9%',   rate: 0.09, categoryCode: 'S' },
    // Zero / Exempt
    { id: 'tr-zero',  name: 'Zero rated (Z)',      rate: 0,    categoryCode: 'Z' },
    { id: 'tr-exempt',name: 'Exempt (E)',           rate: 0,    categoryCode: 'E' },
    { id: 'tr-ae',    name: 'Reverse charge (AE)', rate: 0,    categoryCode: 'AE' },
    { id: 'tr-ic',    name: 'Intra-community (K)', rate: 0,    categoryCode: 'K' },
  ] as const;

  return Promise.all(
    defs.map((d) =>
      prisma.taxRate.upsert({
        where:  { id: d.id },
        update: {},
        create: { id: d.id, tenantId, name: d.name, rate: d.rate, categoryCode: d.categoryCode, isDefault: ('isDefault' in d && d.isDefault) ?? false },
      }),
    ),
  );
}

// ── Products ──────────────────────────────────────────────────────────────────

async function upsertProducts(tenantId: string, defaultTaxRateId?: string) {
  const defs = [
    { id: 'prod-001', code: 'SRV-CONSULT', name: 'Consulting Services', unitPrice: 120.00, unit: 'HUR' },
    { id: 'prod-002', code: 'SRV-DEV',     name: 'Software Development', unitPrice: 95.00, unit: 'HUR' },
    { id: 'prod-003', code: 'LIC-ANNUAL',  name: 'Annual Software License', unitPrice: 1200.00, unit: 'ANN' },
    { id: 'prod-004', code: 'TRAIN-DAY',   name: 'Training Day',         unitPrice: 800.00, unit: 'DAY' },
  ];

  return Promise.all(
    defs.map((d) =>
      prisma.product.upsert({
        where:  { id: d.id },
        update: {},
        create: {
          id:         d.id,
          tenantId,
          code:       d.code,
          name:       d.name,
          unit:       d.unit,
          unitPrice:  d.unitPrice,
          isActive:   true,
          taxRateId:  defaultTaxRateId,
        },
      }),
    ),
  );
}

// ── Sample invoice ─────────────────────────────────────────────────────────────

async function upsertSampleInvoice(
  tenantId: string,
  sellerId: string,
  buyerId:  string,
  rates: Awaited<ReturnType<typeof upsertTaxRates>>,
  products: Awaited<ReturnType<typeof upsertProducts>>,
) {
  const exists = await prisma.invoice.findFirst({ where: { tenantId, number: 'INV-2026-00001' } });
  if (exists) {
    console.log('  ✓ sample invoice already exists, skipping');
    return;
  }

  const stdRate = rates.find((r) => r.categoryCode === 'S' && r.name.includes('22%'))!;
  const consultProd = products[0]!;
  const devProd     = products[1]!;

  const qty1 = 8;   const price1 = 120;  const net1 = qty1 * price1;
  const qty2 = 16;  const price2 = 95;   const net2 = qty2 * price2;
  const subtotal = net1 + net2;
  const taxAmt   = Math.round((subtotal * Number(stdRate.rate) + Number.EPSILON) * 100) / 100;

  await prisma.invoice.create({
    data: {
      id:           '00000000-0000-0000-0000-000000000100',
      tenantId,
      number:       'INV-2026-00001',
      type:         'INVOICE',
      status:       'DRAFT',
      sellerId,
      buyerId,
      issuedAt:     new Date('2026-05-01'),
      dueAt:        new Date('2026-05-31'),
      currencyCode: 'EUR',
      buyerReference: 'PO-2026-042',
      note:         'Payment within 30 days. Thank you for your business.',
      subtotal,
      taxAmount:    taxAmt,
      total:        subtotal + taxAmt,
      lines: {
        create: [
          {
            lineNumber:  1,
            productId:   consultProd.id,
            description: 'Consulting Services — May 2026',
            quantity:    qty1,
            unit:        'HUR',
            unitPrice:   price1,
            discount:    0,
            taxRateId:   stdRate.id,
            lineTotal:   net1,
            taxAmount:   Math.round(net1 * Number(stdRate.rate) * 100) / 100,
          },
          {
            lineNumber:  2,
            productId:   devProd.id,
            description: 'Software Development — Sprint 12',
            quantity:    qty2,
            unit:        'HUR',
            unitPrice:   price2,
            discount:    0,
            taxRateId:   stdRate.id,
            lineTotal:   net2,
            taxAmount:   Math.round(net2 * Number(stdRate.rate) * 100) / 100,
          },
        ],
      },
    },
  });

  // Bump invoice counter so next auto-assigned number is 00002
  await prisma.$executeRaw`
    INSERT INTO invoice_counters (id, tenant_id, prefix, year, last)
    VALUES (gen_random_uuid(), ${TENANT_ID}::uuid, 'INV', 2026, 1)
    ON CONFLICT (tenant_id, prefix, year) DO NOTHING
  `;

  console.log('  ✓ sample invoice INV-2026-00001 created');
}

main()
  .catch((err) => { console.error('Seed error:', err); process.exit(1); })
  .finally(async () => prisma.$disconnect());
