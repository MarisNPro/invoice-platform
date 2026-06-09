# Risk Register — Invoice Platform

**Last updated:** 2026-05-29
**Scale:** Probability = Low / Medium / High · Impact = Low / Medium / High / Critical
**Status:** 🔴 Open · 🟡 Mitigating · 🟢 Closed

---

## Active risks

| ID | Risk | Probability | Impact | Status | Mitigation |
|----|------|-------------|--------|--------|------------|
| R-01 | **Insecure default secrets in production** — `IMPERSONATION_SECRET` defaults to `'dev-impersonation-secret'` and `ARCHIVE_ENCRYPTION_KEY` to 64 zeros; `/auth/impersonate` is public → forgeable cross-tenant sessions and effectively-plaintext cloud tokens if unset | High | Critical | 🟡 Mitigating | Fail-fast implemented (US-006): API refuses to boot in prod with default/weak secrets (`config/secret-guard.ts`), worker mirrors the archive-key check; remaining — set strong values in Railway env (api + worker); verify no existing `cloud_archives` rows before rotating the key |
| R-02 | **Production auth not yet verified** — Supabase Auth is active in code; needs `SUPABASE_URL` set + real tokens confirmed in prod | Medium | High | 🟡 Mitigating | Bypass hard-gated to `NODE_ENV !== 'production'`; composite guard fails fast in prod if no provider configured; set `SUPABASE_URL` in Railway and verify before public signup / GA. (Keycloak retired to a migration-only fallback) |
| R-03 | **Vercel not connected** — no production web frontend | High | High | 🔴 Open | Connect GitHub → Vercel (fra1) and deploy `apps/web` before inviting beta users (US-002) |
| R-04 | **`ANTHROPIC_API_KEY` not set in Railway** — all AI features disabled in prod | High | Medium | 🔴 Open | Set the key on the Railway api service; verify NL invoice / import OCR / dunning work in prod |
| R-05 | **Railway env vars partially filled** — services not fully live | Medium | High | 🟡 Mitigating | Complete the env set against `.env.production.example` on the api + worker services; confirm `/api/v1/health` green |
| R-09 | **Peppol specialist not hired** — 2–3 month lead time; blocks Phase 2 transmission | High | High | 🔴 Open | Post role now (OpenPeppol Slack, Nordic e-invoicing LinkedIn); use FITEK reseller in interim |
| R-10 | **No Stripe billing** — cannot self-serve charge customers | High | Medium | 🟡 Mitigating | Plans set via superadmin for beta; build Stripe Checkout + portal (US-012) before scaling revenue |
| R-11 | **Fastify CVE** — flagged WARN since W4/W5/W6 gates | Medium | Low | 🟡 Mitigating | Track upstream patch; bump when released |
| R-12 | **File upload limit 20 MB** vs intended 10 MB policy | Low | Low | 🔴 Open | Lower `fastify-multipart` `fileSize` to 10 MB in `main.ts` if that's the policy |
| R-13 | **Elasticsearch teardown pending** — removed from all app code (LV/LT search is Postgres `pg_trgm`); stale local/infra ES containers + compose service remain | Low | Low | 🟡 Mitigating | No longer in the request path. Remove the ES service from `docker-compose*.yml` and the local containers (ticket C) |
| R-14 | **EU data residency via SCCs only** — Claude API processes in US | Low | Medium | 🟡 Mitigating | Anthropic DPA + SCCs sufficient for SME tier; AWS Bedrock eu-central-1 enterprise tier in Phase 3 |
| R-15 | **No production monitoring/alerting** — worker has no healthcheck; no suspicious-activity alerts | Medium | Medium | 🔴 Open | Add worker healthcheck; build suspicious activity alerts (US-009) |
| R-16 | **Pricing model undecided** — per-invoice vs subscription affects billing schema | Medium | Medium | 🔴 Open | Decide before Month 2 (affects DB schema) |

---

## Recently closed
| ID | Risk | Closed | Resolution |
|----|------|--------|------------|
| R-C1 | Worker Docker image failed to build (Prisma client / pnpm store layout) | 2026-05-29 | Copy full `node_modules` (root + `apps/worker`) from builder so the pnpm store + generated client travel together |
| R-C2 | CI Node 20 deprecation warnings | 2026-05-29 | Bumped actions to Node 24-native majors (checkout v5, setup-node v5, pnpm/action-setup v6, docker v4/v7) |
| R-07 | Tenant isolation rule violation — `recurring-invoice.service.ts` queried by `id` only, then post-checked ownership | 2026-06-09 | `findOwned` scopes by `{ id, tenantId }` (US-007); cross-tenant access returns 404; service spec added |
| R-08 | Unauthenticated token encryption (AES-256-CBC) + `refreshed:<plaintext>` token in worker | 2026-06-09 | Migrated to authenticated AES-256-GCM (versioned `v2:` format, legacy-CBC read fallback); worker refresh re-encrypts (US-008). **Pre-deploy note:** rows the old worker wrote with a `refreshed:` prefix were never properly encrypted — re-authorize those providers; legacy CBC rows decrypt transparently |
| R-06 | CI deploy jobs swallow failures — `continue-on-error: true` on deploy-web; only `:latest` image tag | 2026-06-09 | Removed `continue-on-error` from `deploy-web` (real failures now fail the pipeline; an unset `VERCEL_TOKEN` emits a `::warning::` instead of a silent skip); API + worker images now also tagged with `${{ github.sha }}` for rollback (US-004) |

---

## Review cadence
- Reviewed at each sprint planning + retro.
- R-01 through R-06 are **launch-blocking** for the Week 8 beta and must reach 🟢 or an accepted 🟡 before the first beta invite (US-005).
