import { createHash, randomBytes } from 'crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateApiKeyDto } from './dto/api-key.dto';

// Plan revenue in euro cents/month (for admin margin calculation)
export const PLAN_REVENUE_CENTS: Record<string, number> = {
  FREE:            0,
  STARTER:      2900,   // €29/month
  BUSINESS:     9900,   // €99/month
  PROFESSIONAL: 29900,  // €299/month
};

@Injectable()
export class OrganisationService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Organisation profile ──────────────────────────────────────────────────

  async getMe(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where:  { id: tenantId },
      select: {
        id:                  true,
        name:                true,
        slug:                true,
        vatNumber:           true,
        country:             true,
        locale:              true,
        plan:                true,
        monthlyAiSpendCents: true,
        monthlyAiSpendLimit: true,
        createdAt:           true,
      },
    });

    if (!tenant) throw new NotFoundException(`Organisation ${tenantId} not found`);

    const used  = tenant.monthlyAiSpendCents;
    const limit = tenant.monthlyAiSpendLimit;

    return {
      id:        tenant.id,
      name:      tenant.name,
      slug:      tenant.slug,
      vatNumber: tenant.vatNumber,
      country:   tenant.country,
      locale:    tenant.locale,
      plan:      tenant.plan,
      createdAt: tenant.createdAt,
      aiSpend: {
        usedCents:   used,
        limitCents:  limit,
        usedEur:     (used / 100).toFixed(2),
        limitEur:    limit === -1 ? 'unlimited' : (limit / 100).toFixed(2),
        percentUsed: limit === -1 ? null : Math.round((used / limit) * 100),
        resetOn:     nextFirstOfMonth(),
      },
    };
  }

  // ── API key management ────────────────────────────────────────────────────

  async createApiKey(tenantId: string, dto: CreateApiKeyDto) {
    if (dto.customerId) {
      const contact = await this.prisma.contact.findFirst({
        where:  { id: dto.customerId, tenantId, isCustomer: true },
        select: { id: true },
      });
      if (!contact) {
        throw new BadRequestException(
          `Customer ${dto.customerId} not found or does not belong to this organisation.`,
        );
      }
    }

    // Key format: ro_<orgIdPrefix8>_<random32hex>
    const orgPrefix = tenantId.replace(/-/g, '').slice(0, 8);
    const random    = randomBytes(16).toString('hex');         // 32 hex chars
    const plainKey  = `ro_${orgPrefix}_${random}`;
    const keyHash   = createHash('sha256').update(plainKey).digest('hex');
    const keyPrefix = plainKey.slice(0, 12);                   // e.g. "ro_00000000_"

    const apiKey = await this.prisma.apiKey.create({
      data: {
        tenantId,
        contactId: dto.customerId ?? null,
        name:      dto.name,
        keyHash,
        keyPrefix,
        isActive:  true,
      },
    });

    return {
      id:         apiKey.id,
      name:       apiKey.name,
      keyPrefix:  apiKey.keyPrefix,
      customerId: apiKey.contactId,
      createdAt:  apiKey.createdAt,
      key:        plainKey,  // returned once — caller must store it
      message:    'Store this key now — it will not be shown again.',
    };
  }

  async listApiKeys(tenantId: string) {
    const keys = await this.prisma.apiKey.findMany({
      where:   { tenantId, isActive: true },
      select:  { id: true, name: true, keyPrefix: true, contactId: true, lastUsedAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    return keys.map((k) => ({ ...k, customerId: k.contactId }));
  }

  async revokeApiKey(tenantId: string, keyId: string) {
    const key = await this.prisma.apiKey.findFirst({ where: { id: keyId, tenantId } });
    if (!key) throw new NotFoundException(`API key ${keyId} not found.`);

    await this.prisma.apiKey.update({ where: { id: keyId }, data: { isActive: false } });
    return { message: 'Key revoked.' };
  }

  /**
   * Validates a plain ro_ key against the DB hash.
   * Called by the MCP server's internal validate endpoint on every new SSE connection.
   * Also stamps lastUsedAt (fire-and-forget).
   */
  async validateDbApiKey(plainKey: string): Promise<{ orgId: string; customerId?: string } | null> {
    const keyHash = createHash('sha256').update(plainKey).digest('hex');
    const apiKey  = await this.prisma.apiKey.findUnique({
      where:  { keyHash },
      select: { id: true, tenantId: true, contactId: true, isActive: true },
    });

    if (!apiKey?.isActive) return null;

    void this.prisma.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } });

    return { orgId: apiKey.tenantId, customerId: apiKey.contactId ?? undefined };
  }
}

function nextFirstOfMonth(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 1).toISOString().slice(0, 10);
}
