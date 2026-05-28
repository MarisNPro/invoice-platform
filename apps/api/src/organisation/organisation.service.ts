import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Plan revenue in euro cents/month (for margin calculation in admin view)
export const PLAN_REVENUE_CENTS: Record<string, number> = {
  FREE:         0,
  STARTER:   2900,   // €29/month
  BUSINESS:  9900,   // €99/month
  PROFESSIONAL: 29900, // €299/month
};

@Injectable()
export class OrganisationService {
  constructor(private readonly prisma: PrismaService) {}

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
        usedCents:    used,
        limitCents:   limit,
        usedEur:      (used / 100).toFixed(2),
        limitEur:     limit === -1 ? 'unlimited' : (limit / 100).toFixed(2),
        percentUsed:  limit === -1 ? null : Math.round((used / limit) * 100),
        resetOn:      nextFirstOfMonth(),
      },
    };
  }
}

function nextFirstOfMonth(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 1).toISOString().slice(0, 10);
}
