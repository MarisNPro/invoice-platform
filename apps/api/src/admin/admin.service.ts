import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Inject } from '@nestjs/common';
import { SignJWT } from 'jose';
import axios from 'axios';
import { Queue } from 'bullmq';
import type Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../common/redis/redis.constants';
import { buildBullConnection } from '../common/redis/redis-connection';
import { PLAN_REVENUE_CENTS } from '../organisation/organisation.service';
import type { UpdatePlanDto } from './dto/update-plan.dto';
import type { UpdateVatRateDto } from './dto/update-vat-rate.dto';
import type { Plan } from '@prisma/client';

/**
 * Keycloak Admin API user-management is disabled during the Keycloak → Supabase
 * auth migration. We must NEVER connect to the Keycloak Admin API with a default
 * password, so these methods fail closed (503) until the Supabase Admin API port.
 */
const ADMIN_MIGRATION_UNAVAILABLE =
  'Admin user management is temporarily unavailable during the auth migration. ' +
  'This will be restored with Supabase Admin API.';

// ── Keycloak helpers ──────────────────────────────────────────────────────────

async function measureMs<T>(fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const t0 = Date.now();
  const result = await fn();
  return { result, ms: Date.now() - t0 };
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma:  PrismaService,
    private readonly config:  ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  // ── 1. GET /admin/organisations ─────────────────────────────────────────────

  async getOrganisations(query: { tier?: string; country?: string; search?: string }) {
    const tenants = await this.prisma.tenant.findMany({
      where: {
        ...(query.tier    ? { plan: query.tier as Plan } : {}),
        ...(query.country ? { country: query.country }  : {}),
        ...(query.search  ? { name: { contains: query.search, mode: 'insensitive' as const } } : {}),
      },
      include: { _count: { select: { users: true, invoices: true } } },
      orderBy: { createdAt: 'desc' },
    });

    return tenants.map((t) => ({
      id:                  t.id,
      legalName:           t.name,
      vatNumber:           t.vatNumber,
      country:             t.country,
      planTier:            t.plan,
      planStartedAt:       t.planStartedAt,
      planExpiresAt:       t.planExpiresAt,
      monthlyInvoiceCount: t.monthlyInvoiceCount,
      monthlyInvoiceLimit: t.monthlyInvoiceLimit,
      monthlyAiCallCount:  t.monthlyAiCallCount,
      monthlyAiCallLimit:  t.monthlyAiCallLimit,
      monthlyAiSpendCents: t.monthlyAiSpendCents,
      monthlyAiSpendLimit: t.monthlyAiSpendLimit,
      userCount:           t._count.users,
      invoiceCount:        t._count.invoices,
      createdAt:           t.createdAt,
    }));
  }

  // ── 2. PATCH /admin/organisations/:id/plan ──────────────────────────────────

  async updatePlan(tenantId: string, dto: UpdatePlanDto, adminId: string) {
    const old = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!old) throw new NotFoundException(`Organisation ${tenantId} not found`);

    const updated = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        ...(dto.planTier            ? { plan: dto.planTier as Plan }                     : {}),
        ...(dto.monthlyInvoiceLimit !== undefined ? { monthlyInvoiceLimit: dto.monthlyInvoiceLimit } : {}),
        ...(dto.monthlyAiCallLimit  !== undefined ? { monthlyAiCallLimit:  dto.monthlyAiCallLimit  } : {}),
        ...(dto.monthlyAiSpendLimit !== undefined ? { monthlyAiSpendLimit: dto.monthlyAiSpendLimit } : {}),
        ...(dto.planExpiresAt       ? { planExpiresAt: new Date(dto.planExpiresAt) }     : {}),
        ...(dto.planTier            ? { planStartedAt: new Date() }                      : {}),
      },
    });

    await this.prisma.auditLog.create({
      data: {
        tenantId,
        userId: adminId,
        action: 'ADMIN_PLAN_CHANGE',
        payload: { from: old.plan, to: dto.planTier ?? old.plan, adminId },
      },
    });

    return { id: updated.id, legalName: updated.name, plan: updated.plan, planExpiresAt: updated.planExpiresAt };
  }

  // ── 3. POST /admin/organisations/:id/reset-counters ─────────────────────────

  async resetCounters(tenantId: string, adminId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException(`Organisation ${tenantId} not found`);

    await this.prisma.tenant.update({
      where: { id: tenantId },
      data:  { monthlyInvoiceCount: 0, monthlyAiCallCount: 0, monthlyAiSpendCents: 0 },
    });

    await this.prisma.auditLog.create({
      data: {
        tenantId,
        userId: adminId,
        action: 'ADMIN_COUNTERS_RESET',
        payload: { adminId, resetAt: new Date().toISOString() },
      },
    });

    return { message: 'Monthly counters reset to 0.', tenantId };
  }

  // ── 4. GET /admin/users ─────────────────────────────────────────────────────

  async getUsers(query: { search?: string; isActive?: boolean }) {
    const users = await this.prisma.user.findMany({
      where: {
        ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
        ...(query.search ? {
          OR: [
            { email: { contains: query.search, mode: 'insensitive' as const } },
            { name:  { contains: query.search, mode: 'insensitive' as const } },
          ],
        } : {}),
      },
      include: { tenant: true },
      orderBy: { createdAt: 'desc' },
    });

    return users.map((u) => ({
      id:          u.id,
      keycloakId:  u.keycloakId,
      email:       u.email,
      firstName:   u.firstName,
      lastName:    u.lastName,
      isActive:    u.isActive,
      lastLoginAt: u.lastLoginAt,
      createdAt:   u.createdAt,
      organisations: [{
        id:        u.tenant.id,
        legalName: u.tenant.name,
        role:      u.role,
      }],
    }));
  }

  // ── 5. POST /admin/users/:id/impersonate ────────────────────────────────────

  async impersonateUser(userId: string, adminId: string) {
    const user = await this.prisma.user.findUnique({
      where:   { id: userId },
      include: { tenant: true },
    });
    if (!user) throw new NotFoundException(`User ${userId} not found`);

    const rawSecret = this.config.get<string>('IMPERSONATION_SECRET', 'dev-impersonation-secret');
    const secret    = new TextEncoder().encode(rawSecret);
    const expTs     = Math.floor(Date.now() / 1000) + 3600;

    const token = await new SignJWT({
      sub:            user.id,
      orgId:          user.tenantId,
      impersonatedBy: adminId,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('1h')
      .setIssuedAt()
      .sign(secret);

    const expiresAt = new Date(expTs * 1000).toISOString();

    await this.prisma.auditLog.create({
      data: {
        tenantId: user.tenantId,
        userId:   adminId,
        action:   'IMPERSONATION_START',
        payload:  {
          targetUserId: userId,
          targetEmail:  user.email,
          adminId,
          expiresAt,
        },
      },
    });

    const appBase  = this.config.get<string>('APP_BASE_URL', 'http://localhost:4000');
    const loginUrl = `${appBase}/api/v1/auth/impersonate?token=${token}`;

    this.logger.warn(`IMPERSONATION: admin=${adminId} → user=${userId} (${user.email})`);

    return {
      token,
      expiresAt,
      loginUrl,
      targetUser: {
        id:       user.id,
        email:    user.email,
        name:     user.name,
        tenantId: user.tenantId,
        orgName:  user.tenant.name,
      },
    };
  }

  // ── 6. POST /admin/users/:id/disable ────────────────────────────────────────

  async disableUser(_userId: string, _adminId: string) {
    // Disables the user in Keycloak via the Admin API. Fail closed during the
    // auth migration rather than connect with a default admin password.
    throw new ServiceUnavailableException(ADMIN_MIGRATION_UNAVAILABLE);
  }

  // ── 7. GET /admin/audit-logs ────────────────────────────────────────────────

  async getAuditLogs(query: {
    orgId?:  string;
    userId?: string;
    action?: string;
    from?:   string;
    to?:     string;
    page?:   number;
    limit?:  number;
    format?: string;
  }) {
    const page  = query.page  ?? 1;
    const limit = query.limit ?? 50;
    const skip  = (page - 1) * limit;

    const where = {
      ...(query.orgId  ? { tenantId: query.orgId }  : {}),
      ...(query.userId ? { userId:   query.userId }  : {}),
      ...(query.action ? { action:   query.action }  : {}),
      ...(query.from || query.to ? {
        createdAt: {
          ...(query.from ? { gte: new Date(query.from) } : {}),
          ...(query.to   ? { lte: new Date(query.to)   } : {}),
        },
      } : {}),
    };

    const [logs, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    if (query.format === 'csv') {
      return this.buildCsv(logs);
    }

    return {
      data: logs,
      meta: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  private buildCsv(logs: { id: string; tenantId: string; invoiceId: string | null; userId: string | null; action: string; payload: unknown; createdAt: Date }[]): string {
    const header = 'id,tenantId,invoiceId,userId,action,payload,createdAt';
    const rows = logs.map((l) =>
      [l.id, l.tenantId, l.invoiceId ?? '', l.userId ?? '', l.action,
        JSON.stringify(l.payload ?? {}), l.createdAt.toISOString()]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(',')
    );
    return [header, ...rows].join('\n');
  }

  // ── 8. GET /admin/api-keys ──────────────────────────────────────────────────

  async getApiKeys() {
    const keys = await this.prisma.apiKey.findMany({
      include: {
        tenant:  { select: { name: true } },
        contact: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return keys.map((k) => ({
      id:           k.id,
      name:         k.name,
      keyPrefix:    k.keyPrefix,
      orgId:        k.tenantId,
      orgName:      k.tenant.name,
      customerId:   k.contactId,
      customerName: k.contact?.name ?? null,
      isActive:     k.isActive,
      lastUsedAt:   k.lastUsedAt,
      createdAt:    k.createdAt,
      // keyHash NEVER returned
    }));
  }

  // ── 9. DELETE /admin/api-keys/:id ──────────────────────────────────────────

  async revokeApiKey(keyId: string, adminId: string) {
    const key = await this.prisma.apiKey.findUnique({ where: { id: keyId } });
    if (!key) throw new NotFoundException(`API key ${keyId} not found`);

    await this.prisma.apiKey.update({ where: { id: keyId }, data: { isActive: false } });

    await this.prisma.auditLog.create({
      data: {
        tenantId: key.tenantId,
        userId:   adminId,
        action:   'ADMIN_API_KEY_REVOKED',
        payload:  { keyId, keyPrefix: key.keyPrefix, adminId },
      },
    });

    return { message: 'API key revoked.', keyId };
  }

  // ── 10. GET /admin/sessions ─────────────────────────────────────────────────

  async getSessions() {
    // Reads session stats from the Keycloak Admin API (requires admin creds).
    // Fail closed during the auth migration — no connecting with a default
    // admin password. Restored with the Supabase Admin API port.
    throw new ServiceUnavailableException(ADMIN_MIGRATION_UNAVAILABLE);
  }

  // ── 11. DELETE /admin/sessions/:userId ─────────────────────────────────────

  async terminateUserSessions(_userId: string, _adminId: string) {
    // Deletes the user's Keycloak sessions via the Admin API. Fail closed during
    // the auth migration rather than connect with a default admin password.
    throw new ServiceUnavailableException(ADMIN_MIGRATION_UNAVAILABLE);
  }

  // ── 12. GET /admin/system-health ────────────────────────────────────────────

  async getSystemHealth() {
    const kcUrl    = this.config.get('KEYCLOAK_URL',  'http://localhost:8080');
    const minioUrl = this.config.get('S3_ENDPOINT',   'http://localhost:9000');
    const redisUrl = this.config.get('REDIS_URL',     'redis://localhost:6379');

    const [postgres, redis, keycloak, minio, bullmq] = await Promise.all([
      // Postgres
      measureMs(async () => {
        await this.prisma.$queryRaw`SELECT 1`;
        return { status: 'up' as const };
      }).catch(() => ({ result: { status: 'down' as const }, ms: -1 })),

      // Redis
      measureMs(async () => {
        const pong = await this.redis.ping();
        return { status: pong === 'PONG' ? 'up' as const : 'degraded' as const };
      }).catch(() => ({ result: { status: 'down' as const }, ms: -1 })),

      // Keycloak
      measureMs(async () => {
        await axios.get(`${kcUrl}/health/live`, { timeout: 5_000 });
        return { status: 'up' as const };
      }).catch(() => ({ result: { status: 'down' as const }, ms: -1 })),

      // MinIO
      measureMs(async () => {
        await axios.get(`${minioUrl}/minio/health/live`, { timeout: 5_000 });
        return { status: 'up' as const };
      }).catch(() => ({ result: { status: 'down' as const }, ms: -1 })),

      // BullMQ queue stats
      measureMs(async () => {
        const queueNames = ['invoice-email', 'dunning-scheduler', 'monthly-reset', 'company-sync'];
        const conn       = buildBullConnection(redisUrl);
        const stats = await Promise.all(
          queueNames.map(async (name) => {
            const q = new Queue(name, { connection: conn });
            // Guard the EventEmitter: an unhandled 'error' here would crash the
            // process instead of failing this one health probe.
            q.on('error', () => undefined);
            const counts = await q.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
            await q.close();
            return { name, ...counts };
          }),
        );
        return { queues: stats };
      }).catch((err) => ({ result: { queues: [], error: (err as Error).message }, ms: -1 })),
    ]);

    type ServiceStatus = 'up' | 'degraded' | 'down';
    const statuses: ServiceStatus[] = [
      postgres.result.status,
      redis.result.status,
      keycloak.result.status,
      minio.result.status,
    ];
    const overall: 'healthy' | 'degraded' | 'down' =
      statuses.every((s) => s === 'up') ? 'healthy'
      : statuses.some((s) => s === 'down') ? 'down'
      : 'degraded';

    return {
      postgres:      { ...postgres.result,      responseMs: postgres.ms },
      redis:         { ...redis.result,         responseMs: redis.ms },
      keycloak:      { ...keycloak.result,      responseMs: keycloak.ms },
      minio:         { ...minio.result,         responseMs: minio.ms },
      bullmq:        { ...bullmq.result,        responseMs: bullmq.ms },
      overall,
      checkedAt:     new Date().toISOString(),
    };
  }

  // ── 13. GET /admin/ai-costs (extended) ─────────────────────────────────────

  async getAiCosts() {
    const tenants = await this.prisma.tenant.findMany({
      select: {
        id: true, name: true, plan: true,
        monthlyAiSpendCents: true, monthlyAiSpendLimit: true,
        createdAt: true,
      },
      orderBy: { monthlyAiSpendCents: 'desc' },
    });

    const orgs = tenants.map((t) => {
      const aiSpend     = t.monthlyAiSpendCents;
      const planRevenue = PLAN_REVENUE_CENTS[t.plan] ?? 0;
      const marginPct   = planRevenue > 0
        ? Math.round(((planRevenue - aiSpend) / planRevenue) * 100)
        : null;
      const flag =
        planRevenue === 0  ? 'ok' as const
        : marginPct === null ? 'ok' as const
        : marginPct < 0    ? 'loss' as const
        : marginPct < 50   ? 'warning' as const
        : 'ok' as const;

      return {
        id:                  t.id,
        legalName:           t.name,
        planTier:            t.plan,
        planRevenueCents:    planRevenue,
        monthlyAiSpendCents: aiSpend,
        marginPercent:       marginPct,
        flag,
      };
    });

    const totalRevenueCents  = orgs.reduce((s, o) => s + o.planRevenueCents, 0);
    const totalAiSpendCents  = orgs.reduce((s, o) => s + o.monthlyAiSpendCents, 0);
    const totalMarginPercent = totalRevenueCents > 0
      ? Math.round(((totalRevenueCents - totalAiSpendCents) / totalRevenueCents) * 100)
      : null;
    const flaggedOrgs = orgs.filter((o) => o.flag !== 'ok').length;

    return {
      orgs,
      totals: { totalRevenueCents, totalAiSpendCents, totalMarginPercent, flaggedOrgs },
    };
  }

  // ── 14. GET /admin/vat-rates ────────────────────────────────────────────────

  async getVatRates() {
    const rates = await this.prisma.taxRate.findMany({
      include: { tenant: { select: { country: true } } },
      orderBy: [{ tenant: { country: 'asc' } }, { rate: 'asc' }],
    });

    return rates.map((r) => ({
      id:          r.id,
      tenantId:    r.tenantId,
      countryCode: r.tenant.country,
      name:        r.name,
      rate:        Math.round(Number(r.rate) * 10000) / 100,  // fractional → percent (0.21 → 21.00)
      categoryCode: r.categoryCode,
      isDefault:   r.isDefault,
      isActive:    r.isActive,
    }));
  }

  // ── 15. PATCH /admin/vat-rates/:id ─────────────────────────────────────────

  async updateVatRate(id: string, dto: UpdateVatRateDto, adminId: string) {
    const existing = await this.prisma.taxRate.findUnique({
      where:   { id },
      include: { tenant: { select: { country: true } } },
    });
    if (!existing) throw new NotFoundException(`VAT rate ${id} not found`);

    const oldRatePct = Math.round(Number(existing.rate) * 10000) / 100;

    const updated = await this.prisma.taxRate.update({
      where: { id },
      data:  {
        ...(dto.name     !== undefined ? { name:     dto.name                } : {}),
        ...(dto.rate     !== undefined ? { rate:     dto.rate / 100          } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive            } : {}),
      },
      include: { tenant: { select: { country: true } } },
    });

    await this.prisma.auditLog.create({
      data: {
        tenantId: existing.tenantId,
        userId:   adminId,
        action:   'ADMIN_VAT_RATE_UPDATED',
        payload:  {
          countryCode: existing.tenant.country,
          oldRate:     oldRatePct,
          newRate:     dto.rate ?? oldRatePct,
          adminId,
        },
      },
    });

    return {
      id:          updated.id,
      tenantId:    updated.tenantId,
      countryCode: updated.tenant.country,
      name:        updated.name,
      rate:        Math.round(Number(updated.rate) * 10000) / 100,
      categoryCode: updated.categoryCode,
      isDefault:   updated.isDefault,
      isActive:    updated.isActive,
    };
  }

}
