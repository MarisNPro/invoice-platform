-- Keycloak → Supabase Auth migration (Phase 1, additive).
-- Nullable Supabase Auth user id link on User; no data backfilled yet.

-- AlterTable
ALTER TABLE "users" ADD COLUMN "supabaseUserId" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "users_supabaseUserId_key" ON "users"("supabaseUserId");

-- CreateIndex
CREATE INDEX "users_supabaseUserId_idx" ON "users"("supabaseUserId");
