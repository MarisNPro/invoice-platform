Before building any feature, run through this checklist and confirm each item:

1. **Check for existing code** — search `apps/api/src/` (and `apps/api/src/modules/` if it exists) for similar functionality before writing new code. Reuse or extend what's there.

2. **Follow the module pattern** — new API features must have a `*.controller.ts`, `*.service.ts`, and `*.module.ts`. Register the module in `AppModule`.

3. **Scope every DB query to tenantId** — every Prisma query must include `where: { tenantId }` (or equivalent). No query may return cross-tenant data.

4. **Validate all input with class-validator** — every controller endpoint must accept a DTO class decorated with `class-validator` decorators (`@IsString()`, `@IsUUID()`, etc.) and `class-transformer`. No raw `req.body` access.

5. **Write at least 3 unit tests** — cover the happy path, one validation/edge case, and one error/not-found case. Place them in a `*.spec.ts` file alongside the service.

6. **Run typecheck before committing** — `pnpm --filter <package> typecheck` (or `pnpm typecheck` from root) must exit 0.
