/**
 * Phase 2 verification — seed ONE Supabase Auth test user and link it to the
 * existing "Dev Company OÜ" seed tenant so we can verify login → API →
 * tenant-scoped data end-to-end.
 *
 * SECURITY: reads the Supabase service-role key from the environment — it is
 * NEVER hardcoded here, so this file is safe to commit. Do not paste the key
 * into this file.
 *
 * Run (PowerShell):
 *   $env:SUPABASE_URL="https://ppzizluxjpjwjxpbdoid.supabase.co"
 *   $env:SUPABASE_SERVICE_ROLE_KEY="<service-role-key>"
 *   $env:TEST_USER_PASSWORD="Inv0ice-Test!2026"
 *   pnpm --filter @invoice/api exec dotenv -e ../../.env -- ts-node scripts/seed-test-user.ts
 *
 * Env:
 *   SUPABASE_URL                (required)
 *   SUPABASE_SERVICE_ROLE_KEY   (required — server-only secret)
 *   TEST_USER_EMAIL             (default test@invoiceplatform.local)
 *   TEST_USER_PASSWORD          (required)
 *   TEST_TENANT_ID              (default 00000000-0000-0000-0000-000000000001)
 *   TEST_USER_ROLE              (default ADMIN)
 *   DATABASE_URL                (required — for the supabaseUserId link)
 */
import axios from 'axios';
import { PrismaClient } from '@prisma/client';

async function main() {
  const supabaseUrl = required('SUPABASE_URL');
  const serviceKey = required('SUPABASE_SERVICE_ROLE_KEY');
  const password = required('TEST_USER_PASSWORD');
  const email = process.env.TEST_USER_EMAIL ?? 'test@invoiceplatform.local';
  const tenantId = process.env.TEST_TENANT_ID ?? '00000000-0000-0000-0000-000000000001';
  const role = process.env.TEST_USER_ROLE ?? 'ADMIN';

  const adminApi = `${supabaseUrl.replace(/\/$/, '')}/auth/v1/admin/users`;
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };

  // 1. Create the user with app_metadata (tenant_id + role live ONLY here —
  //    app_metadata is client-immutable; the multi-tenant security boundary).
  let userId: string;
  try {
    const { data } = await axios.post(
      adminApi,
      { email, password, email_confirm: true, app_metadata: { tenant_id: tenantId, role } },
      { headers },
    );
    userId = data.id;
    console.log(`✓ Created Supabase user ${email} (${userId})`);
  } catch (err) {
    // Already exists → look it up and patch app_metadata.
    const list = await axios.get(`${adminApi}?per_page=200`, { headers });
    const existing = (list.data.users as Array<{ id: string; email: string }>).find(
      (u) => u.email?.toLowerCase() === email.toLowerCase(),
    );
    if (!existing) throw err;
    userId = existing.id;
    await axios.put(
      `${adminApi}/${userId}`,
      { app_metadata: { tenant_id: tenantId, role }, password, email_confirm: true },
      { headers },
    );
    console.log(`✓ Updated existing Supabase user ${email} (${userId})`);
  }

  // 2. Link it on our User row so provisioning/identity is consistent.
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findFirst({ where: { tenantId } });
    if (!user) {
      console.warn(
        `⚠ No User row in tenant ${tenantId}. Reading tenant data will still ` +
          `work (the API trusts app_metadata.tenant_id), but no supabaseUserId ` +
          `was linked. Seed the dev tenant first (pnpm --filter @invoice/api db:seed).`,
      );
    } else {
      await prisma.user.update({ where: { id: user.id }, data: { supabaseUserId: userId } });
      console.log(`✓ Linked User ${user.email} → supabaseUserId ${userId}`);
    }
  } finally {
    await prisma.$disconnect();
  }

  console.log('\nDone. Log in at /login with:');
  console.log(`  email:    ${email}`);
  console.log(`  password: (the TEST_USER_PASSWORD you set)`);
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
