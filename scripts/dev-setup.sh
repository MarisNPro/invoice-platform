#!/usr/bin/env bash
# ── dev-setup.sh ─────────────────────────────────────────────────────────────
# Full local dev environment bootstrap.
# Run once after cloning; safe to re-run (all steps are idempotent).
#
# Usage:  bash scripts/dev-setup.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

info()  { echo -e "\033[1;34m[setup]\033[0m $*"; }
ok()    { echo -e "\033[1;32m[  ok ]\033[0m $*"; }
die()   { echo -e "\033[1;31m[error]\033[0m $*" >&2; exit 1; }

# ── Prerequisites ─────────────────────────────────────────────────────────────
command -v docker  >/dev/null 2>&1 || die "Docker Desktop not found. Install from https://www.docker.com/products/docker-desktop"
command -v pnpm    >/dev/null 2>&1 || die "pnpm not found. Run: npm install -g pnpm"
command -v node    >/dev/null 2>&1 || die "Node.js not found. Install v20+ from https://nodejs.org"

info "node $(node -v)  pnpm $(pnpm -v)"

# ── .env ──────────────────────────────────────────────────────────────────────
if [[ ! -f .env ]]; then
  cp .env.example .env
  ok ".env created from .env.example"
else
  ok ".env already exists"
fi

# ── Dependencies ──────────────────────────────────────────────────────────────
info "pnpm install…"
pnpm install --frozen-lockfile
ok "dependencies installed"

# ── Docker stack ──────────────────────────────────────────────────────────────
info "starting Docker services…"
docker compose up -d
ok "containers started"

# ── Wait for Postgres ─────────────────────────────────────────────────────────
info "waiting for Postgres to be healthy…"
RETRIES=30
until docker compose exec -T postgres pg_isready -U invoice -d invoice_platform -q 2>/dev/null; do
  RETRIES=$((RETRIES - 1))
  [[ $RETRIES -eq 0 ]] && die "Postgres did not become healthy in time"
  echo -n "."
  sleep 2
done
echo ""
ok "Postgres is ready"

# ── Wait for Elasticsearch ────────────────────────────────────────────────────
info "waiting for Elasticsearch…"
RETRIES=30
until curl -fs http://localhost:9200/_cluster/health 2>/dev/null | grep -qv '"status":"red"'; do
  RETRIES=$((RETRIES - 1))
  [[ $RETRIES -eq 0 ]] && die "Elasticsearch did not become healthy in time"
  echo -n "."
  sleep 3
done
echo ""
ok "Elasticsearch is ready"

# ── Build ─────────────────────────────────────────────────────────────────────
info "building all packages…"
pnpm build
ok "build complete"

# ── Prisma migrate ────────────────────────────────────────────────────────────
info "running Prisma migrations (prisma migrate deploy)…"
pnpm db:migrate
ok "migrations applied"

# ── Seed ─────────────────────────────────────────────────────────────────────
info "seeding database…"
pnpm db:seed
ok "seed complete"

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "✅  Dev environment ready!"
echo ""
echo "  Services:"
echo "    API:          http://localhost:3001/api/v1/health"
echo "    Web:          http://localhost:3000"
echo "    Keycloak:     http://localhost:8080  (admin/admin)"
echo "    MinIO:        http://localhost:9001  (minioadmin/minioadmin)"
echo "    MailHog:      http://localhost:8025"
echo "    BullBoard:    http://localhost:3100"
echo "    Elasticsearch:http://localhost:9200"
echo ""
echo "  Start dev servers:  pnpm dev"
echo "  Reset everything:   pnpm db:reset && bash scripts/dev-setup.sh"
