-- ════════════════════════════════════════════════════════════════════════════
-- Tenant isolation RLS policies (defense-in-depth for the PostgREST/anon path).
--
-- RLS is ALREADY ENABLED on all public tables — this migration adds POLICIES
-- ONLY (no ENABLE ROW LEVEL SECURITY). No table uses FORCE RLS and the API
-- reaches Postgres on postgres/service_role, which BYPASSES RLS, so these
-- policies DO NOT affect the API path — the Prisma client extension is the
-- load-bearing isolation there. These policies only constrain the `authenticated`
-- (Supabase JWT / PostgREST) role.
--
-- Policies assume users."supabaseUserId" = auth.uid(). If that column is
-- unpopulated, current_tenant_id() returns NULL and every comparison is NULL
-- (false) — the policies FAIL SAFE (deny).
-- ════════════════════════════════════════════════════════════════════════════

-- Resolve the caller's tenant from their Supabase auth uid.
CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT "tenantId" FROM public.users WHERE "supabaseUserId" = auth.uid()
$$;

GRANT EXECUTE ON FUNCTION public.current_tenant_id() TO authenticated;

-- ── Direct tenant tables ("tenantId" = current tenant) ───────────────────────

CREATE POLICY tenant_isolation ON public.users
  FOR ALL TO authenticated
  USING ("tenantId" = public.current_tenant_id())
  WITH CHECK ("tenantId" = public.current_tenant_id());

CREATE POLICY tenant_isolation ON public.contacts
  FOR ALL TO authenticated
  USING ("tenantId" = public.current_tenant_id())
  WITH CHECK ("tenantId" = public.current_tenant_id());

CREATE POLICY tenant_isolation ON public.products
  FOR ALL TO authenticated
  USING ("tenantId" = public.current_tenant_id())
  WITH CHECK ("tenantId" = public.current_tenant_id());

CREATE POLICY tenant_isolation ON public.tax_rates
  FOR ALL TO authenticated
  USING ("tenantId" = public.current_tenant_id())
  WITH CHECK ("tenantId" = public.current_tenant_id());

CREATE POLICY tenant_isolation ON public.invoice_counters
  FOR ALL TO authenticated
  USING ("tenantId" = public.current_tenant_id())
  WITH CHECK ("tenantId" = public.current_tenant_id());

CREATE POLICY tenant_isolation ON public.invoices
  FOR ALL TO authenticated
  USING ("tenantId" = public.current_tenant_id())
  WITH CHECK ("tenantId" = public.current_tenant_id());

CREATE POLICY tenant_isolation ON public.payments
  FOR ALL TO authenticated
  USING ("tenantId" = public.current_tenant_id())
  WITH CHECK ("tenantId" = public.current_tenant_id());

CREATE POLICY tenant_isolation ON public.bank_accounts
  FOR ALL TO authenticated
  USING ("tenantId" = public.current_tenant_id())
  WITH CHECK ("tenantId" = public.current_tenant_id());

CREATE POLICY tenant_isolation ON public.audit_logs
  FOR ALL TO authenticated
  USING ("tenantId" = public.current_tenant_id())
  WITH CHECK ("tenantId" = public.current_tenant_id());

CREATE POLICY tenant_isolation ON public.import_archives
  FOR ALL TO authenticated
  USING ("tenantId" = public.current_tenant_id())
  WITH CHECK ("tenantId" = public.current_tenant_id());

CREATE POLICY tenant_isolation ON public.api_keys
  FOR ALL TO authenticated
  USING ("tenantId" = public.current_tenant_id())
  WITH CHECK ("tenantId" = public.current_tenant_id());

CREATE POLICY tenant_isolation ON public.recurring_invoices
  FOR ALL TO authenticated
  USING ("tenantId" = public.current_tenant_id())
  WITH CHECK ("tenantId" = public.current_tenant_id());

CREATE POLICY tenant_isolation ON public.cloud_archives
  FOR ALL TO authenticated
  USING ("tenantId" = public.current_tenant_id())
  WITH CHECK ("tenantId" = public.current_tenant_id());

-- ── tenants: the tenant row itself (id = current tenant) ─────────────────────

CREATE POLICY tenant_isolation ON public.tenants
  FOR ALL TO authenticated
  USING (id = public.current_tenant_id())
  WITH CHECK (id = public.current_tenant_id());

-- ── Child tables via parent join (no tenantId column) ────────────────────────

CREATE POLICY tenant_isolation ON public.invoice_lines
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.invoices i
    WHERE i.id = invoice_lines."invoiceId" AND i."tenantId" = public.current_tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.invoices i
    WHERE i.id = invoice_lines."invoiceId" AND i."tenantId" = public.current_tenant_id()
  ));

CREATE POLICY tenant_isolation ON public.invoice_vat_breakdowns
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.invoices i
    WHERE i.id = invoice_vat_breakdowns."invoiceId" AND i."tenantId" = public.current_tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.invoices i
    WHERE i.id = invoice_vat_breakdowns."invoiceId" AND i."tenantId" = public.current_tenant_id()
  ));

CREATE POLICY tenant_isolation ON public.attachments
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.invoices i
    WHERE i.id = attachments."invoiceId" AND i."tenantId" = public.current_tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.invoices i
    WHERE i.id = attachments."invoiceId" AND i."tenantId" = public.current_tenant_id()
  ));

CREATE POLICY tenant_isolation ON public.invoice_transmissions
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.invoices i
    WHERE i.id = invoice_transmissions."invoiceId" AND i."tenantId" = public.current_tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.invoices i
    WHERE i.id = invoice_transmissions."invoiceId" AND i."tenantId" = public.current_tenant_id()
  ));

CREATE POLICY tenant_isolation ON public.addresses
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.contacts c
    WHERE c.id = addresses."contactId" AND c."tenantId" = public.current_tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.contacts c
    WHERE c.id = addresses."contactId" AND c."tenantId" = public.current_tenant_id()
  ));

-- _prisma_migrations: intentionally no policy.
