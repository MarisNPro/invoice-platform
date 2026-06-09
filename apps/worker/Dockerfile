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

COPY .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./

# pnpm requires ALL workspace member package.json files to resolve the graph
COPY apps/api/package.json          ./apps/api/
COPY apps/worker/package.json       ./apps/worker/
COPY apps/web/package.json          ./apps/web/
COPY apps/doc-engine/package.json   ./apps/doc-engine/
COPY apps/mcp-server/package.json   ./apps/mcp-server/
COPY packages/ ./packages/

RUN pnpm install --frozen-lockfile --ignore-scripts

# ── Stage 3: builder ──────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules

# Root manifests needed so the workspace-symlink reinstall can resolve
COPY .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json          ./apps/api/
COPY apps/worker/package.json       ./apps/worker/
COPY apps/web/package.json          ./apps/web/
COPY apps/doc-engine/package.json   ./apps/doc-engine/
COPY apps/mcp-server/package.json   ./apps/mcp-server/

COPY tsconfig.base.json ./
COPY apps/api/prisma        ./apps/api/prisma
COPY packages/company-sync  ./packages/company-sync
COPY apps/worker            ./apps/worker

RUN pnpm install --frozen-lockfile --ignore-scripts

# Generate Prisma client types — worker uses the same DB schema as the API
RUN pnpm --filter @invoice/worker exec prisma generate --schema=../api/prisma/schema.prisma

# Build the shared sync package before the worker (worker imports @invoice/company-sync)
RUN pnpm --filter @invoice/company-sync run build

RUN pnpm --filter @invoice/worker run build

# ── Stage 4: runner ───────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
# openssl: required at runtime by Prisma's query engine. Without it the engine
# fails to detect libssl, defaults to openssl-1.1.x, and crashes on Alpine
# (musl + OpenSSL 3.x). Worker shares apps/api/prisma/schema.prisma, whose
# binaryTargets already include linux-musl-openssl-3.0.x.
RUN apk add --no-cache libc6-compat dumb-init openssl

RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 worker

ENV NODE_ENV=production
WORKDIR /app

# With shamefully-hoist=false, @prisma/client and the generated client live in
# the pnpm virtual store (node_modules/.pnpm), and the worker resolves its deps
# via symlinks in apps/worker/node_modules → that store. Copy both trees FROM
# THE BUILDER (where `prisma generate` ran) so the symlinks resolve and the
# generated client is present. Copying from deps would ship an ungenerated stub.
COPY --from=builder --chown=worker:nodejs /app/node_modules             ./node_modules
COPY --from=builder --chown=worker:nodejs /app/apps/worker/node_modules ./apps/worker/node_modules

COPY --from=builder --chown=worker:nodejs /app/apps/worker/dist         ./apps/worker/dist
COPY --from=builder --chown=worker:nodejs /app/apps/worker/package.json ./apps/worker/package.json

# Shared @invoice/company-sync (dist + its axios/csv-parse runtime deps reached
# via the pnpm-store symlinks in its node_modules). The worker requires it at
# startup, so the runner must include it — same approach as ubl-builder in the API.
COPY --from=builder --chown=worker:nodejs /app/packages/company-sync/dist         ./packages/company-sync/dist
COPY --from=builder --chown=worker:nodejs /app/packages/company-sync/package.json ./packages/company-sync/package.json
COPY --from=builder --chown=worker:nodejs /app/packages/company-sync/node_modules ./packages/company-sync/node_modules

USER worker
WORKDIR /app/apps/worker

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
