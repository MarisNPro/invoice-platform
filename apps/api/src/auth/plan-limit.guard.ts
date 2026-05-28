import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { PrismaService } from '../prisma/prisma.service';
import type { JwtPayload } from './jwt-payload.interface';

@Injectable()
export class PlanLimitGuard implements CanActivate {
  private readonly logger = new Logger(PlanLimitGuard.name);

  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req  = context.switchToHttp().getRequest<FastifyRequest & { user?: JwtPayload }>();
    const user = req.user;

    // Unauthenticated requests (e.g. @Public() parse endpoint) bypass the cap.
    if (!user?.tenant_id) return true;

    const tenant = await this.prisma.tenant.findUnique({
      where:  { id: user.tenant_id },
      select: { monthlyAiSpendCents: true, monthlyAiSpendLimit: true, plan: true },
    });

    if (!tenant) return true;

    // -1 = unlimited (PROFESSIONAL plan or custom override)
    if (tenant.monthlyAiSpendLimit === -1) return true;

    if (tenant.monthlyAiSpendCents >= tenant.monthlyAiSpendLimit) {
      this.logger.warn(
        `Tenant ${user.tenant_id} (${tenant.plan}) hit AI spend cap: ` +
        `${tenant.monthlyAiSpendCents}¢ / ${tenant.monthlyAiSpendLimit}¢`,
      );
      throw new HttpException(
        {
          statusCode: HttpStatus.PAYMENT_REQUIRED,
          error:      'Payment Required',
          message:
            'Monthly AI budget reached. Upgrade your plan or wait for the 1st of next month.',
          usedCents:  tenant.monthlyAiSpendCents,
          limitCents: tenant.monthlyAiSpendLimit,
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }

    return true;
  }
}
