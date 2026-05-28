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

const TENANT_SLUG            = 'dev-tenant';
const TENANT_ID              = '00000000-0000-0000-0000-000000000001';
const SUPERADMIN_KEYCLOAK_ID = '00000000-0000-0000-0000-000000000099';

/** Return a Date that is `n` calendar days before today (time zeroed to UTC midnight). */
function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

async function main() {
  console.log('🌱  Seeding…');

  // Dynamic demo dates — always 14 days ago → 7 days overdue
  const issueDate = daysAgo(14);
  const dueDate   = daysAgo(7);

  // 1. Install custom PostgreSQL function (idempotent — uses CREATE OR REPLACE)
  await installFunctions();

  // 2. Tenant
  const tenant = await prisma.tenant.upsert({
    where:  { slug: TENANT_SLUG },
    update: { plan: 'STARTER', monthlyAiSpendLimit: 500 },
    create: {
      id:                  TENANT_ID,
      name:                'Dev Company OÜ',
      slug:                TENANT_SLUG,
      vatNumber:           'EE123456789',
      country:             'EE',
      locale:              'en',
      plan:                'STARTER',
      monthlyAiSpendLimit: 500,    // €5.00/month — STARTER tier
    },
  });

  // Extra example tenants (one per plan tier for admin dashboard demo)
  await prisma.tenant.upsert({
    where:  { slug: 'demo-free' },
    update: {},
    create: {
      id:                  '00000000-0000-0000-0000-000000000002',
      name:                'Free Demo Ltd',
      slug:                'demo-free',
      country:             'LV',
      locale:              'lv',
      plan:                'FREE',
      monthlyAiSpendLimit: 200,    // €2.00/month
      monthlyAiSpendCents: 187,    // 93% used — demo high-usage scenario
    },
  });

  await prisma.tenant.upsert({
    where:  { slug: 'demo-business' },
    update: {},
    create: {
      id:                  '00000000-0000-0000-0000-000000000003',
      name:                'Business Corp AS',
      slug:                'demo-business',
      country:             'LT',
      locale:              'lt',
      plan:                'BUSINESS',
      monthlyAiSpendLimit: 2000,   // €20.00/month
      monthlyAiSpendCents: 340,    // €3.40 used — healthy margin
    },
  });

  await prisma.tenant.upsert({
    where:  { slug: 'demo-professional' },
    update: {},
    create: {
      id:                  '00000000-0000-0000-0000-000000000004',
      name:                'Professional GmbH',
      slug:                'demo-professional',
      country:             'DE',
      locale:              'de',
      plan:                'PROFESSIONAL',
      monthlyAiSpendLimit: -1,     // unlimited
      monthlyAiSpendCents: 5820,   // €58.20 used this month
    },
  });
  console.log(`  ✓ tenant: ${tenant.name} (${tenant.id})`);

  // 3. Superadmin user (keycloakId matches infra/keycloak/realms/invoice-platform.json)
  await prisma.user.upsert({
    where:  { keycloakId: SUPERADMIN_KEYCLOAK_ID },
    update: { isActive: true, firstName: 'Super', lastName: 'Admin' },
    create: {
      id:         '00000000-0000-0000-0000-000000000099',
      tenantId:   TENANT_ID,
      keycloakId: SUPERADMIN_KEYCLOAK_ID,
      email:      'superadmin@invoiceplatform.local',
      name:       'Super Admin',
      firstName:  'Super',
      lastName:   'Admin',
      role:       'ADMIN',
      isActive:   true,
    },
  });
  console.log('  ✓ superadmin user seeded (superadmin@invoiceplatform.local)');

  // 4. Tax rates — EU standard + zero
  const rates = await upsertTaxRates(tenant.id);
  console.log(`  ✓ ${rates.length} tax rates`);

  // 5. Bank account
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

  // 6. Seller contact (own company, same as tenant)
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

  // 7. Buyer contact (Finnish customer)
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

  // 8. Products
  const standardRate = rates.find((r) => r.categoryCode === 'S' && r.name.includes('22%'));
  const products = await upsertProducts(tenant.id, standardRate?.id);
  console.log(`  ✓ ${products.length} products`);

  // 9. Fix any existing invoices with stale hard-coded dates (pre-2026)
  const { count: fixed } = await prisma.invoice.updateMany({
    where: { tenantId: tenant.id, issuedAt: { lt: new Date('2026-01-01') } },
    data:  { issuedAt: issueDate, dueAt: dueDate },
  });
  if (fixed > 0) console.log(`  ✓ updated ${fixed} stale invoice date(s)`);

  // 10. Sample draft invoice (creates or refreshes dates)
  await upsertSampleInvoice(tenant.id, seller.id, buyer.id, rates, products, issueDate, dueDate);

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
      INSERT INTO invoice_counters (id, "tenantId", prefix, year, last)
      VALUES (gen_random_uuid(), p_tenant_id, p_prefix, p_year, 1)
      ON CONFLICT ("tenantId", prefix, year)
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
    { id: '00000000-0000-0000-0001-000000000001', name: 'EE Standard 22%', rate: 0.22, categoryCode: 'S', isDefault: true },
    { id: '00000000-0000-0000-0001-000000000002', name: 'EE Reduced 9%',   rate: 0.09, categoryCode: 'S' },
    // Finland
    { id: '00000000-0000-0000-0001-000000000003', name: 'FI Standard 25.5%', rate: 0.255, categoryCode: 'S' },
    { id: '00000000-0000-0000-0001-000000000004', name: 'FI Reduced 14%',    rate: 0.14,  categoryCode: 'S' },
    { id: '00000000-0000-0000-0001-000000000005', name: 'FI Reduced 10%',    rate: 0.10,  categoryCode: 'S' },
    // Latvia
    { id: '00000000-0000-0000-0001-000000000006', name: 'LV Standard 21%', rate: 0.21, categoryCode: 'S' },
    { id: '00000000-0000-0000-0001-000000000007', name: 'LV Reduced 12%',  rate: 0.12, categoryCode: 'S' },
    // Lithuania
    { id: '00000000-0000-0000-0001-000000000008', name: 'LT Standard 21%', rate: 0.21, categoryCode: 'S' },
    { id: '00000000-0000-0000-0001-000000000009', name: 'LT Reduced 9%',   rate: 0.09, categoryCode: 'S' },
    // Zero / Exempt
    { id: '00000000-0000-0000-0001-000000000010', name: 'Zero rated (Z)',      rate: 0,    categoryCode: 'Z' },
    { id: '00000000-0000-0000-0001-000000000011', name: 'Exempt (E)',           rate: 0,    categoryCode: 'E' },
    { id: '00000000-0000-0000-0001-000000000012', name: 'Reverse charge (AE)', rate: 0,    categoryCode: 'AE' },
    { id: '00000000-0000-0000-0001-000000000013', name: 'Intra-community (K)', rate: 0,    categoryCode: 'K' },
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
    { id: '00000000-0000-0000-0002-000000000001', code: 'SRV-CONSULT', name: 'Consulting Services',     unitPrice: 120.00,   unit: 'HUR' },
    { id: '00000000-0000-0000-0002-000000000002', code: 'SRV-DEV',     name: 'Software Development',   unitPrice: 95.00,    unit: 'HUR' },
    { id: '00000000-0000-0000-0002-000000000003', code: 'LIC-ANNUAL',  name: 'Annual Software License', unitPrice: 1200.00, unit: 'ANN' },
    { id: '00000000-0000-0000-0002-000000000004', code: 'TRAIN-DAY',   name: 'Training Day',            unitPrice: 800.00,  unit: 'DAY' },
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
  tenantId:  string,
  sellerId:  string,
  buyerId:   string,
  rates:     Awaited<ReturnType<typeof upsertTaxRates>>,
  products:  Awaited<ReturnType<typeof upsertProducts>>,
  issueDate: Date,
  dueDate:   Date,
) {
  const exists = await prisma.invoice.findFirst({ where: { tenantId, number: 'INV-2026-00001' } });
  if (exists) {
    await prisma.invoice.update({
      where: { id: exists.id },
      data:  { issuedAt: issueDate, dueAt: dueDate },
    });
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    console.log(`  ✓ sample invoice dates → ${fmt(issueDate)} / due ${fmt(dueDate)}`);
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
      issuedAt:     issueDate,
      dueAt:        dueDate,
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
    INSERT INTO invoice_counters (id, "tenantId", prefix, year, last)
    VALUES (gen_random_uuid(), ${TENANT_ID}::uuid, 'INV', 2026, 1)
    ON CONFLICT ("tenantId", prefix, year) DO NOTHING
  `;

  console.log('  ✓ sample invoice INV-2026-00001 created');
}

main()
  .catch((err) => { console.error('Seed error:', err); process.exit(1); })
  .finally(async () => prisma.$disconnect());
