# Invoice Platform — Production Setup Guide

Full end-to-end setup for deploying the EU invoice platform.  
**Estimated time:** ~2 hours from zero to live.  
**Estimated cost:** ~$62/month.

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
│              Next.js 14 App Router  ·  CDN edge                    │
│              apps/web  —  app.yourdomain.com                        │
└────────────┬────────────────────────────────────────────────────────┘
             │ REST /api/v1                    │ OIDC (Keycloak)
             ▼                                 ▼
┌────────────────────────┐       ┌─────────────────────────┐
│  HETZNER CX32 (Coolify)│       │  KEYCLOAK 24             │
│  Falkenstein DC        │       │  Coolify service         │
│                        │       │  auth.yourdomain.com     │
│  ┌──────────────────┐  │       └─────────────────────────┘
│  │  API  :4000      │  │
│  │  (NestJS+Fastify)│◄─┼─── Supabase PG (pooled)
│  └────────┬─────────┘  │       (EU Frankfurt)
│           │            │
│  ┌────────▼─────────┐  │◄──── Upstash Redis (EU Frankfurt)
│  │  Worker          │  │
│  │  (BullMQ)        │  │◄──── Hetzner Object Storage FSN1
│  └────────┬─────────┘  │
│           │            │◄──── Resend (email)
│  ┌────────▼─────────┐  │
│  │  Elasticsearch 8 │  │
│  │  (companies idx) │  │
│  └──────────────────┘  │
└────────────────────────┘
```

---

## Monthly Cost Breakdown (~$62/mo)

| Service | Plan | Region | Cost |
|---|---|---|---|
| **Supabase** | Pro | EU Frankfurt | $25/mo |
| **Vercel** | Pro | fra1 | $20/mo |
| **Hetzner CX32** | 4 vCPU · 8 GB RAM · 80 GB SSD | Falkenstein | $14.16/mo |
| **Hetzner Object Storage** | 1 TB | FSN1 | $5.93/mo |
| **Upstash Redis** | Pay-as-you-go | EU (Frankfurt) | ~$1–3/mo |
| **Resend** | Starter (3k/mo free) | — | $0/mo |
| **Total** | | | **~$66–68/mo** |

> Scale down to Hetzner CX22 ($6/mo) for early stage → saves ~$8.

---

## Step 1 — Supabase (PostgreSQL)

1. Go to **[app.supabase.com](https://app.supabase.com)** → New project
2. **Name:** `invoice-platform`
3. **Region:** `EU West (Frankfurt)`  ← critical for GDPR
4. **Database password:** generate strong password, save it
5. After provisioning, go to **Settings → Database**:
   - Copy **Transaction pooler** URL (port 6543) → `DATABASE_URL`
   - Copy **Session pooler** URL (port 5432) → `DIRECT_URL`
6. Enable **pg_crypt** extension: SQL Editor → `CREATE EXTENSION IF NOT EXISTS pgcrypto;`

> Supabase Pro includes point-in-time recovery, daily backups, and the Frankfurt region.

---

## Step 2 — Upstash Redis

1. Go to **[console.upstash.com](https://console.upstash.com)** → Create Database
2. **Name:** `invoice-platform`
3. **Type:** Regional · **Region:** `eu-west-1 (Frankfurt)`
4. **TLS:** enabled
5. Copy **UPSTASH_REDIS_REST_URL** → convert to `rediss://default:token@host:6380`  
   OR use the **ioredis** connection string from the Connect tab directly.

---

## Step 3 — Hetzner Server (Coolify)

### 3a. Create server

1. **[console.hetzner.com](https://console.hetzner.com)** → Servers → Add Server
2. **Location:** Falkenstein (FSN1)
3. **Image:** Ubuntu 22.04 LTS
4. **Type:** CX32 (4 vCPU · 8 GB · $14.16/mo) — or CX22 for early stage
5. **SSH keys:** add your public key
6. **Firewall:** allow 22 (SSH), 80 (HTTP), 443 (HTTPS), 8000 (Coolify UI)

### 3b. Install Coolify

SSH into the server and run the one-liner:

```bash
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
```

Coolify installs Docker, sets up Traefik (reverse proxy), and starts the Coolify UI on port 8000.

### 3c. Configure Coolify

1. Browse to `http://<server-ip>:8000` → create admin account
2. **Settings → Domain:** set `coolify.yourdomain.com` (point DNS first)
3. **GitHub:** Settings → Source → Add GitHub App → authorize repo access
4. **GitHub Actions integration:** Settings → API → Create API token (for webhook)

### 3d. Add services in Coolify

Add each of these as a **Docker Compose** service, pointing to the repo:

| Service | Compose file | Port |
|---|---|---|
| API | `infra/deploy/docker-compose.prod.yml` | 4000 |
| Keycloak | separate compose | 8080 |

Set environment variables from `infra/deploy/.env.production.example` in Coolify's env editor.

---

## Step 4 — Hetzner Object Storage

1. **console.hetzner.com** → Object Storage → Create bucket
2. **Location:** Falkenstein (FSN1)
3. **Name:** `invoice-platform-prod`
4. **Access:** Private
5. Create **Access Keys**: Object Storage → Access Keys → Generate Key Pair
6. Note the endpoint: `https://fsn1.your-objectstorage.com`

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
6. **Output Directory:** `.next` (default)

### 6a. Add environment variables in Vercel

In Project → Settings → Environment Variables, add:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://api.yourdomain.com` |
| `NEXT_PUBLIC_KEYCLOAK_URL` | `https://auth.yourdomain.com` |
| `NEXT_PUBLIC_KEYCLOAK_REALM` | `invoice-platform` |
| `NEXT_PUBLIC_KEYCLOAK_CLIENT_ID` | `invoice-web` |

Or use **Vercel environment variable groups** (referenced as `@api_url` etc. in `vercel.json`).

### 6b. Custom domain

Vercel → Domains → Add `app.yourdomain.com` → update DNS as shown.

---

## Step 7 — GitHub Actions Secrets

In your GitHub repo → **Settings → Secrets and variables → Actions**,  
add these repository secrets:

| Secret | Where to find |
|---|---|
| `VERCEL_TOKEN` | vercel.com → Account Settings → Tokens |
| `VERCEL_ORG_ID` | vercel.com → Account Settings → General |
| `VERCEL_PROJECT_ID` | Vercel project → Settings → General |
| `COOLIFY_API_WEBHOOK` | Coolify → Service → Deployments → Webhook URL |
| `COOLIFY_WORKER_WEBHOOK` | Coolify → Worker service webhook URL |
| `COOLIFY_WEBHOOK_TOKEN` | Coolify → Settings → API → Token |

---

## Step 8 — DNS Records

Point all subdomains to the relevant services:

| Record | Type | Value |
|---|---|---|
| `app.yourdomain.com` | CNAME | `cname.vercel-dns.com` |
| `api.yourdomain.com` | A | `<Hetzner server IP>` |
| `auth.yourdomain.com` | A | `<Hetzner server IP>` |

---

## Step 9 — First Deploy

Push to `main`:

```bash
git push origin main
```

GitHub Actions will:
1. **check** job: typecheck all packages
2. **test** job: run tests against postgres + redis service containers
3. **deploy-web** job: deploy Next.js to Vercel
4. **deploy-api** job: trigger Coolify to pull + redeploy API + Worker

On first deploy, the API container runs `prisma migrate deploy` before starting,  
which applies both migrations:
- `20260527000000_init` — all tables, indexes, FKs
- `20260527000001_functions` — `next_invoice_number()` PL/pgSQL function

---

## Keycloak Realm Setup (Quick Start)

1. Browse to `https://auth.yourdomain.com/admin`
2. Create realm: `invoice-platform`
3. Create clients:
   - `invoice-api` (confidential, bearer-only) — copy client secret to env
   - `invoice-web` (public, PKCE) — add redirect URI `https://app.yourdomain.com/*`
4. Create realm roles: `invoice-admin`, `invoice-accountant`, `invoice-viewer`
5. Create mapper: User Attribute `tenant_id` → Token Claim `tenant_id`

---

## Maintenance

```bash
# View logs (on Hetzner server)
docker compose -f infra/deploy/docker-compose.prod.yml logs -f api

# Manually trigger company sync
docker compose -f infra/deploy/docker-compose.prod.yml exec api \
  node -e "require('./dist/company/company.service').CompanyService"

# Backup Elasticsearch index
docker compose -f infra/deploy/docker-compose.prod.yml exec elasticsearch \
  curl -X PUT http://localhost:9200/_snapshot/backup

# Scale worker concurrency (no restart needed — env var)
# Edit WORKER_CONCURRENCY in Coolify env → redeploy
```

---

## Troubleshooting

| Symptom | Check |
|---|---|
| API returns 502 | `docker logs invoice-platform-prod-api-1` — usually DB connection |
| Migrations fail | Check `DIRECT_URL` (must be session pooler, port 5432) |
| JWKS fetch fails | Keycloak URL reachable from API container? `docker exec api wget auth.yourdomain.com` |
| ES index empty | Worker logs — check LV/LT CSV URLs are reachable |
| Vercel build fails | Check `apps/web` root directory setting in Vercel project |
