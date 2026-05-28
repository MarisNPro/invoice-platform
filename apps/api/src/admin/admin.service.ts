import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PLAN_REVENUE_CENTS } from '../organisation/organisation.service';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async getAiCosts() {
    const tenants = await this.prisma.tenant.findMany({
      select: {
        id:                  true,
        name:                true,
        slug:                true,
        plan:                true,
        monthlyAiSpendCents: true,
        monthlyAiSpendLimit: true,
        createdAt:           true,
      },
      orderBy: { monthlyAiSpendCents: 'desc' },
    });

    return tenants.map((t) => {
      const aiSpend         = t.monthlyAiSpendCents;
      const planRevenue     = PLAN_REVENUE_CENTS[t.plan] ?? 0;
      const marginPercent   =
        planRevenue > 0
          ? Math.round(((planRevenue - aiSpend) / planRevenue) * 100)
          : null;   // null = free tier, no revenue base for margin calc
      const flagRed         = marginPercent !== null && marginPercent < 50;

      return {
        id:               t.id,
        name:             t.name,
        slug:             t.slug,
        plan:             t.plan,
        monthlyAiSpendCents:  aiSpend,
        monthlyAiSpendEur:    (aiSpend / 100).toFixed(2),
        planRevenueCents:     planRevenue,
        planRevenueEur:       (planRevenue / 100).toFixed(2),
        limitCents:           t.monthlyAiSpendLimit,
        marginPercent,
        flagRed,
        createdAt:        t.createdAt,
      };
    });
  }
}
