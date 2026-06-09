# Invoice Platform — Production Setup Guide

Full end-to-end setup for deploying the EU invoice platform.
**Estimated time:** ~1.5 hours from zero to live.

> **Current stack** (authoritative: `CLAUDE.md`):
> **Supabase** (Postgres + Auth, Frankfurt) · **Upstash Redis** (Frankfurt) ·
> **Vercel** (web, fra1) · **Railway** (API + worker, EU West) · **Resend** (email).
> LV/LT company search is Postgres `pg_trgm` (no Elasticsearch).
> **Retired — do not reintroduce:** Keycloak, Hetzner + Coolify, Elasticsearch, AWS.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CLIENT BROWSER                               │
└────────────────────────────┬────────────────────────────────────────┘
                             │ HTTPS
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│              VERCEL  (Frankfurt — fra1 region)                      │
│              Next.js App Router  ·  CDN edge                       │
│              apps/web  —  app.yourdomain.com                        │
└────────────┬────────────────────────────────────────────────────────┘
             │ REST /api/v1            │ Supabase Auth (JWT/JWKS)
             ▼                         ▼
┌────────────────────────┐    ┌─────────────────────────┐
│  RAILWAY  (EU West)    │    │  SUPABASE  (Frankfurt)  │
│                        │    │  Postgres + Auth        │
│  ┌──────────────────┐  │◄───┤  (pooled :6543)         │
│  │  API  :4000      │  │    └─────────────────────────┘
│  │  (NestJS+Fastify)│  │◄──── Upstash Redis (EU Frankfurt)
│  └────────┬─────────┘  │
│           │            │◄──── S3-compatible object storage
│  ┌────────▼─────────┐  │       (Supabase Storage / compatible)
│  │  Worker          │  │
│  │  (BullMQ)        │  │◄──── Resend (email)
│  └──────────────────┘  │
│   LV/LT search: Postgres pg_trgm (company_register table)
└────────────────────────┘
```

---

## Monthly Cost Breakdown (approximate)

| Service | Plan | Region | Cost |
|---|---|---|---|
| **Supabase** | Pro (Postgres + Auth) | EU Frankfurt | $25/mo |
| **Vercel** | Pro | fra1 | $20/mo |
| **Railway** | Usage-based (API + worker) | EU West | ~$5–20/mo |
| **Upstash Redis** | Pay-as-you-go | EU (Frankfurt) | ~$1–3/mo |
| **Resend** | Starter (3k/mo free) | — | $0/mo |
| **Total** | | | **~$50–70/mo** |

---

## Step 1 — Supabase (PostgreSQL + Auth)

1. Go to **[app.supabase.com](https://app.supabase.com)** → New project
2. **Name:** `invoice-platform`
3. **Region:** `EU West (Frankfurt)`  ← critical for GDPR
4. **Database password:** generate strong password, save it
5. After provisioning, go to **Settings → Database**:
   - Copy **Transaction pooler** URL (port 6543) → `DATABASE_URL`
   - Copy **Session pooler** URL (port 5432) → `DIRECT_URL`
6. Enable pgcrypto: SQL Editor → `CREATE EXTENSION IF NOT EXISTS pgcrypto;`
7. **Auth:** Settings → API → copy the **Project URL** → `SUPABASE_URL`. The API
   derives the JWT issuer (`${SUPABASE_URL}/auth/v1`) and JWKS endpoint from it
   (`apps/api/src/auth/supabase-jwt.guard.ts`). Configure providers/redirect URLs
   under **Authentication → URL Configuration**.

> Supabase Pro includes point-in-time recovery, daily backups, the Frankfurt
> region, and the Auth service — there is no separate auth server to run.

---

## Step 2 — Upstash Redis

1. Go to **[console.upstash.com](https://console.upstash.com)** → Create Database
2. **Name:** `invoice-platform`
3. **Type:** Regional · **Region:** `eu-west-1 (Frankfurt)`
4. **TLS:** enabled
5. Copy the **ioredis** connection string (`rediss://default:token@host:6380`) → `REDIS_URL`

---

## Step 3 — Railway (API + Worker)

The API and worker deploy from their Dockerfiles via config-as-code checked into
the repo: [`railway.api.json`](railway.api.json) and
[`railway.worker.json`](railway.worker.json) (both use the `DOCKERFILE` builder).

### 3a. Create the project + services

1. **[railway.app](https://railway.app)** → New Project → Deploy from GitHub repo
2. Authorize the repo, then create **two services** from it:
   - **api** — config: `railway.api.json` (Dockerfile `apps/api/Dockerfile`,
     healthcheck `/api/v1/health`)
   - **worker** — config: `railway.worker.json` (Dockerfile `apps/worker/Dockerfile`)
3. Set the region to **EU West** for both services.

### 3b. Environment variables

Set the variables from [`infra/deploy/.env.production.example`](infra/deploy/.env.production.example)
on **both** services in the Railway dashboard (Variables tab). At minimum:
`DATABASE_URL`, `DIRECT_URL`, `REDIS_URL`, `SUPABASE_URL`, `CORS_ORIGIN`,
`NODE_ENV=production`, the security secrets below, and `ANTHROPIC_API_KEY`.

> **Security secrets (required in production).** The API and worker **refuse to
> boot** in production with the insecure dev defaults (see
> `apps/api/src/config/secret-guard.ts`). Generate strong values:
> ```
> IMPERSONATION_SECRET=$(openssl rand -hex 32)   # API only
> ARCHIVE_ENCRYPTION_KEY=$(openssl rand -hex 32) # API + worker (must match)
> ```
> Before setting `ARCHIVE_ENCRYPTION_KEY`, confirm there are no existing
> `cloud_archives` rows — rotating it invalidates already-stored OAuth tokens.

### 3c. Deploys

Both services auto-deploy on push to `main`. On startup the API container runs
`prisma migrate deploy` before binding. The HTTP server binds independently of
Redis so an Upstash blip never blocks boot.

---

## Step 4 — Object storage (optional)

If you use S3-compatible storage for attachments/archives, set `S3_ENDPOINT`,
`S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`, `S3_REGION` to a provider that
keeps data in the EU (e.g. Supabase Storage's S3-compatible endpoint). Cloud
archive to GDrive/Dropbox/OneDrive is configured per-tenant via OAuth and does
not require this.

---

## Step 5 — Resend (Email)

1. **[resend.com](https://resend.com)** → Sign up → Add Domain
2. Verify your domain (add DNS TXT + MX records shown in Resend)
3. **API Keys** → Create API key (Full access)
4. SMTP credentials: host `smtp.resend.com`, port `465`, user `resend`, pass `re_xxx`

---

## Step 6 — Vercel (Next.js)

1. **[vercel.com](https://vercel.com)** → Add New Project → Import Git Repository
2. Select your GitHub repo
3. **Framework Preset:** Next.js (auto-detected)
4. **Root Directory:** `apps/web`  ← important for monorepo
5. **Build Command:** `pnpm build` (Vercel detects pnpm via `packageManager` field)
6. **Region:** `fra1` (Frankfurt)

### 6a. Add environment variables in Vercel

In Project → Settings → Environment Variables, add:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://<your-api>.up.railway.app` (or `api.yourdomain.com`) |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<project>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API → anon/publishable key |

### 6b. Custom domain

Vercel → Domains → Add `app.yourdomain.com` → update DNS as shown.

---

## Step 7 — GitHub Actions Secrets

In your GitHub repo → **Settings → Secrets and variables → Actions**, add:

| Secret | Where to find |
|---|---|
| `VERCEL_TOKEN` | vercel.com → Account Settings → Tokens |
| `VERCEL_ORG_ID` | vercel.com → Account Settings → General |
| `VERCEL_PROJECT_ID` | Vercel project → Settings → General |

CI (`.github/workflows/deploy.yml`) runs lint → test → build API/worker images
(GHCR, tagged `:latest` + `:${{ github.sha }}` for rollback) → deploy web to
Vercel. Railway deploys the API + worker itself on push to `main`.

---

## Step 8 — DNS Records

| Record | Type | Value |
|---|---|---|
| `app.yourdomain.com` | CNAME | `cname.vercel-dns.com` |
| `api.yourdomain.com` | CNAME | Railway service domain (Settings → Networking) |

---

## Step 9 — First Deploy

Push to `main`:

```bash
git push origin main
```

GitHub Actions will:
1. **check** — typecheck all packages
2. **test** — run tests against postgres + redis service containers (+ integration via Testcontainers)
3. **build-api / build-worker** — build + push images to GHCR
4. **deploy-web** — deploy Next.js to Vercel

Railway picks up the same push and redeploys the API + worker. On first deploy the
API runs `prisma migrate deploy` before starting.

---

## Authentication (Supabase Auth)

Supabase Auth is the active provider — there is no separate auth server to run.
The API validates the Supabase JWT, extracting the user id and `tenantId`; every
endpoint is protected by a global guard (opt out with `@Public()`), and every
query still filters by `tenantId`. A legacy Keycloak path remains in the
composite guard for migration only and is being retired — do not stand up a new
Keycloak instance.

---

## Company register sync (LV/LT)

LV/LT search is backed by the Postgres `company_register` table with a `pg_trgm`
GIN index — no Elasticsearch. Seed/refresh it from the government CSVs:

```bash
cd apps/api && pnpm sync:lv
cd apps/api && pnpm sync:lt
```

In production the worker runs these as nightly repeatable BullMQ jobs (LV 02:00,
LT 03:00 UTC). FI (PRH) and EE (Äriregister) are live HTTP lookups, no sync.

---

## Troubleshooting

| Symptom | Check |
|---|---|
| API won't boot in prod | Insecure default secrets — set strong `IMPERSONATION_SECRET` / `ARCHIVE_ENCRYPTION_KEY` (see `secret-guard.ts`) |
| API returns 5xx | Railway service logs — usually `DATABASE_URL` / pooled connection |
| Migrations fail | `DIRECT_URL` must be the session pooler (port 5432) |
| Auth 401s | `SUPABASE_URL` set? JWKS reachable? token issuer matches `${SUPABASE_URL}/auth/v1` |
| LV/LT search empty | Run `pnpm sync:lv` / `sync:lt`, or check the worker's nightly sync logs |
| Vercel build fails | Check `apps/web` root directory setting in the Vercel project |
