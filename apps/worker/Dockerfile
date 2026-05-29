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
COPY apps/api/prisma    ./apps/api/prisma
COPY apps/worker        ./apps/worker

RUN pnpm install --frozen-lockfile --ignore-scripts

# Generate Prisma client types — worker uses the same DB schema as the API
RUN node_modules/.bin/prisma generate --schema=apps/api/prisma/schema.prisma

RUN pnpm --filter @invoice/worker run build

# ── Stage 4: runner ───────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
RUN apk add --no-cache libc6-compat dumb-init

RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 worker

ENV NODE_ENV=production
WORKDIR /app

COPY --from=deps    --chown=worker:nodejs /app/node_modules ./node_modules

COPY --from=builder --chown=worker:nodejs /app/packages/shared-types/dist       ./packages/shared-types/dist
COPY --from=builder --chown=worker:nodejs /app/packages/shared-types/package.json ./packages/shared-types/package.json
COPY --from=builder --chown=worker:nodejs /app/packages/vat-engine/dist         ./packages/vat-engine/dist
COPY --from=builder --chown=worker:nodejs /app/packages/vat-engine/package.json   ./packages/vat-engine/package.json

COPY --from=builder --chown=worker:nodejs /app/apps/worker/dist        ./apps/worker/dist
COPY --from=builder --chown=worker:nodejs /app/apps/worker/package.json ./apps/worker/package.json

USER worker
WORKDIR /app/apps/worker

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
