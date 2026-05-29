# Invoice Platform — Master Plan
**Last updated:** May 2026  
**Status:** Phase 1 — Week 6 started (~90% of Phase 1 complete)  
**Stack:** Turborepo · NestJS · Next.js 14 · PostgreSQL (Supabase) · Elasticsearch · Keycloak · Vercel · Hetzner/Coolify

---

## Executive Summary

A Claude-native EU e-invoicing platform targeting Latvian, Estonian, Lithuanian, and Finnish SMEs. Unique competitive advantages: national company register autocomplete (445k+ companies), Peppol BIS 3.0 XML, natural language invoice creation via Claude AI, and full Cowork/MCP integration. No comparable product in the Baltic or Nordic market offers all of these combined.

**Target market:** Freelancers, SMEs, and accountants managing multiple clients in FI/LV/LT/EE  
**Pricing model:** €20–30/month per organisation (decide before Month 2 — affects DB schema)  
**Production cost:** ~$62/month (Supabase + Vercel + Hetzner + Upstash + Resend)

---

## What Is Done (as of May 2026)

| Item | Detail |
|---|---|
| Monorepo | Turborepo, pnpm, 4 apps + 7 packages |
| Docker Compose | 8 services, all healthy |
| Database | 25 models, 3 migrations, EN 16931 compliant |
| Auth | Keycloak JWT, RBAC, multi-company |
| Company search | FI (PRH live) + EE (Äriregister live) + LV (219k ES) + LT (226k ES) |
| Invoice CRUD | Atomic numbering via `next_invoice_number()` PostgreSQL function |
| VAT engine | EN 16931 BG-22 + BG-23, all EU rates seeded |
| PDF/A-3 | All mandatory BT fields, downloadable |
| UBL 2.1 XML | Peppol BIS 3.0 valid, all 9 validation checks passing |
| Tests | 96 unit tests, CI green, Node 22 |
| GitHub | github.com/MarisNPro/invoice-platform |
| Deployment config | Supabase + Vercel + Hetzner/Coolify files ready |

---

## Reprioritised Delivery Plan

### Priority logic applied:
1. **Revenue first** — features that make the product sellable to first beta users
2. **Critical path** — things that block other things
3. **Compliance non-negotiables** — items with legal deadlines
4. **Claude-native differentiation** — features no competitor has
5. **Cost optimisation** — highest-leverage, lowest-effort wins

---

## PHASE 1 — Foundation + AI Layer
**Timeline:** Months 1–4 (Weeks 1–8)  
**Goal:** Working product, beta-ready, deployed, first paying customers

### WEEK 3 — Frontend + Claude native layer
*Priority: Revenue-enabling. Users cannot see or use the product without this.*

> 🟢 **WEEK 3 QUALITY GATE — PASSED 13/13 — 2026-05-28**
> - 13/13 checks PASS
> - 60 unit tests + 9 integration tests = 69 total
> - Security: rate limiting (10 req/min/IP), @fastify/helmet, HSTS, CSP all confirmed
> - Testcontainers: tenant isolation + numbering atomicity verified
> - Commit: 8c656b1

| # | Task | Type | Effort |
|---|---|---|---|
| 1 | **Prompt caching on ALL Claude calls** | Cost | 2 hours — do before any other Claude work |
| 2 | **Structured outputs on all 6 extraction points** | Reliability | 1 day |
| 3 | Frontend — dark UI dashboard (stats + invoice list) | UI | Half day |
| 4 | Frontend — invoice creation form (autocomplete + lines + VAT) | UI | Half day |
| 5 | Natural language invoice creation (streaming) | AI | 1 day |
| 6 | MCP server — 9 tools + 3 slash commands, port 4020 | MCP | 1 day |
| 7 | Deep links + magic link auto-login in all MCP responses | MCP | 2 hours |
| 8 | Parallel tool use — all-country company search simultaneous | MCP | 2 hours |

> **Why prompt caching is #1:** One line of code, 90% API cost reduction immediately. Do it before writing any new Claude features or you'll refactor every call site later.

### WEEK 4 — Smart features + Cowork + Email
*Priority: Product completeness. Email and dunning are required for any paying customer.*

> 🟢 **WEEK 4 QUALITY GATE — PASSED 7/8 — 2026-05-28**

| # | Task | Type | Effort |
|---|---|---|---|
| 9 | ✅ Smart invoice review — EN 16931 compliance check before send | AI | 1 day |
| 10 | ✅ Smart dunning messages — personalised, 14 languages | AI | 1 day |
| 11 | ✅ Email delivery — Resend, PDF attachment, BullMQ scheduler | Core | 1 day |
| 12 | ✅ Client read-only API keys — scoped by customerId | MCP | Half day |
| 13 | ✅ `save_to_local` MCP tool — PDF + XML to user outbox/ | Cowork | Half day |
| 14 | ✅ CONTEXT.md generator — `GET /api/v1/organisations/cowork-context` | Cowork | 2 hours |
| 15 | ✅ Cowork onboarding step — /onboarding/cowork, folder ZIP download | Cowork | Half day |
| 16 | ✅ Compliance warning UI — block B2G Peppol + PII via Cowork | Cowork | 2 hours |
| 17 | ✅ Superadmin panel P1 — 13 endpoints | Admin | 1 day |

### WEEK 5 — Import pipeline + Cowork automation
*Priority: Unique feature. No Baltic competitor has invoice OCR + AI extraction.*

> 🟢 **WEEK 5 QUALITY GATE — PASSED 3/3 — 2026-05-29**
> - 3/3 checks PASS
> - 96 unit tests, both packages typecheck clean
> - Import pipeline: upload → extract (Claude PDF) → review UI → confirm → invoice
> - Cowork: 5 scheduled task templates in docs/cowork-scheduled-tasks.md

| # | Task | Type | Effort |
|---|---|---|---|
| 17 | ✅ Files API — upload once, reference by file_id | AI | 2 hours |
| 18 | ✅ Invoice import — Claude PDF extraction + confidence review UI | AI | 3 days |
| 19 | ✅ 5 Cowork scheduled task templates | Cowork | 2 hours |

> **5 templates:** Nightly inbox processor (00:00), weekly overdue report (Mon 08:00), monthly VAT report (1st 06:00), monthly recurring invoices (1st 07:00), daily summary (08:00).

### WEEK 6 — Cloud archive + Customer management
*Priority: Retention feature. Users expect their invoices saved automatically.*

| # | Task | Type | Effort |
|---|---|---|---|
| 20 | Cloud archive onboarding — GDrive + Dropbox + OneDrive OAuth | Core | 2 days |
| 21 | CloudArchiveSyncJob — auto-save PDF + XML after sending | Core | 1 day |
| 22 | Customer management UI — list, create, edit | UI | 1 day |

### WEEK 7 — Financial completeness
*Priority: Required for any real invoicing workflow.*

| # | Task | Type | Effort |
|---|---|---|---|
| 23 | Credit notes — document type 381, link to original | Core | 1 day |
| 24 | Payment tracking — mark paid, partial payments | Core | 1 day |
| 25 | EPC QR codes — SEPA payment QR on every invoice | Core | Half day |
| 26 | Recurring invoices UI — create, manage schedules | Core | 1 day |

### WEEK 8 — Production deployment
*Priority: Nothing matters until real users can access it.*

| # | Task | Type | Effort |
|---|---|---|---|
| 27 | Supabase — project in EU Frankfurt, run migrations | Infra | 30 min |
| 28 | Hetzner CX32 + Coolify — install, deploy API + worker | Infra | 2 hours |
| 29 | Vercel — connect GitHub, deploy Next.js | Infra | 30 min |
| 30 | GitHub Actions secrets — Vercel + Coolify tokens | CI/CD | 30 min |
| 31 | Keycloak Cloud — realm import, production config | Auth | 1 hour |
| 32 | Upstash Redis + Resend DNS — production config | Infra | 1 hour |
| 33 | Smoke tests + first beta user invited | QA | 1 hour |

---

## PHASE 2 — E-invoicing + Advanced Claude
**Timeline:** Months 5–9  
**Goal:** Peppol live, Italy/France coverage, autonomous agent pipeline

### Critical path items — start immediately in parallel with Phase 1
> These have multi-month lead times. Start in Month 2, not Month 5.

| Item | Lead time | Action |
|---|---|---|
| Peppol specialist hire | 2–3 months | Post job now — OpenPeppol Slack, Nordic LinkedIn |
| France PPF (backlog) | Unknown — review at M5 | Monitor French regulatory timeline |

### Month 5–6 — Peppol transmission
| # | Task | Type |
|---|---|---|
| 34 | Peppol via FITEK reseller (FI) — PINT CIUS | Peppol |
| 35 | Peppol via LVRTC (LV) — LV-CIUS | Peppol |
| 36 | Peppol via Telia/CGI (LT) | Peppol |
| 37 | Peppol via Elcom (EE) | Peppol |
| 38 | Plain-language analytics — "which customers are slowest to pay?" | AI |
| 39 | Peppol MCP tools — `send_via_peppol` + `get_peppol_status` | MCP |
| 40 | Citations — EN 16931 compliance flags cite exact rules | AI |
| 41 | Batch processing — monthly reports at 50% API cost | AI |

### Month 7–8 — Italy, France, Germany, advanced AI
| # | Task | Type |
|---|---|---|
| 42 | Italy SDI connector — FatturaPA XML + QES (standalone workstream) | Peppol |
| 43 | ZUGFeRD (DE) + Factur-X (FR) — Mustang Java sidecar | Peppol |
| 44 | France PPF connector — if regulatory approval obtained | Peppol |
| 45 | Extended thinking — complex cross-border VAT edge cases | AI |
| 46 | Peppol error explainer — BV-R010 → plain English + fix | AI |
| 47 | Purchase order → invoice — upload PO PDF, Claude creates draft | AI |
| 48 | MCP Resources — live dashboard data as ambient Cowork context | MCP |
| 49 | Cowork Projects guide — per-client context for accountants | Cowork |

### Month 8–9 — Autonomous pipeline
| # | Task | Type |
|---|---|---|
| 50 | Agent SDK — autonomous email → invoice processing pipeline | AI |
| 51 | MCP Gateway — enterprise Cowork audit trail (SOC2/GDPR) | Cowork |
| 52 | Enable regulated Cowork workflows (if Anthropic fixes audit gap) | Cowork |

---

## PHASE 3 — ERP + Scale
**Timeline:** Months 10–15  
**Goal:** Enterprise-ready, 19 ERP integrations, mobile app, public API

| # | Task | Timeline |
|---|---|---|
| 53 | SAP IDOC/XML export | M10 |
| 54 | Microsoft Dynamics 365 / Business Central | M10 |
| 55 | Oracle NetSuite + Odoo + Sage | M11 |
| 56 | FI: Procountor, Netvisor, Fennoa, Heeros, Visma Fivaldi | M11–12 |
| 57 | LV: Standard Books, Horizon, Jumis | M12 |
| 58 | LT: Rivilė, Pragma, Stekas | M12–13 |
| 59 | EE: Merit Aktiva, Directo, Costpocket | M13 |
| 60 | Mobile app — React Native iOS + Android | M13–15 |
| 61 | Public REST API + webhooks + developer docs | M14 |
| 62 | GDPR tooling — pseudonymisation + erasure flow | M13 |
| 63 | Company search — DE (Bundesanzeiger), FR (SIRENE), PL (KRS) | M14 |
| 64 | Submit MCP server to Claude.ai + Cowork integrations directory | M15 |
| 65 | AWS Bedrock eu-central-1 — EU data residency enterprise tier | M15 |
| 66 | Own Peppol PCAP accreditation — evaluate vs FITEK reseller | M15 |

---

## Backlog (not prioritised)
| Item | Reason deferred |
|---|---|
| France PDP registration | Use PPF public portal first — review at M5 |
| Peppol own PCAP | Using FITEK reseller for Phase 2 — revisit at M15 |
| iCloud Drive integration | No public REST API — CloudKit JS only, fragile |
| Company search DE/FR/PL | Architecture supports it — add when needed |
| AWS migration | Only if enterprise customers require it |

---

## Claude-Native Feature Summary

### Already planned and prioritised
| Feature | Week/Month | API used |
|---|---|---|
| Prompt caching (−90% cost) | W3 | cache_control: ephemeral |
| Structured outputs (zero parse errors) | W3 | output_config.format + Zod |
| Natural language invoice creation | W3 | Streaming + structured output |
| MCP server — 9 tools + 3 slash commands | W3 | @modelcontextprotocol/sdk |
| Parallel tool use — 4-country search | W3 | parallel_tool_calls |
| Smart invoice review | W4 | Claude Sonnet 4.6 |
| Smart dunning — 14 languages | W4 | Claude Sonnet 4.6 + prompt cache |
| Cowork integration (5 deliverables) | W4–5 | MCP compatible |
| Files API — PDF upload once | W5 ✅ | files.create() |
| Invoice import OCR + extraction | W5 ✅ | Claude PDF document API |
| Plain-language analytics | M6 | Claude Sonnet 4.6 |
| Citations — EN 16931 rules | M6 | citations: {enabled: true} |
| Batch processing (−50% cost) | M6 | MessageBatches API |
| Peppol error explainer | M7 | Claude Sonnet 4.6 |
| Extended thinking — VAT edge cases | M7 | adaptive thinking |
| PO → invoice conversion | M8 | Files API + Claude |
| Agent SDK autonomous pipeline | M8 | @anthropic-ai/claude-agent-sdk |
| MCP Resources — ambient context | M8 | ListResourcesRequestSchema |
| Claude.ai integrations directory | M15 | MCP listing |
| AWS Bedrock eu-central-1 | M15 | BedrockAnthropicClient |

---

## Tech Stack (Final)

### Frontend
- Next.js 14 (App Router), React 18, TypeScript strict
- Tailwind CSS, shadcn/ui, TanStack Query v5, react-hook-form + Zod
- react-i18next — 14 languages (EN DE FR ES IT PL NL SV RO HU FI LV LT ET)

### Backend
- NestJS + Fastify adapter, Prisma ORM, BullMQ, Zod
- pdf-lib (PDF/A-3), xmlbuilder2 (UBL 2.1)
- Java sidecars: Mustang (ZUGFeRD/Factur-X), EU DSS (QES), Oxalis AS4 (Phase 2)

### Infrastructure
- **Database:** Supabase Pro — EU Frankfurt — PostgreSQL 16
- **Cache/Queues:** Upstash Redis — EU Frankfurt
- **Frontend:** Vercel Pro — fra1 region
- **API + Worker + ES:** Hetzner CX32 + Coolify — Falkenstein Germany
- **Object storage:** Hetzner Object Storage — FSN1
- **Email:** Resend — 3,000 emails/month free
- **Auth:** Keycloak 24 — cloud.keycloak.com (free <1k users)
- **Local dev:** Docker Compose — all services, one command

### Monthly production cost: ~$62/month

---

## Compliance Summary

### GDPR
- Anthropic DPA automatic on paid API plan (effective Jan 2026)
- SCCs included for EU-US data transfer — legally sufficient for SME customers
- Privacy policy must state: "Claude API processes data in US under SCCs"
- EU data residency via AWS Bedrock eu-central-1 available as Phase 3 enterprise tier
- **Do not use Claude Free/Pro for business data** — no DPA on consumer tiers

### Cowork safe/unsafe rules
| Workflow | Cowork OK? |
|---|---|
| Draft invoice, check overdue, reports | ✅ Safe |
| Monthly VAT report, recurring B2B invoices | ✅ Safe |
| Peppol B2G transmission | ❌ Block — audit trail required |
| Processing customer PII from received PDFs | ❌ Block — GDPR audit required |
| Italy SDI / France PPF transmission | ❌ Block — government mandate |

*Revisit blocked workflows when Anthropic extends Compliance API to Cowork — no timeline announced as of May 2026.*

### Peppol
- Using FITEK as reseller access point for Phase 2 (FI)
- Equivalent resellers for LV/LT/EE
- Own PCAP accreditation deferred to Phase 3

---

## Team Requirements

| Role | When | Notes |
|---|---|---|
| Senior full-stack dev (TypeScript) | Day 1 — 2 people | NestJS + Next.js + Prisma |
| DevOps engineer | Day 1 | Terraform, Coolify, Docker, GitHub Actions |
| UI/UX designer | Month 2 | Invoice templates, 14-language layouts, Figma |
| EU compliance consultant | Month 2 | GDPR, EN 16931, VAT law — 1-2 days/week external |
| Peppol/e-invoicing specialist | Month 3 start | Oxalis AS4, EU DSS, UBL 2.1 — hardest to hire |
| Integration developer | Month 9 | SAP IDOC, Dynamics, Baltic ERPs |

> **Most urgent hire:** Peppol specialist. Takes 2–3 months to find. Post job now in OpenPeppol Slack and Nordic e-invoicing LinkedIn groups.

---

## Key Decisions Already Made

| Decision | Choice | Reason |
|---|---|---|
| Cloud | Supabase + Vercel + Hetzner | ~$62/mo vs $200-300 AWS |
| Auth | Keycloak (self-hosted dev, cloud prod) | GDPR, full control |
| Peppol Phase 2 | FITEK reseller | Faster than own PCAP (3-6mo) |
| Invoice numbering | PostgreSQL atomic sequence | Gaps trigger VAT audits |
| Seller/buyer fields | Snapshotted on Invoice | Legally required immutability |
| Company search LV/LT | Bulk CSV → Elasticsearch | Free, 445k records, <10ms |
| LV VAT numbers | Join UR + VID datasets | Official source, no API key |
| France PDP | PPF public portal first | Avoids months of regulatory approval |
| EU data residency | SCCs for Phase 1 | Sufficient for SME market |
| Cowork compliance | Block regulated workflows | Audit gap not closed |

---

## Decisions Still Needed

| Decision | Deadline | Impact |
|---|---|---|
| Pricing model — per invoice vs subscription | Before Month 2 | Affects DB schema billing fields |
| QES signing — platform signs vs customer certs | Month 4 | Affects Italy SDI design |
| Company search DE/FR/PL — scope for v1? | Month 6 | One sprint if yes |
| Peppol PCAP vs stay on reseller long-term | Month 12 | Cost vs control |

---

## Milestones

| Milestone | Target | Description |
|---|---|---|
| First invoice + PDF downloaded | End W4 | End-to-end demo working |
| Cowork integration live | End W5 | Users can issue from desktop |
| Beta launch | End W8 | First paying customers |
| First Peppol invoice sent | Month 6 | Via FITEK reseller |
| All 4 Peppol access points live | Month 6 | FI + LV + LT + EE |
| Italy SDI live | Month 8 | |
| Phase 2 complete | Month 9 | All e-invoicing networks |
| 19 ERP integrations | Month 13 | |
| Mobile app | Month 15 | iOS + Android |
| v1.0 full launch | Month 15 | |
