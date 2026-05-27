-- ============================================================
-- Migration 0002: custom PostgreSQL functions
-- ============================================================

-- Ensure pgcrypto is available for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── next_invoice_number() ────────────────────────────────────────────────────
-- Atomically increments the counter for (tenant, prefix, year) and returns a
-- formatted invoice number like "INV-2026-00042".
--
-- Uses INSERT … ON CONFLICT DO UPDATE so the increment and SELECT are a single
-- atomic operation — no race conditions under concurrent requests.

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

  -- Format: INV-2026-00042  (5-digit zero-padded sequence)
  v_number := p_prefix || '-' || p_year::TEXT || '-' || LPAD(v_next::TEXT, 5, '0');
  RETURN v_number;
END;
$$;
