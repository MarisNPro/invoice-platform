# ══════════════════════════════════════════════════════════════════════════════
# Invoice Platform — Worker (BullMQ)
# Multi-stage pnpm monorepo build — Node 20 Alpine
#
# Build context: monorepo root  (docker build -f apps/worker/Dockerfile .)
# ══════════════════════════════════════════════════════════════════════════════

# ── Stage 1: base ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat
RUN corepack enable && corepack prepare pnpm@9.4.0 --activate
ENV PNPM_HOME="/usr/local/share/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

# ── Stage 2: deps ─────────────────────────────────────────────────────────────
FROM base AS deps
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY apps/api/package.json          ./apps/api/
COPY apps/worker/package.json       ./apps/worker/
COPY apps/web/package.json          ./apps/web/
COPY apps/doc-engine/package.json   ./apps/doc-engine/
COPY packages/shared-types/package.json  ./packages/shared-types/
COPY packages/vat-engine/package.json    ./packages/vat-engine/
COPY packages/ubl-builder/package.json   ./packages/ubl-builder/
COPY packages/en16931/package.json       ./packages/en16931/
COPY packages/i18n/package.json          ./packages/i18n/
COPY packages/ui/package.json            ./packages/ui/

RUN pnpm install --frozen-lockfile

# ── Stage 3: builder ──────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules

COPY tsconfig.base.json ./
COPY packages/shared-types  ./packages/shared-types
COPY packages/vat-engine    ./packages/vat-engine
COPY apps/worker            ./apps/worker

RUN pnpm install --frozen-lockfile --ignore-scripts

# Build packages the worker depends on
RUN pnpm --filter @invoice/shared-types run build
RUN pnpm --filter @invoice/vat-engine   run build

# Build worker (tsc → apps/worker/dist/)
RUN pnpm --filter @invoice/worker run build

# ── Stage 4: runner ───────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
RUN apk add --no-cache libc6-compat dumb-init

RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 worker

ENV NODE_ENV=production
WORKDIR /app

COPY --from=deps    --chown=worker:nodejs /app/node_modules ./node_modules

COPY --from=builder --chown=worker:nodejs /app/packages/shared-types/dist    ./packages/shared-types/dist
COPY --from=builder --chown=worker:nodejs /app/packages/shared-types/package.json ./packages/shared-types/package.json
COPY --from=builder --chown=worker:nodejs /app/packages/vat-engine/dist      ./packages/vat-engine/dist
COPY --from=builder --chown=worker:nodejs /app/packages/vat-engine/package.json   ./packages/vat-engine/package.json

COPY --from=builder --chown=worker:nodejs /app/apps/worker/dist     ./apps/worker/dist
COPY --from=builder --chown=worker:nodejs /app/apps/worker/package.json ./apps/worker/package.json

USER worker
WORKDIR /app/apps/worker

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
