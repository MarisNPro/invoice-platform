# ══════════════════════════════════════════════════════════════════════════════
# Invoice Platform — API (NestJS + Fastify)
# Multi-stage pnpm monorepo build — Node 20 Alpine
#
# Build context: monorepo root  (docker build -f apps/api/Dockerfile .)
# ══════════════════════════════════════════════════════════════════════════════

# ── Stage 1: base ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat
# Enable corepack so pnpm is pinned to exactly the workspace version
RUN corepack enable && corepack prepare pnpm@9.4.0 --activate
ENV PNPM_HOME="/usr/local/share/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

# ── Stage 2: deps (layer-cached on lockfile change) ───────────────────────────
FROM base AS deps
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/ ./packages/
RUN pnpm install --frozen-lockfile --ignore-scripts

# ── Stage 3: builder ──────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app

# Bring in installed node_modules from deps stage
COPY --from=deps /app/node_modules       ./node_modules

# Copy full source (only what's needed for the API + its workspace deps)
COPY tsconfig.base.json ./
COPY packages/shared-types  ./packages/shared-types
COPY packages/vat-engine    ./packages/vat-engine
COPY packages/ubl-builder   ./packages/ubl-builder
COPY packages/en16931       ./packages/en16931
COPY packages/i18n          ./packages/i18n
COPY apps/api               ./apps/api

# Reinstall to create workspace symlinks inside the build tree
RUN pnpm install --frozen-lockfile --ignore-scripts

# Generate Prisma client (no DB needed, generates TypeScript types only)
RUN pnpm --filter @invoice/api exec \
    prisma generate --schema=./prisma/schema.prisma

# Build workspace packages in dependency order (API imports from these)
RUN pnpm --filter @invoice/shared-types run build
RUN pnpm --filter @invoice/vat-engine   run build
RUN pnpm --filter @invoice/ubl-builder  run build
RUN pnpm --filter @invoice/en16931      run build
RUN pnpm --filter @invoice/i18n         run build

# Build NestJS API (tsc → apps/api/dist/)
RUN pnpm --filter @invoice/api run build

# ── Stage 4: runner (minimal production image) ────────────────────────────────
FROM node:20-alpine AS runner
RUN apk add --no-cache libc6-compat dumb-init

# Non-root user
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nestjs

ENV NODE_ENV=production
ENV PORT=4000
WORKDIR /app

# ── node_modules ──────────────────────────────────────────────────────────────
# Copy full node_modules from deps (includes pnpm virtual store + workspace symlinks)
COPY --from=deps    --chown=nestjs:nodejs /app/node_modules ./node_modules

# ── workspace packages ────────────────────────────────────────────────────────
# The API's dist/ requires these at runtime via node_modules symlinks.
# Each package's main now points to ./dist/index.js (set in package.json).
COPY --from=builder --chown=nestjs:nodejs /app/packages/shared-types/dist    ./packages/shared-types/dist
COPY --from=builder --chown=nestjs:nodejs /app/packages/shared-types/package.json ./packages/shared-types/package.json
COPY --from=builder --chown=nestjs:nodejs /app/packages/vat-engine/dist      ./packages/vat-engine/dist
COPY --from=builder --chown=nestjs:nodejs /app/packages/vat-engine/package.json   ./packages/vat-engine/package.json
COPY --from=builder --chown=nestjs:nodejs /app/packages/ubl-builder/dist     ./packages/ubl-builder/dist
COPY --from=builder --chown=nestjs:nodejs /app/packages/ubl-builder/package.json  ./packages/ubl-builder/package.json
COPY --from=builder --chown=nestjs:nodejs /app/packages/en16931/dist         ./packages/en16931/dist
COPY --from=builder --chown=nestjs:nodejs /app/packages/en16931/package.json      ./packages/en16931/package.json
COPY --from=builder --chown=nestjs:nodejs /app/packages/i18n/dist            ./packages/i18n/dist
COPY --from=builder --chown=nestjs:nodejs /app/packages/i18n/package.json         ./packages/i18n/package.json

# ── application ───────────────────────────────────────────────────────────────
COPY --from=builder --chown=nestjs:nodejs /app/apps/api/dist     ./apps/api/dist
COPY --from=builder --chown=nestjs:nodejs /app/apps/api/prisma   ./apps/api/prisma
COPY --from=builder --chown=nestjs:nodejs /app/apps/api/package.json ./apps/api/package.json

USER nestjs
WORKDIR /app/apps/api
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:4000/api/v1/health || exit 1

# dumb-init reaps orphan processes; migrate deploy is idempotent
ENTRYPOINT ["dumb-init", "--"]
CMD ["sh", "-c", \
  "node -e \"require('@prisma/client')\" && \
   npx prisma migrate deploy --schema=./prisma/schema.prisma && \
   node dist/main.js"]
