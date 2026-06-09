# ══════════════════════════════════════════════════════════════════════════════
# Invoice Platform — API (NestJS + Fastify)
# Multi-stage pnpm monorepo build — Node 20 Alpine
#
# Build context: monorepo root  (docker build -f apps/api/Dockerfile .)
# ══════════════════════════════════════════════════════════════════════════════

# ── Stage 1: base ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat
RUN corepack enable && corepack prepare pnpm@9.4.0 --activate
ENV PNPM_HOME="/usr/local/share/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

# ── Stage 2: deps (layer-cached on lockfile change) ───────────────────────────
FROM base AS deps
WORKDIR /app

# Root manifests + .npmrc (contains shamefully-hoist and peer-dep settings)
COPY .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./

# pnpm requires ALL workspace member package.json files to resolve the graph —
# pnpm-workspace.yaml declares "apps/*" so every app must be present here.
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

# node_modules from deps (includes pnpm virtual store)
COPY --from=deps /app/node_modules ./node_modules

# Root manifests needed so the workspace-symlink reinstall below can resolve
COPY .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json          ./apps/api/
COPY apps/worker/package.json       ./apps/worker/
COPY apps/web/package.json          ./apps/web/
COPY apps/doc-engine/package.json   ./apps/doc-engine/
COPY apps/mcp-server/package.json   ./apps/mcp-server/

# Full source for the API and its workspace package dependencies
COPY tsconfig.base.json ./
COPY packages/shared-types  ./packages/shared-types
COPY packages/vat-engine    ./packages/vat-engine
COPY packages/ubl-builder   ./packages/ubl-builder
COPY packages/en16931       ./packages/en16931
COPY packages/i18n          ./packages/i18n
COPY packages/company-sync  ./packages/company-sync
COPY apps/api               ./apps/api

# Reinstall to wire workspace symlinks into the build tree
RUN pnpm install --frozen-lockfile --ignore-scripts

# Generate Prisma client (no DB needed — generates TypeScript types only)
RUN pnpm --filter @invoice/api exec \
    prisma generate --schema=./prisma/schema.prisma

# Build workspace packages in dependency order
RUN pnpm --filter @invoice/shared-types run build
RUN pnpm --filter @invoice/vat-engine   run build
RUN pnpm --filter @invoice/ubl-builder  run build
RUN pnpm --filter @invoice/en16931      run build
RUN pnpm --filter @invoice/i18n         run build
RUN pnpm --filter @invoice/company-sync run build

# Build NestJS API (tsc → apps/api/dist/)
RUN pnpm --filter @invoice/api run build

# ── Stage 4: runner (minimal production image) ────────────────────────────────
FROM node:20-alpine AS runner
# openssl: required at runtime by Prisma's query/schema engine. Without it the
# engine fails to detect libssl, defaults to openssl-1.1.x, and crashes with
# "Could not parse schema engine response" on Alpine (musl + OpenSSL 3.x).
RUN apk add --no-cache libc6-compat dumb-init openssl

# Non-root user
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nestjs

ENV NODE_ENV=production
ENV PORT=4000
WORKDIR /app

# The Prisma client is generated in the builder stage (deps installs with
# --ignore-scripts, so it has no client). With shamefully-hoist=false the client
# lives in the pnpm store (node_modules/.pnpm) and is reached via the symlinks in
# apps/api/node_modules — so copy BOTH trees from builder, not deps. Copying
# node_modules/.prisma or /@prisma directly does NOT work (those paths don't
# exist at the top level). Same fix as apps/worker/Dockerfile.
COPY --from=builder --chown=nestjs:nodejs /app/node_modules          ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/apps/api/node_modules ./apps/api/node_modules

COPY --from=builder --chown=nestjs:nodejs /app/packages/shared-types/dist       ./packages/shared-types/dist
COPY --from=builder --chown=nestjs:nodejs /app/packages/shared-types/package.json ./packages/shared-types/package.json
COPY --from=builder --chown=nestjs:nodejs /app/packages/vat-engine/dist         ./packages/vat-engine/dist
COPY --from=builder --chown=nestjs:nodejs /app/packages/vat-engine/package.json   ./packages/vat-engine/package.json
COPY --from=builder --chown=nestjs:nodejs /app/packages/ubl-builder/dist        ./packages/ubl-builder/dist
COPY --from=builder --chown=nestjs:nodejs /app/packages/ubl-builder/package.json  ./packages/ubl-builder/package.json
# ubl-builder requires xmlbuilder2 at runtime. With shamefully-hoist=false it is
# NOT at top-level node_modules — only in the .pnpm store (copied above) and
# symlinked from here. This is the only workspace package with an external
# runtime dep, so it's the only packages/*/node_modules the runner needs.
COPY --from=builder --chown=nestjs:nodejs /app/packages/ubl-builder/node_modules ./packages/ubl-builder/node_modules
COPY --from=builder --chown=nestjs:nodejs /app/packages/en16931/dist            ./packages/en16931/dist
COPY --from=builder --chown=nestjs:nodejs /app/packages/en16931/package.json      ./packages/en16931/package.json
COPY --from=builder --chown=nestjs:nodejs /app/packages/i18n/dist               ./packages/i18n/dist
COPY --from=builder --chown=nestjs:nodejs /app/packages/i18n/package.json         ./packages/i18n/package.json
# company-sync has external runtime deps (axios, csv-parse) reached via its
# node_modules symlinks — copy them like ubl-builder. The API imports it at boot.
COPY --from=builder --chown=nestjs:nodejs /app/packages/company-sync/dist         ./packages/company-sync/dist
COPY --from=builder --chown=nestjs:nodejs /app/packages/company-sync/package.json ./packages/company-sync/package.json
COPY --from=builder --chown=nestjs:nodejs /app/packages/company-sync/node_modules ./packages/company-sync/node_modules

COPY --from=builder --chown=nestjs:nodejs /app/apps/api/dist        ./apps/api/dist
COPY --from=builder --chown=nestjs:nodejs /app/apps/api/prisma      ./apps/api/prisma
COPY --from=builder --chown=nestjs:nodejs /app/apps/api/package.json ./apps/api/package.json

USER nestjs
WORKDIR /app/apps/api
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:4000/api/v1/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["sh", "-c", \
  "npx prisma migrate deploy --schema=./prisma/schema.prisma && \
   node dist/main.js"]
