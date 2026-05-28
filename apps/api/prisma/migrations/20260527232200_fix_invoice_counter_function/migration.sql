-- ============================================================
-- Migration 0004: fix next_invoice_number() column references
--
-- The original functions migration (0002) used unquoted identifiers
-- (tenant_id, prefix, year) in the INSERT and ON CONFLICT clauses.
-- Prisma generates column names in camelCase with quotes ("tenantId"),
-- so the unquoted references resolve to lower-cased names that do not
-- exist.  This migration replaces the function with the correct
-- quoted-identifier form.  CREATE OR REPLACE is idempotent.
-- ============================================================

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

  -- Format: INV-2026-00042  (5-digit zero-padded sequence)
  v_number := p_prefix || '-' || p_year::TEXT || '-' || LPAD(v_next::TEXT, 5, '0');
  RETURN v_number;
END;
$$;
