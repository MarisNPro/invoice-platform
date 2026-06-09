# Product Backlog — Invoice Platform

**Last updated:** 2026-05-29
**Ordering:** Highest-priority remaining work first; delivered epics recorded at the bottom.
**Story points:** Fibonacci (1 / 2 / 3 / 5 / 8). **Status:** Backlog / In Progress / Done.

> Legend: 🟢 Done · 🟡 In Progress · ⚪ Backlog

---

## Epic: Production Infrastructure & Deployment 🟡
*Goal: real users can reach the product. Active in Sprint 7 (Week 8).*

### US-001 — As a founder I want the API + worker deployed to Railway so that the backend runs in production
- Acceptance criteria:
  - API + Worker deploy on Railway from `railway.api.json` / `railway.worker.json` (DOCKERFILE builder), EU West
  - `/api/v1/health` returns `ok` for postgres + redis in production
  - All required env vars populated on the Railway api + worker services
- Story points: 5
- Status: In Progress *(config-as-code committed; Railway env vars to be populated — see SPRINT-LOG)*

### US-002 — As a beta user I want the web frontend hosted so that I can use the product in a browser
- Acceptance criteria:
  - GitHub repo connected to Vercel (fra1 region)
  - `apps/web` deploys on push to `main`
  - Production URL serves the dashboard and points at the production API
- Story points: 3
- Status: Backlog *(Vercel not connected)*

### US-003 — As the platform I want production authentication via Supabase Auth so that real tenants are isolated by verified JWTs
- Acceptance criteria:
  - `SUPABASE_URL` set; `SupabaseJwtGuard` verifies real tokens via the derived JWKS
  - `tenantId` extracted from the validated JWT; every query still filters by it
  - `x-dev-tenant-id` bypass impossible in `NODE_ENV=production`
- Story points: 5
- Status: In Progress *(Supabase Auth is the active provider in code; Keycloak retired to a migration-only fallback. Remaining: set `SUPABASE_URL` in Railway + verify prod tokens)*

### US-004 — As a developer I want CI/CD to lint, test, build and deploy on every push so that releases are repeatable
- Acceptance criteria:
  - Pipeline: Lint → Test → Build API → Build Worker → Deploy
  - Failing stage blocks deploy (no silent `continue-on-error` on critical jobs)
  - Immutable image tags for rollback
- Story points: 3
- Status: Done *(Lint → Test → Build API → Build Worker → Deploy; `deploy-web` no longer `continue-on-error`; API + worker images tagged `:latest` + `:${{ github.sha }}` for rollback — R-06)*

### US-005 — As an operator I want a smoke-test checklist + first beta invite so that launch is verified
- Acceptance criteria:
  - End-to-end: create invoice → PDF → UBL → email, against production
  - First beta tenant provisioned and invited
- Story points: 2
- Status: Backlog

---

## Epic: Security & Compliance Hardening ⚪
*Goal: close pre-launch security gaps found in the 2026-05-29 review.*

### US-006 — As the platform I want all secret material to fail-fast on insecure defaults so that production cannot run with guessable keys
- Acceptance criteria:
  - `IMPERSONATION_SECRET` and `ARCHIVE_ENCRYPTION_KEY` rejected if unset/default in production
  - Strong values set in Railway for api + worker
- Story points: 3
- Status: In Progress *(fail-fast implemented + tested — API boot via `config/secret-guard.ts`, worker boot mirrors the archive-key check; remaining: set strong values in Railway env for api + worker)*

### US-007 — As a tenant I want every DB query scoped to my tenant so that cross-tenant data is unreachable
- Acceptance criteria:
  - All `findFirst`/`findMany`/mutations include `tenantId` at the query level
  - `recurring-invoice.service.ts` bare `findFirst({ where: { id } })` scoped
- Story points: 2
- Status: Done *(`findOwned` now scopes by `{ id, tenantId }`; cross-tenant access returns 404, no longer leaking existence via 403; service spec added)*

### US-008 — As a user I want my cloud-archive tokens authenticated-encrypted at rest so that a DB read cannot reveal them
- Acceptance criteria:
  - AES-256-**GCM** (authenticated) replaces AES-256-CBC
  - Refresh tokens never stored unencrypted (fix `archive-sync.job.ts` `refreshed:` plaintext path)
- Story points: 3
- Status: Done *(GCM with versioned `v2:` format + legacy-CBC read fallback in `crypto.util.ts` and the worker's mirror; worker refresh now re-encrypts instead of storing `refreshed:<plaintext>`; tamper-detection + backward-compat covered by `crypto.util.spec.ts`)*

### US-009 — As a superadmin I want suspicious activity alerts so that anomalous access is surfaced
- Acceptance criteria:
  - Alert on repeated auth failures, impersonation use, mass export
  - Delivered to an admin channel (email/Slack)
- Story points: 5
- Status: Backlog

### US-010 — As a data subject I want GDPR erasure + pseudonymisation tooling so that we meet legal obligations
- Acceptance criteria:
  - Erasure flow per tenant/user; audit-logged
  - Pseudonymisation of PII in analytics
- Story points: 8
- Status: Backlog *(Phase 3 — M13)*

---

## Epic: Monetization ⚪
*Goal: turn beta into revenue.*

### US-011 — As an organisation I want subscription tiers so that my plan limits are enforced
- Acceptance criteria:
  - Plan tiers with per-plan limits enforced by `PlanLimitGuard`
  - Set via superadmin for beta
- Story points: 5
- Status: Done *(pricing tiers via superadmin; Stripe billing deferred — see US-012)*

### US-012 — As a customer I want to pay by card so that I can self-serve subscribe
- Acceptance criteria:
  - Stripe Checkout + customer portal
  - Webhooks update plan/seat state; dunning on failed payment
- Story points: 8
- Status: Backlog

### US-013 — As a founder I want an MRR / revenue dashboard so that I can track growth
- Acceptance criteria:
  - MRR, active subscriptions, churn, ARPU
  - Sourced from billing events
- Story points: 3
- Status: Backlog

---

## Epic: E-invoicing Networks (Phase 2) ⚪
*Goal: Peppol transmission live across the Baltics + Nordics.*

### US-014 — As a seller I want to send invoices via Peppol so that I meet B2G/B2B mandates
- Acceptance criteria:
  - Transmission via FITEK reseller (FI) + LVRTC (LV) + Telia/CGI (LT) + Elcom (EE)
  - `send_via_peppol` + `get_peppol_status` MCP tools
  - PINT CIUS / national CIUS validation pass
- Story points: 8
- Status: Backlog *(blocked on Peppol specialist hire — 2–3 mo lead time)*

### US-015 — As an Italian seller I want SDI / FatturaPA support so that I can invoice in Italy
- Acceptance criteria:
  - FatturaPA XML + QES signing
  - SDI connector standalone workstream
- Story points: 8
- Status: Backlog *(M8)*

### US-016 — As a user I want plain-language Peppol error explanations so that I can fix rejections
- Acceptance criteria:
  - Validation error codes → plain English + suggested fix (Claude)
- Story points: 3
- Status: Backlog

---

## Epic: Platform Scale (Phase 3) ⚪
*Goal: enterprise readiness and reach.*

### US-017 — As an ops user I want feature flags so that we can ramp features safely
- Acceptance criteria:
  - Per-tenant flag evaluation; admin toggle UI
- Story points: 3
- Status: Backlog

### US-018 — As an accountant I want my ERP integrated so that data flows without re-keying
- Acceptance criteria:
  - 19 connectors (SAP, Dynamics, NetSuite, Baltic/Nordic ERPs) phased M10–M13
- Story points: 8
- Status: Backlog

### US-019 — As a mobile user I want an iOS/Android app so that I can invoice on the go
- Acceptance criteria:
  - React Native app, core invoicing flows
- Story points: 8
- Status: Backlog *(M13–M15)*

### US-020 — As a developer I want a public REST API + webhooks so that I can build on the platform
- Acceptance criteria:
  - Documented public API, scoped keys, webhooks
- Story points: 5
- Status: Backlog *(M14)*

---

## Epic: AI & Claude-Native Features 🟢 *(delivered)*

### US-021 — As a user I want to create invoices in natural language so that I save time
- Acceptance criteria: streaming + structured output; prompt caching on all calls; validated against DTOs
- Story points: 8
- Status: Done

### US-022 — As a user I want a smart EN 16931 compliance review before sending so that I avoid rejections
- Acceptance criteria: compliance check flags BG/BT issues pre-send
- Story points: 5
- Status: Done

### US-023 — As a user I want personalised dunning messages so that I get paid faster
- Acceptance criteria: 14-language tone-aware reminders; prompt cached
- Story points: 5
- Status: Done

### US-024 — As a Claude/Cowork user I want an MCP server so that I can drive the platform from my desktop
- Acceptance criteria: 9 tools + 3 prompts on port 4020; deep links + magic-link login; parallel 4-country search
- Story points: 8
- Status: Done

### US-025 — As a user I want to import supplier invoices via OCR so that data entry is automated
- Acceptance criteria: Claude PDF extraction; confidence review UI; Files API upload-once
- Story points: 8
- Status: Done

---

## Epic: Customer & Document Management 🟢 *(delivered)*

### US-026 — As a user I want cloud archive (GDrive/Dropbox/OneDrive) so that invoices auto-save
- Acceptance criteria: OAuth onboarding; `CloudArchiveSyncJob` saves PDF + XML after send
- Story points: 8
- Status: Done

### US-027 — As a user I want customer management so that I can see history per client
- Acceptance criteria: list + detail + invoice history; shareable URL filters (status/customer/date/amount)
- Story points: 5
- Status: Done

---

## Epic: Financial Completeness 🟢 *(delivered)*

### US-028 — As a user I want credit notes so that I can correct invoices
- Acceptance criteria: document type 381, linked to original
- Story points: 5
- Status: Done

### US-029 — As a user I want payment tracking so that I know what's outstanding
- Acceptance criteria: mark paid, partial payments; payment cannot exceed remaining balance
- Story points: 5
- Status: Done

### US-030 — As a payer I want an EPC SEPA QR on invoices so that I can pay quickly
- Acceptance criteria: valid EPC QR on every invoice
- Story points: 2
- Status: Done

### US-031 — As a user I want recurring invoice schedules so that I automate repeat billing
- Acceptance criteria: create/manage schedules; auto-generate + send
- Story points: 5
- Status: Done

---

## Epic: Core Invoicing & Foundation 🟢 *(delivered)*

### US-032 — As a user I want invoice CRUD with gap-free numbering so that I stay VAT-audit compliant
- Acceptance criteria: atomic `next_invoice_number()`; seller/buyer snapshotted; Decimal(15,2)
- Story points: 8
- Status: Done

### US-033 — As a user I want company autocomplete so that I fill counterparties instantly
- Acceptance criteria: FI (PRH) + EE (Äriregister) live; LV/LT via Postgres `pg_trgm` `company_register` (445k); Redis-cached
- Story points: 5
- Status: Done

### US-034 — As a user I want compliant PDF/A-3 + UBL 2.1 output so that documents are legally valid
- Acceptance criteria: all mandatory BT fields; Peppol BIS 3.0 valid; 9 validation checks pass; VAT BG-22/BG-23
- Story points: 5
- Status: Done

### US-035 — As a superadmin I want an admin panel so that I can manage tenants without Stripe
- Acceptance criteria: 13 endpoints; all SUPERADMIN-guarded; sensitive actions audit-logged
- Story points: 8
- Status: Done

### US-036 — As an accountant I want Cowork integration so that I can run the platform from my desktop workflow
- Acceptance criteria: `save_to_local`, CONTEXT.md generator, onboarding ZIP, compliance-block UI, 5 scheduled task templates
- Story points: 5
- Status: Done
