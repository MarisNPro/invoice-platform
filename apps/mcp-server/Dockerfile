FROM node:20-alpine AS base
WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy workspace root manifests
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/mcp-server/package.json ./apps/mcp-server/

# Install only mcp-server deps (no other workspaces needed at runtime)
RUN pnpm install --filter @invoice-platform/mcp-server --frozen-lockfile

# Copy source and build
COPY apps/mcp-server/ ./apps/mcp-server/
WORKDIR /app/apps/mcp-server
RUN pnpm build

# ── Runtime ───────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app

COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/apps/mcp-server/dist ./dist
COPY --from=base /app/apps/mcp-server/package.json ./

EXPOSE 4020
CMD ["node", "dist/main.js"]
