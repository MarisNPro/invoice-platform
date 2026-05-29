# Risk Register — Invoice Platform

**Last updated:** 2026-05-29
**Scale:** Probability = Low / Medium / High · Impact = Low / Medium / High / Critical
**Status:** 🔴 Open · 🟡 Mitigating · 🟢 Closed

---

## Active risks

| ID | Risk | Probability | Impact | Status | Mitigation |
|----|------|-------------|--------|--------|------------|
| R-01 | **Insecure default secrets in production** — `IMPERSONATION_SECRET` defaults to `'dev-impersonation-secret'` and `ARCHIVE_ENCRYPTION_KEY` to 64 zeros; `/auth/impersonate` is public → forgeable cross-tenant sessions and effectively-plaintext cloud tokens if unset | High | Critical | 🟡 Mitigating | Vars wired into `docker-compose.prod.yml`; set strong values in Coolify (api + worker); add fail-fast that refuses the defaults in prod; verify no existing `cloud_archives` rows before rotating the key |
| R-02 | **Keycloak deferred** — beta runs on the Keycloak-optional `x-dev-tenant-id` guard | High | High | 🟡 Mitigating | Bypass hard-gated to `NODE_ENV !== 'production'`; guard fails fast in prod if Keycloak unconfigured; real Keycloak required before public signup / GA |
| R-03 | **Vercel not connected** — no production web frontend | High | High | 🔴 Open | Connect GitHub → Vercel (fra1) and deploy `apps/web` before inviting beta users (US-002) |
| R-04 | **`ANTHROPIC_API_KEY` not set in Coolify** — all AI features disabled in prod | High | Medium | 🔴 Open | Set the key in Coolify env; verify NL invoice / import OCR / dunning work in prod |
| R-05 | **Coolify env vars partially filled** — containers not fully live | Medium | High | 🟡 Mitigating | Complete the env set against `.env.production.example`; confirm `/health` green |
| R-06 | **CI deploy jobs swallow failures** — `continue-on-error: true` on deploy-web/deploy-api; only `:latest` image tag | Medium | Medium | 🔴 Open | Remove `continue-on-error` on critical deploys; add `${{ github.sha }}` image tags for rollback |
| R-07 | **Tenant isolation rule violation** — `recurring-invoice.service.ts:76` queries by `id` only, then post-checks ownership | Low | High | 🟡 Mitigating | Not exploitable (returns 403 on mismatch) but violates rule #1; scope query with `tenantId` (US-007) |
| R-08 | **Unauthenticated token encryption** — AES-256-CBC (no integrity); refreshed token stored as `refreshed:<plaintext>` in worker | Medium | High | 🔴 Open | Migrate to AES-256-GCM; encrypt refreshed tokens (US-008) |
| R-09 | **Peppol specialist not hired** — 2–3 month lead time; blocks Phase 2 transmission | High | High | 🔴 Open | Post role now (OpenPeppol Slack, Nordic e-invoicing LinkedIn); use FITEK reseller in interim |
| R-10 | **No Stripe billing** — cannot self-serve charge customers | High | Medium | 🟡 Mitigating | Plans set via superadmin for beta; build Stripe Checkout + portal (US-012) before scaling revenue |
| R-11 | **Fastify CVE** — flagged WARN since W4/W5/W6 gates | Medium | Low | 🟡 Mitigating | Track upstream patch; bump when released |
| R-12 | **File upload limit 20 MB** vs intended 10 MB policy | Low | Low | 🔴 Open | Lower `fastify-multipart` `fileSize` to 10 MB in `main.ts` if that's the policy |
| R-13 | **Elasticsearch security disabled** (`xpack.security.enabled: false`) — internal network only | Low | Medium | 🟡 Mitigating | Not externally exposed (bridge net only); enable auth/TLS before Phase 2 multi-service (TODO in compose) |
| R-14 | **EU data residency via SCCs only** — Claude API processes in US | Low | Medium | 🟡 Mitigating | Anthropic DPA + SCCs sufficient for SME tier; AWS Bedrock eu-central-1 enterprise tier in Phase 3 |
| R-15 | **No production monitoring/alerting** — worker has no healthcheck; no suspicious-activity alerts | Medium | Medium | 🔴 Open | Add worker healthcheck; build suspicious activity alerts (US-009) |
| R-16 | **Pricing model undecided** — per-invoice vs subscription affects billing schema | Medium | Medium | 🔴 Open | Decide before Month 2 (affects DB schema) |

---

## Recently closed
| ID | Risk | Closed | Resolution |
|----|------|--------|------------|
| R-C1 | Worker Docker image failed to build (Prisma client / pnpm store layout) | 2026-05-29 | Copy full `node_modules` (root + `apps/worker`) from builder so the pnpm store + generated client travel together |
| R-C2 | CI Node 20 deprecation warnings | 2026-05-29 | Bumped actions to Node 24-native majors (checkout v5, setup-node v5, pnpm/action-setup v6, docker v4/v7) |

---

## Review cadence
- Reviewed at each sprint planning + retro.
- R-01 through R-06 are **launch-blocking** for the Week 8 beta and must reach 🟢 or an accepted 🟡 before the first beta invite (US-005).
