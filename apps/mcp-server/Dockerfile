FROM node:20-alpine AS base
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/mcp-server/package.json ./apps/mcp-server/

RUN pnpm install --filter @invoice-platform/mcp-server --frozen-lockfile

COPY apps/mcp-server/ ./apps/mcp-server/
WORKDIR /app/apps/mcp-server
RUN pnpm build

# pnpm deploy creates a flat node_modules (no store symlinks) safe to COPY between stages
WORKDIR /app
RUN pnpm --filter @invoice-platform/mcp-server deploy /prod

# ── Runtime ───────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app

COPY --from=base /prod/node_modules ./node_modules
COPY --from=base /app/apps/mcp-server/dist ./dist
COPY --from=base /app/apps/mcp-server/package.json ./

EXPOSE 4020
CMD ["node", "dist/main.js"]
