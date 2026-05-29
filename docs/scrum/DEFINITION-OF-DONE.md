# Definition of Done — Invoice Platform

**Last updated:** 2026-05-29

A backlog item is **Done** only when every box below is checked. "Code complete" is not Done.
These mirror the non-negotiable rules in `CLAUDE.md` and the weekly quality gates.

---

## Per-feature checklist

Every feature / user story must satisfy:

- [ ] **TypeScript: 0 errors** — `pnpm turbo run typecheck` clean
- [ ] **ESLint: 0 warnings** — `pnpm lint` clean
- [ ] **Tests: at least 3 new tests added** — and the total test count never decreases
- [ ] **Tenant isolation** — every Prisma query is scoped with `where: { tenantId }` (no exceptions)
- [ ] **No `console.log` in production code** — use the NestJS `Logger`
- [ ] **API endpoint has DTO validation** — `@IsString()` / `@IsUUID()` / etc., behind the global `ValidationPipe` (`whitelist: true`)
- [ ] **EN 16931 compliance** *(invoice features only)* — amounts `Decimal(15,2)`, VAT BG-22 + BG-23, seller/buyer snapshotted, numbering via `next_invoice_number()`
- [ ] **Committed to `main` with a conventional commit message** — e.g. `feat(invoice): …`, `fix(docker): …`, `docs: …`
- [ ] **Weekly quality gate still passing** — the sprint's gate checks remain green after merge

---

## How each item is verified

| Item | Command / Evidence |
|---|---|
| TypeScript 0 errors | `pnpm turbo run typecheck` |
| ESLint 0 warnings | `pnpm lint` |
| ≥3 new tests, count not decreasing | `pnpm turbo test` — compare cumulative count in `SPRINT-LOG.md` |
| Tenant isolation | Code review + grep for `findMany`/`findFirst` without `tenantId` |
| No `console.log` | `grep -rn "console.log" apps/ --include="*.ts"` excluding tests/seed/mcp → 0 |
| DTO validation | DTO file present; route uses `ValidationPipe` |
| EN 16931 | UBL validation checks pass; PDF carries mandatory BT fields |
| Conventional commit | `git log` message format |
| Quality gate | Sprint gate annotation in the master plan / `SPRINT-LOG.md` |

---

## Definition of Done does **not** include (tracked separately)
- Production env-var configuration (release/ops task, not feature DoD)
- Penetration test / external security review (pre-launch gate)
- Localisation of all 14 languages for new UI strings *(target before GA, not per-PR)*

---

## Notes
- **Security-sensitive changes** (auth, secrets, tenant scoping) additionally require explicit reviewer sign-off and must not introduce insecure defaults that can run in `NODE_ENV=production`.
- **Database changes** ship with a Prisma migration in the same PR; run `db:generate` before build.
