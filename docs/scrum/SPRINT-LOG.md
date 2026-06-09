# Sprint Log — Invoice Platform

**Last updated:** 2026-05-29
**Cadence:** 1-week sprints (Sprint 1 spanned 2 weeks of infrastructure setup).
**Cumulative test growth:** 0 → 69 → 87 → 96 → 105 → 111 → 121

> ⚠️ **Reconciliation note:** the per-sprint cumulative test counts below follow the
> agreed delivery sequence. The master plan's quality-gate snapshots were captured at
> slightly different points and record **W5 = 105** and **W6 = 111**; the sprint deltas
> here may differ by one sprint as a result. The **current authoritative total is 121**.

---

## Sprint 1 — Weeks 1–2 · Infrastructure
- **Goal:** Stand up the monorepo, database, auth scaffold, and local dev stack.
- **Completed:**
  - Turborepo + pnpm monorepo (4 apps + 7 packages)
  - Docker Compose (8 services, all healthy)
  - Prisma schema (25 models, EN 16931-aligned) + atomic `next_invoice_number()`
  - JWT guard + RBAC + multi-company scaffold *(originally Keycloak; since cut over to Supabase Auth)*
  - Company search foundations (FI/EE live; LV/LT *originally Elasticsearch, since replaced by Postgres `pg_trgm`*)
- **Tests added:** 0 → **0 cumulative** *(infrastructure sprint; feature tests begin Sprint 2)*
- **Quality gate:** No formal gate (pre-feature setup)
- **Velocity:** 21 pts

## Sprint 2 — Week 3 · AI + MCP
- **Goal:** Claude-native layer + frontend shell.
- **Completed:**
  - Prompt caching on all Claude calls; structured outputs on 6 extraction points
  - Dark dashboard + invoice creation form
  - Natural-language invoice creation (streaming)
  - MCP server — 9 tools + 3 prompts (port 4020); deep links + magic-link login; parallel 4-country search
- **Tests added:** 0 → **69 cumulative** (60 unit + 9 integration)
- **Quality gate:** 🟢 **PASSED 13/13** — 2026-05-28 (commit `8c656b1`)
- **Velocity:** 26 pts

## Sprint 3 — Week 4 · Email + Superadmin + Pricing
- **Goal:** Product completeness — sending, admin, monetization scaffolding.
- **Completed:**
  - Smart EN 16931 review; smart dunning (14 languages)
  - Email delivery (Resend + PDF attachment + BullMQ)
  - Client read-only API keys; `save_to_local`; CONTEXT.md generator; Cowork onboarding + compliance-block UI
  - Superadmin panel P1 (13 endpoints); pricing tiers (set via superadmin)
- **Tests added:** 69 → **87 cumulative**
- **Quality gate:** 🟢 **PASSED 7/8** — 2026-05-28
- **Velocity:** 31 pts

## Sprint 4 — Week 5 · Import pipeline
- **Goal:** Unique differentiator — invoice OCR + AI extraction.
- **Completed:**
  - Files API (upload once, reference by `file_id`)
  - Invoice import — Claude PDF extraction + confidence review UI
  - 5 Cowork scheduled task templates
- **Tests added:** 87 → **96 cumulative**
- **Quality gate:** 🟢 **PASSED 9/11** — 2026-05-28 *(plan gate snapshot: 105 tests; Fastify CVE WARN tracked to W8)*
- **Velocity:** 13 pts

## Sprint 5 — Week 6 · Cloud archive + Customer management
- **Goal:** Retention features.
- **Completed:**
  - Cloud archive OAuth (GDrive/Dropbox/OneDrive) + `CloudArchiveSyncJob`
  - Customer management UI (list + detail + history)
  - Invoice list with shareable URL filters
- **Tests added:** 96 → **105 cumulative**
- **Quality gate:** 🟢 **PASSED 9/11** — 2026-05-29 *(plan gate snapshot: 111 tests; PRH warm-search WARN — network variance)*
- **Velocity:** 21 pts

## Sprint 6 — Week 7 · Financial completeness
- **Goal:** Complete the real invoicing workflow.
- **Completed:**
  - Credit notes (type 381, linked to original)
  - Payment tracking (mark paid, partial; amount validated ≤ remaining balance)
  - EPC SEPA QR codes
  - Recurring invoices UI
- **Tests added:** 105 → **111 cumulative**
- **Quality gate:** 🟢 **PASSED** — 2026-05-29
- **Velocity:** 17 pts

## Sprint 7 — Week 8 · Production deploy 🟡 **IN PROGRESS**
- **Goal:** Ship to production and invite the first beta user.
- **Completed so far:**
  - Supabase EU Frankfurt — 15 migrations applied, 19 tables ✅
  - Upstash Redis Frankfurt connected ✅
  - **Migrated off Hetzner/Coolify → Railway** (config-as-code: `railway.api.json`, `railway.worker.json`) ✅
  - **Supabase Auth** cutover (Keycloak retired to a migration-only fallback) ✅
  - **Elasticsearch removed** — LV/LT search on Postgres `pg_trgm` ✅
  - API + Worker images built & pushed to GHCR (`:latest` + `:${{ github.sha }}`) ✅
  - CI/CD: Lint ✅ Test ✅ Build API ✅ Build Worker ✅; deploy hardened (R-06) ✅
  - Security hardening: secret fail-fast (US-006), tenant-scope fix (US-007), AES-256-GCM tokens (US-008) ✅
- **Pending:**
  - Set Railway env vars on api + worker (`ANTHROPIC_API_KEY`, strong `IMPERSONATION_SECRET` / `ARCHIVE_ENCRYPTION_KEY`) ❌
  - Vercel connection + frontend deploy ❌
  - Smoke tests + first beta invite ❌
- **Tests added:** 111 → **121 cumulative**
- **Quality gate:** ⏳ Pending (sprint open)
- **Velocity:** in progress

---

## Velocity Summary
| Sprint | Week(s) | Theme | Cumulative tests | Gate | Velocity |
|---|---|---|---|---|---|
| 1 | 1–2 | Infrastructure | 0 | — | 21 |
| 2 | 3 | AI + MCP | 69 | 13/13 ✅ | 26 |
| 3 | 4 | Email + Admin + Pricing | 87 | 7/8 ✅ | 31 |
| 4 | 5 | Import pipeline | 96 | 9/11 ✅ | 13 |
| 5 | 6 | Cloud archive + Customers | 105 | 9/11 ✅ | 21 |
| 6 | 7 | Financial completeness | 111 | PASSED ✅ | 17 |
| 7 | 8 | Production deploy | 121 | ⏳ open | — |

**Average velocity (completed sprints 2–6):** ~22 pts/sprint.
