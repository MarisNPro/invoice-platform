-- Migration 0001: initial schema + next_invoice_number() function
-- NOTE: Prisma migrate dev will manage versioned migrations;
--       this file is kept for reference / Docker init.

-- Enable pgcrypto for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Atomic invoice numbering ────────────────────────────────────────────────
-- Called inside a transaction; uses ON CONFLICT DO UPDATE to atomically
-- increment the counter and return the formatted invoice number.

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

  -- Format: INV-2026-00042
  v_number := p_prefix || '-' || p_year::TEXT || '-' || LPAD(v_next::TEXT, 5, '0');
  RETURN v_number;
END;
$$;
