# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Invoice Platform — Claude Instructions

## Stack
- NestJS + Fastify (API) · Next.js 14 (web) · BullMQ (worker)
- PostgreSQL via Prisma · Redis (Upstash)
- Hosting: **Supabase** (Postgres + Auth, Frankfurt) · **Vercel** (web, fra1) · **Railway** (API + worker, EU West)
- Retired / do not reintroduce: **Keycloak**, **Hetzner + Coolify**, **Elasticsearch**, **AWS**. (Elasticsearch removed from all app code — LV/LT search is Postgres `pg_trgm`; local/infra ES containers pending teardown in ticket C.)
- All data stays in the EU.

## Critical rules
1. Every Prisma query MUST have where: { tenantId } — no exceptions (sole documented exception: the global national company register)
2. Never use console.log — use NestJS Logger
3. All new endpoints need DTO with @IsString(), @IsUUID() etc
4. Run pnpm turbo run typecheck after every change
5. Test count must not decrease — add tests for new features

## Authentication (Supabase Auth)
> Status: Supabase Auth is the active provider (Phase 4 cutover). The API boots
> Supabase-only; Keycloak is optional/legacy and being retired.
- Provider: Supabase Auth (Keycloak retired)
- JWT: validate Supabase JWT, extract user id and tenantId
- EVERY endpoint validates the Supabase JWT (global guard; opt out only via @Public())
- EVERY query still filters by tenantId — auth does NOT replace tenant isolation
- Never trust tenantId from request body, query, or header — only from the validated JWT

## Module pattern
apps/api/src/modules/[name]/
  [name].controller.ts  — routes only, no business logic
  [name].service.ts     — all business logic
  [name].module.ts      — imports and providers
  [name].dto.ts         — request/response DTOs
  [name].controller.spec.ts — tests

## EN 16931 compliance
- Invoice amounts: always Decimal(15,2)
- VAT breakdown: required BG-22 + BG-23 groups
- Seller/buyer fields: snapshotted at invoice creation
- Invoice numbers: atomic via next_invoice_number() — never app-level

## Current status
- Phase 1 Week 8 — production deploy in progress
- 121 tests passing
- Quality gates: W3 13/13, W4 7/8, W5 9/11, W6 9/11, W7 6/11 fixed

## Active risks
- Peppol specialist not hired — post job NOW
- No Stripe yet — set plans via superadmin for beta

---

## Commands

```bash
# Root (runs all workspaces via Turborepo)
pnpm build          # build all packages/apps
pnpm dev            # start all in dev mode
pnpm typecheck      # typecheck all
pnpm test           # run all tests
pnpm lint           # lint all
pnpm format         # prettier all

# Target a single package
pnpm --filter @invoice/api test
pnpm --filter @invoice/web typecheck

# API — database
pnpm --filter @invoice/api db:migrate:dev   # create + apply a new dev migration
pnpm --filter @invoice/api db:generate      # regenerate Prisma client after schema change
pnpm --filter @invoice/api db:seed          # seed demo data
pnpm --filter @invoice/api db:studio        # open Prisma Studio

# API — integration tests (spin up real containers via Testcontainers)
cd apps/api && pnpm test:integration

# API — run a single test file
cd apps/api && pnpm test -- --testPathPattern=invoice-ubl

# API — company register sync (LV/LT CSV → Postgres company_register, pg_trgm)
cd apps/api && pnpm sync:lv
cd apps/api && pnpm sync:lt

# Docker (local infra: Postgres, Redis, Elasticsearch)
pnpm docker:up
pnpm docker:down
pnpm docker:logs
```

## Monorepo Layout

```
apps/
  api/          NestJS 11 + Fastify — REST API, port 4000
  web/          Next.js 16 App Router — frontend, port 3000
  worker/       BullMQ consumer process — email + archive jobs
  doc-engine/   Library: PDF generation (pdf-lib) + UBL XML output
  mcp-server/   MCP server — 9 tools, 3 prompts, SSE transport
packages/
  shared-types/ TypeScript types shared across all apps
  ubl-builder/  UBL 2.1 XML builder (EN 16931 compliant)
  vat-engine/   VAT rate calculation
  en16931/      EN 16931 business rule validators
  ui/           Shared React components (Tailwind)
  i18n/         Translation strings
infra/
  deploy/       docker-compose.prod.yml, .env.production.example
  keycloak/     Realm export JSON
```

## Architecture

### Multi-tenancy
Every authenticated request carries a `tenantId` claim in the validated JWT. `CompositeAuthGuard` (`apps/api/src/auth/composite-auth.guard.ts`) verifies the token and attaches the user to `request.user`. Every DB query must scope to `tenantId`. In development, skip auth entirely by sending `x-dev-tenant-id: <uuid>` — this injects a synthetic admin user with all roles.

### Auth
`AuthModule` registers `CompositeAuthGuard` and `RolesGuard` as global `APP_GUARD`s — all routes are protected by default. Add `@Public()` decorator to opt a route out. `CompositeAuthGuard` accepts a valid Supabase JWT (primary) or a legacy Keycloak JWT (retiring), then `RolesGuard` authorizes. JWKS keys are fetched from the provider and cached.

### Queue / Worker split
The API enqueues jobs via `MailQueueService` (`apps/api/src/queue/queue.service.ts`) into two BullMQ queues:
- `invoice-email` — send invoice emails
- `cloud-archive-sync` — upload to cloud storage (Google Drive / Dropbox / OneDrive)

The `apps/worker` process consumes both queues. Queue constants are shared in `apps/api/src/queue/queue.constants.ts`.

### Company registry search
Country-specific adapters in `CompanyService`:
- **FI** — PRH open data API (live HTTP)
- **EE** — Ariregister API (live HTTP)
- **LV / LT** — Postgres `company_register` table with a `pg_trgm` GIN index; `name % query` trigram similarity search, pre-synced from government CSV via `sync:lv` / `sync:lt`

Redis caches all search results for 600 s. Cache key is normalised to lowercase.

### Invoice numbering
Sequential invoice numbers use a PL/pgSQL function `next_invoice_number()` (migration `20260527000001_functions`) for atomic, gap-free numbering per tenant per year.

### Document generation
`apps/doc-engine` produces both PDF (pdf-lib) and UBL 2.1 XML. The API's `InvoicePdfService` and `InvoiceUblService` delegate to this package.

### Rate limiting
Global: 120 requests / 60 s per IP (Fastify-aware `FastifyThrottlerGuard`). The `/invoices/parse` endpoint overrides to 10 req / 60 s because each call invokes the Anthropic API.

## Database

Prisma schema: `apps/api/prisma/schema.prisma`

Two connection strings are required:
- `DATABASE_URL` — pooled (PgBouncer / Supabase transaction pooler, port 6543) — used at runtime
- `DIRECT_URL` — non-pooled (port 5432) — used by `prisma migrate` only

After editing `schema.prisma`, run `db:generate` before building. In production, the API container runs `prisma migrate deploy` on startup.

## Environment

Copy `infra/deploy/.env.production.example` → `.env` and fill in values. The API loads `.env.local` then `.env` from the repo root (two levels up from `apps/api`).

Key variables: `DATABASE_URL`, `DIRECT_URL`, `REDIS_URL`, `KEYCLOAK_URL`, `KEYCLOAK_REALM`, `KEYCLOAK_CLIENT_ID`, `KEYCLOAK_CLIENT_SECRET`, `S3_ENDPOINT`, `S3_BUCKET`, `RESEND_API_KEY`, `ANTHROPIC_API_KEY`.

## Deployment

- **Web** → Vercel (Frankfurt), root directory `apps/web`
- **API on Railway (EU West); worker deployment pending** — API built from `apps/api/Dockerfile`, auto-deploys on push to `main`. Worker image is built (`apps/worker/Dockerfile`) but its Railway runtime is not yet confirmed.
- **Worker:** no automated CI deploy until a Railway worker service exists. GHCR images still build; redeploy manually via Coolify until Hetzner teardown.
- **CI/CD** → GitHub Actions: typecheck → test → deploy-web on push to `main`

---

## Standing Rules & Expertise

### Stack (current — do not reintroduce retired infra)
- Hosting: **Supabase** (Postgres + Auth, Frankfurt) · **Vercel** (web, fra1) · **Railway** (API, EU West).
- Hetzner + Coolify are being decommissioned. **Do not** suggest or reintroduce Keycloak, Coolify, Elasticsearch, or AWS.
- All data stays in the EU.

### Multi-tenancy is a security boundary
- Every DB query MUST filter by `tenantId`. Treat tenant isolation as a security boundary, not a convention.
- Exception: the 445k-row national company register is intentionally global (documented).
- Never weaken auth or tenant scoping to fix an unrelated bug (e.g. CORS, build errors).

### Security defaults
- CORS: read allowed origins from `CORS_ORIGIN` (comma-separated). Allow `*.vercel.app` previews via regex. **Never** use `origin: "*"` together with `credentials: true`; reflect the matched origin instead.
- No secrets in code. Read from env. Flag any hardcoded credential.

### Patterns & compliance
- Reuse existing patterns — check `apps/api/src/modules/` before writing new code.
- EN 16931 compliance required for all invoice changes; Peppol BIS 3.0 for UBL XML output.

### Process
- Run the quality gate after every milestone (lint, test, build).
